/*
  # Make legacy notifications_outbox columns nullable

  ## Problem
  The `recipient` and `message` columns in `notifications_outbox` were originally
  created as NOT NULL with no default values. The updated system now uses
  `destination` and `message_text` instead. Any insert that omits `recipient`/`message`
  (as the corrected start-phone-verification function does) is rejected by Postgres
  with a NOT NULL constraint violation. The supabase-js client does not throw on
  insert errors, so the function silently returned 200 while the row was never written.

  ## Changes
  - `notifications_outbox.recipient`: drop NOT NULL constraint (legacy column)
  - `notifications_outbox.message`: drop NOT NULL constraint (legacy column)

  These columns are kept for backward compatibility with older rows but are no
  longer required for new inserts that use the `destination`/`message_text` columns.
*/

ALTER TABLE notifications_outbox ALTER COLUMN recipient DROP NOT NULL;
ALTER TABLE notifications_outbox ALTER COLUMN message DROP NOT NULL;
