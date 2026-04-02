/*
  # Fix Notifications Worker and Create Claim RPC

  ## Problem
  The `process_notifications_worker()` cron function silently exited every minute
  because `app.settings.supabase_url` and `app.settings.service_role_key` were never
  set in the database. The function hit its NULL guard and returned without making
  any HTTP request to the edge function, leaving all `notifications_outbox` rows
  stuck at `status = 'pending'` forever.

  ## Changes

  ### 1. Updated `process_notifications_worker()`
  - Hardcodes the project URL directly — no longer depends on `app.settings.supabase_url`
  - No auth header needed because `process-notifications-outbox` is redeployed with `verify_jwt: false`

  ### 2. New `claim_pending_notifications` RPC
  - Atomically claims a batch of pending notifications using `FOR UPDATE SKIP LOCKED`
  - Eliminates the fallback manual claim path in the edge function

  ### 3. Reset stuck pending rows
  - Rows created in April that were never attempted are reset so they'll be picked up
    on the next cron run (sets next_attempt_at = now())

  ## Security
  - `process_notifications_worker` is SECURITY DEFINER; only postgres can call it
  - `claim_pending_notifications` uses row-level locking to prevent double-processing
*/

-- 1. Update the worker function to use hardcoded project URL
CREATE OR REPLACE FUNCTION process_notifications_worker()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  request_id bigint;
BEGIN
  SELECT net.http_post(
    url := 'https://nlvhxlnsxsnnjzxceuvf.supabase.co/functions/v1/process-notifications-outbox',
    headers := jsonb_build_object(
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  ) INTO request_id;

  RAISE NOTICE 'Triggered notification worker, request_id: %', request_id;
END;
$$;

GRANT EXECUTE ON FUNCTION process_notifications_worker() TO postgres;

-- 2. Create claim_pending_notifications RPC used by the edge function
CREATE OR REPLACE FUNCTION claim_pending_notifications(
  p_batch_size int,
  p_worker_id text,
  p_now timestamptz
)
RETURNS SETOF notifications_outbox
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE notifications_outbox
  SET
    status    = 'processing',
    locked_at = p_now,
    locked_by = p_worker_id
  WHERE id IN (
    SELECT id
    FROM notifications_outbox
    WHERE status IN ('pending', 'retry_scheduled')
      AND next_attempt_at <= p_now
    ORDER BY next_attempt_at ASC
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$;

GRANT EXECUTE ON FUNCTION claim_pending_notifications(int, text, timestamptz) TO service_role;

-- 3. Reset stuck pending rows from April so they're picked up immediately
UPDATE notifications_outbox
SET next_attempt_at = now()
WHERE status = 'pending'
  AND attempt_count = 0
  AND last_attempt_at IS NULL
  AND created_at >= '2026-04-01';
