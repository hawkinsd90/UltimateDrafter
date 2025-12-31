/*
  # Add Cron Job for Notifications Worker

  1. Extension Setup
    - Enable pg_cron extension for scheduled tasks
    - Enable pg_net extension for HTTP calls to Edge Functions

  2. Cron Schedule
    - Creates a job that runs every minute
    - Calls the process-notifications-outbox Edge Function
    - Uses service role key for authentication

  3. Notes
    - The cron job will automatically start running once created
    - To manually trigger the worker, use: SELECT process_notifications_worker();
    - To view cron job status: SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10;
*/

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Create a helper function to trigger the worker
CREATE OR REPLACE FUNCTION process_notifications_worker()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  supabase_url text;
  service_role_key text;
  request_id bigint;
BEGIN
  -- Get environment variables (these are set by Supabase)
  supabase_url := current_setting('app.settings.supabase_url', true);
  service_role_key := current_setting('app.settings.service_role_key', true);

  -- If settings not available, use env vars (for local dev)
  IF supabase_url IS NULL THEN
    supabase_url := current_setting('supabase.url', true);
  END IF;

  IF supabase_url IS NULL THEN
    RAISE NOTICE 'Supabase URL not configured for worker trigger';
    RETURN;
  END IF;

  -- Make HTTP request to edge function using pg_net
  SELECT net.http_post(
    url := supabase_url || '/functions/v1/process-notifications-outbox',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || COALESCE(service_role_key, '')
    ),
    body := '{}'::jsonb
  ) INTO request_id;

  RAISE NOTICE 'Triggered notification worker, request_id: %', request_id;
END;
$$;

-- Schedule the worker to run every minute
-- First, remove any existing schedule for this job
SELECT cron.unschedule('process-notifications-worker')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'process-notifications-worker'
);

-- Create the new schedule
SELECT cron.schedule(
  'process-notifications-worker',
  '* * * * *',  -- Every minute
  $$SELECT process_notifications_worker();$$
);

-- Grant necessary permissions
GRANT USAGE ON SCHEMA cron TO postgres;
GRANT ALL ON ALL TABLES IN SCHEMA cron TO postgres;
GRANT EXECUTE ON FUNCTION process_notifications_worker() TO postgres;

-- Note: For local development, you can manually trigger the worker with:
-- SELECT process_notifications_worker();
