/*
  # Add delivery tracking columns to notifications_outbox

  ## Problem
  The `telnyx-delivery-webhook` edge function (lines 71-77) attempts to UPDATE
  `delivery_status` and `provider_delivered_at` on `notifications_outbox` every
  time Telnyx sends a delivery callback. Neither column existed, so every webhook
  call either silently updated 0 rows or returned an error — leaving us with no
  downstream delivery visibility. All rows currently show `status = 'sent'`, which
  only means Telnyx accepted the message, not that the handset received it.

  ## Changes

  ### notifications_outbox
  - `delivery_status` (text, nullable) — the final delivery outcome as reported by
    Telnyx. Constrained to the four values the webhook currently maps to
    ('delivered', 'delivery_failed') plus two additional values
    ('carrier_blocked', 'unknown') that may appear in Telnyx payloads not currently
    mapped. Constraint is permissive enough to not break the existing webhook logic.
  - `provider_delivered_at` (timestamptz, nullable) — the timestamp written by the
    webhook when `delivery_status = 'delivered'`.

  ## Safety
  - Both columns use `ADD COLUMN IF NOT EXISTS` — safe to re-run.
  - Existing rows are unaffected; both columns default to NULL.
  - No existing columns are modified, removed, or renamed.
  - No edge function code is changed.
  - The CHECK constraint only covers known Telnyx outcome values. Any unrecognized
    value from Telnyx will cause the webhook to return 500 (same behavior as before),
    preventing silent bad data. If Telnyx adds new event types in future, the
    constraint can be extended.
*/

ALTER TABLE notifications_outbox
  ADD COLUMN IF NOT EXISTS delivery_status text
    CHECK (delivery_status IN ('delivered', 'delivery_failed', 'carrier_blocked', 'unknown')),
  ADD COLUMN IF NOT EXISTS provider_delivered_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_notifications_outbox_delivery_status
  ON notifications_outbox(delivery_status)
  WHERE delivery_status IS NOT NULL;
