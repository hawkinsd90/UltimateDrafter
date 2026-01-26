/*
  # Add Consent Tracking Fields

  1. Changes
    - Add `sms_consent_timestamp` to track when consent was given
    - Add `sms_consent_source` to track where consent was given (login_screen, phone_verification)

  2. Security
    - No RLS changes needed - fields are part of existing user_profile table
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_profile' AND column_name = 'sms_consent_timestamp'
  ) THEN
    ALTER TABLE user_profile ADD COLUMN sms_consent_timestamp timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_profile' AND column_name = 'sms_consent_source'
  ) THEN
    ALTER TABLE user_profile ADD COLUMN sms_consent_source text;
  END IF;
END $$;
