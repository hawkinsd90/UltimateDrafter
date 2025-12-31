/*
  # Extend Notifications Outbox System

  1. Modifications to Existing Tables
    - `notifications_outbox` - Extend to support full retry/outbox pattern
      - Add new columns for retry logic, provider tracking, locking
      - Add new status values for consent/destination blocking
      - Keep existing columns for backward compatibility

  2. New Tables
    - `user_notification_settings`
      - Stores user phone numbers and notification preferences
      - Tracks SMS and voice consent separately
      - Records opt-out status and consent audit trail

    - `audit_events`
      - General purpose audit log for all notification lifecycle events

  3. Security
    - Update RLS policies for extended schema
    - user_notification_settings: users can read/write own settings
    - audit_events: users can read own events

  4. Indexes
    - Add indexes for worker queries
*/

-- Extend notifications_outbox table with new columns
DO $$
BEGIN
  -- Add user_id if not exists (might be used instead of participant_id)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'notifications_outbox' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE notifications_outbox ADD COLUMN user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;

  -- Add league_id if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'notifications_outbox' AND column_name = 'league_id'
  ) THEN
    ALTER TABLE notifications_outbox ADD COLUMN league_id uuid REFERENCES leagues(id) ON DELETE SET NULL;
  END IF;

  -- Add team_id if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'notifications_outbox' AND column_name = 'team_id'
  ) THEN
    ALTER TABLE notifications_outbox ADD COLUMN team_id uuid NULL;
  END IF;

  -- Add template_key if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'notifications_outbox' AND column_name = 'template_key'
  ) THEN
    ALTER TABLE notifications_outbox ADD COLUMN template_key text NULL;
  END IF;

  -- Add payload if not exists (different from metadata)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'notifications_outbox' AND column_name = 'payload'
  ) THEN
    ALTER TABLE notifications_outbox ADD COLUMN payload jsonb NOT NULL DEFAULT '{}'::jsonb;
  END IF;

  -- Add message_text if not exists (different from message)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'notifications_outbox' AND column_name = 'message_text'
  ) THEN
    ALTER TABLE notifications_outbox ADD COLUMN message_text text NULL;
  END IF;

  -- Add created_by if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'notifications_outbox' AND column_name = 'created_by'
  ) THEN
    ALTER TABLE notifications_outbox ADD COLUMN created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;

  -- Add destination if not exists (rename from recipient)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'notifications_outbox' AND column_name = 'destination'
  ) THEN
    ALTER TABLE notifications_outbox ADD COLUMN destination text NULL;
    -- Copy data from recipient if it exists
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'notifications_outbox' AND column_name = 'recipient'
    ) THEN
      UPDATE notifications_outbox SET destination = recipient WHERE destination IS NULL;
    END IF;
  END IF;

  -- Add attempt_count if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'notifications_outbox' AND column_name = 'attempt_count'
  ) THEN
    ALTER TABLE notifications_outbox ADD COLUMN attempt_count int NOT NULL DEFAULT 0;
  END IF;

  -- Add next_attempt_at if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'notifications_outbox' AND column_name = 'next_attempt_at'
  ) THEN
    ALTER TABLE notifications_outbox ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now();
  END IF;

  -- Add last_attempt_at if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'notifications_outbox' AND column_name = 'last_attempt_at'
  ) THEN
    ALTER TABLE notifications_outbox ADD COLUMN last_attempt_at timestamptz NULL;
  END IF;

  -- Add last_error if not exists (different from error)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'notifications_outbox' AND column_name = 'last_error'
  ) THEN
    ALTER TABLE notifications_outbox ADD COLUMN last_error text NULL;
  END IF;

  -- Add provider if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'notifications_outbox' AND column_name = 'provider'
  ) THEN
    ALTER TABLE notifications_outbox ADD COLUMN provider text NULL;
  END IF;

  -- Add provider_message_id if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'notifications_outbox' AND column_name = 'provider_message_id'
  ) THEN
    ALTER TABLE notifications_outbox ADD COLUMN provider_message_id text NULL;
  END IF;

  -- Add locked_at if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'notifications_outbox' AND column_name = 'locked_at'
  ) THEN
    ALTER TABLE notifications_outbox ADD COLUMN locked_at timestamptz NULL;
  END IF;

  -- Add locked_by if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'notifications_outbox' AND column_name = 'locked_by'
  ) THEN
    ALTER TABLE notifications_outbox ADD COLUMN locked_by text NULL;
  END IF;
END $$;

-- Drop old status constraint and add new one with extended values
ALTER TABLE notifications_outbox DROP CONSTRAINT IF EXISTS notifications_outbox_status_check;
ALTER TABLE notifications_outbox ADD CONSTRAINT notifications_outbox_status_check
  CHECK (status IN (
    'pending',
    'processing',
    'sent',
    'failed',
    'retry_scheduled',
    'blocked_no_consent',
    'blocked_no_destination'
  ));

-- Extend channel constraint to include voice and push
ALTER TABLE notifications_outbox DROP CONSTRAINT IF EXISTS notifications_outbox_channel_check;
ALTER TABLE notifications_outbox ADD CONSTRAINT notifications_outbox_channel_check
  CHECK (channel IN ('email', 'sms', 'voice', 'push'));

-- Make destination NOT NULL where status allows
-- (we'll validate this in the application layer)

-- Create indexes for notifications_outbox
CREATE INDEX IF NOT EXISTS idx_notifications_outbox_status_next_attempt
  ON notifications_outbox(status, next_attempt_at)
  WHERE status IN ('pending', 'retry_scheduled');

CREATE INDEX IF NOT EXISTS idx_notifications_outbox_user_id_created_at
  ON notifications_outbox(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_outbox_league_id_created_at
  ON notifications_outbox(league_id, created_at DESC);

-- Create user_notification_settings table
CREATE TABLE IF NOT EXISTS user_notification_settings (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  phone_e164 text NULL,
  phone_verified boolean NOT NULL DEFAULT false,
  consent_sms boolean NOT NULL DEFAULT false,
  consent_voice boolean NOT NULL DEFAULT false,
  consent_updated_at timestamptz NULL,
  consent_text_version text NULL,
  opted_out_sms boolean NOT NULL DEFAULT false,
  opted_out_voice boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Create audit_events table
CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  league_id uuid REFERENCES leagues(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'notification_enqueued',
    'notification_sent',
    'notification_failed',
    'notification_retry_scheduled',
    'notification_blocked'
  )),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- Create indexes for audit_events
CREATE INDEX IF NOT EXISTS idx_audit_events_user_id_created_at
  ON audit_events(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_events_league_id_created_at
  ON audit_events(league_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_events_event_type_created_at
  ON audit_events(event_type, created_at DESC);

-- Enable RLS on new tables
ALTER TABLE user_notification_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;

-- RLS Policies for user_notification_settings
CREATE POLICY "Users can view own notification settings"
  ON user_notification_settings FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own notification settings"
  ON user_notification_settings FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own notification settings"
  ON user_notification_settings FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- RLS Policies for audit_events
CREATE POLICY "Users can view own audit events"
  ON audit_events FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Update RLS for notifications_outbox to include user_id
DROP POLICY IF EXISTS "Users can view own notifications" ON notifications_outbox;
CREATE POLICY "Users can view own notifications"
  ON notifications_outbox FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR participant_id IN (
    SELECT id FROM draft_participants WHERE user_id = auth.uid()
  ));

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at on user_notification_settings
DROP TRIGGER IF EXISTS update_user_notification_settings_updated_at ON user_notification_settings;
CREATE TRIGGER update_user_notification_settings_updated_at
  BEFORE UPDATE ON user_notification_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
