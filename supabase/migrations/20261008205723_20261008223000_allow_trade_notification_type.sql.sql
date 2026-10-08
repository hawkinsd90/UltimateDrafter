/*
# Allow trade SMS notification records

1. Purpose
- Trade proposal triggers write SMS records to notifications_outbox using notification_type = 'trade'.
- The existing constraint predates trade notifications and rejects that valid notification category.

2. Modified objects
- Update the `notifications_outbox.valid_notification_type` check constraint.
- Preserve every existing allowed notification type.
- Add `trade` for player trade proposal, acceptance, rejection, and cancellation messages.

3. Security and data safety
- No rows are deleted or rewritten.
- No notification permissions or delivery behavior are changed.
- The existing SMS consent and verified-phone checks remain enforced by the trade trigger.
*/

ALTER TABLE notifications_outbox
  DROP CONSTRAINT IF EXISTS valid_notification_type;

ALTER TABLE notifications_outbox
  ADD CONSTRAINT valid_notification_type
  CHECK (notification_type IN (
    'your_turn',
    'pick_made',
    'draft_started',
    'draft_completed',
    'missed_pick',
    'phone_verification',
    'trade'
  ));