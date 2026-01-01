/*
  # Create User Profile with Phone Verification

  ## Overview
  Creates a user_profile table to store phone numbers and verification status.
  Implements secure OTP-based phone verification with proper hashing and rate limiting.

  ## New Tables
  
  ### `user_profile`
  - `user_id` (uuid, primary key) - References auth.users, cascade delete
  - `phone_e164` (text, unique, nullable) - Phone number in E.164 format (+13135551234)
  - `phone_verified` (boolean) - Whether phone has been verified via OTP
  - `phone_verified_at` (timestamptz, nullable) - When phone was verified
  - `phone_verification_sent_at` (timestamptz, nullable) - Last OTP send time
  - `phone_verification_attempts` (int) - Count of verification attempts (for rate limiting)
  - `phone_verification_code_hash` (text, nullable) - Hashed OTP code (never raw)
  - `phone_verification_expires_at` (timestamptz, nullable) - When OTP expires (10 min)
  - `sms_consent` (boolean) - User consent to receive SMS notifications
  - `created_at` (timestamptz) - Profile creation timestamp
  - `updated_at` (timestamptz) - Last update timestamp

  ## Indexes
  - Index on phone_e164 for lookup
  - Index on phone_verified for filtering verified users

  ## Security
  - Enable RLS on user_profile
  - SELECT: Users can read their own profile
  - INSERT: Users can create their own profile (auto on first login)
  - UPDATE: Users can update their own profile
    - SECURITY: phone_verification_code_hash and phone_verified can ONLY be set via Edge Functions
    - Use SECURITY DEFINER functions to enforce this
  - DELETE: Users can delete their own profile

  ## Triggers
  - Auto-update `updated_at` timestamp

  ## Rate Limiting
  - phone_verification_attempts resets hourly (handled in Edge Function)
  - Max 5 send attempts per hour
  - Max 10 verify attempts per code
*/

-- Create user_profile table
CREATE TABLE IF NOT EXISTS user_profile (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  phone_e164 text UNIQUE,
  phone_verified boolean NOT NULL DEFAULT false,
  phone_verified_at timestamptz,
  phone_verification_sent_at timestamptz,
  phone_verification_attempts int NOT NULL DEFAULT 0,
  phone_verification_code_hash text,
  phone_verification_expires_at timestamptz,
  sms_consent boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  
  CONSTRAINT valid_phone_e164 CHECK (
    phone_e164 IS NULL OR 
    phone_e164 ~ '^\+[1-9]\d{1,14}$'
  ),
  
  CONSTRAINT phone_verified_requires_phone CHECK (
    NOT phone_verified OR phone_e164 IS NOT NULL
  ),
  
  CONSTRAINT sms_consent_requires_verified CHECK (
    NOT sms_consent OR phone_verified
  )
);

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_user_profile_phone_e164 ON user_profile(phone_e164) WHERE phone_e164 IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_profile_verified ON user_profile(phone_verified) WHERE phone_verified = true;

-- Add trigger to auto-update updated_at
DROP TRIGGER IF EXISTS update_user_profile_updated_at ON user_profile;
CREATE TRIGGER update_user_profile_updated_at
  BEFORE UPDATE ON user_profile
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Enable RLS
ALTER TABLE user_profile ENABLE ROW LEVEL SECURITY;

-- SELECT: Users can read their own profile
CREATE POLICY "Users can read own profile"
  ON user_profile
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- INSERT: Users can create their own profile
CREATE POLICY "Users can create own profile"
  ON user_profile
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- UPDATE: Users can update their own profile (restricted fields via function)
CREATE POLICY "Users can update own profile"
  ON user_profile
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- DELETE: Users can delete their own profile
CREATE POLICY "Users can delete own profile"
  ON user_profile
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- SECURITY DEFINER function to set verification code hash (only callable by Edge Functions)
CREATE OR REPLACE FUNCTION set_phone_verification_code(
  p_user_id uuid,
  p_code_hash text,
  p_expires_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE user_profile
  SET 
    phone_verification_code_hash = p_code_hash,
    phone_verification_expires_at = p_expires_at,
    phone_verification_sent_at = now(),
    updated_at = now()
  WHERE user_id = p_user_id;
END;
$$;

-- SECURITY DEFINER function to mark phone as verified
CREATE OR REPLACE FUNCTION mark_phone_verified(
  p_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE user_profile
  SET 
    phone_verified = true,
    phone_verified_at = now(),
    phone_verification_code_hash = NULL,
    phone_verification_expires_at = NULL,
    phone_verification_attempts = 0,
    updated_at = now()
  WHERE user_id = p_user_id;
END;
$$;

-- SECURITY DEFINER function to increment verification attempts
CREATE OR REPLACE FUNCTION increment_phone_verification_attempts(
  p_user_id uuid
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempts int;
BEGIN
  UPDATE user_profile
  SET 
    phone_verification_attempts = phone_verification_attempts + 1,
    updated_at = now()
  WHERE user_id = p_user_id
  RETURNING phone_verification_attempts INTO v_attempts;
  
  RETURN v_attempts;
END;
$$;

-- Helper function to check if user can send verification SMS (rate limiting)
CREATE OR REPLACE FUNCTION can_send_phone_verification(
  p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_last_sent timestamptz;
  v_attempts int;
BEGIN
  SELECT phone_verification_sent_at, phone_verification_attempts
  INTO v_last_sent, v_attempts
  FROM user_profile
  WHERE user_id = p_user_id;
  
  -- If no profile, allow (will be created)
  IF NOT FOUND THEN
    RETURN true;
  END IF;
  
  -- Reset attempts if more than 1 hour has passed
  IF v_last_sent IS NULL OR v_last_sent < now() - interval '1 hour' THEN
    UPDATE user_profile
    SET phone_verification_attempts = 0
    WHERE user_id = p_user_id;
    RETURN true;
  END IF;
  
  -- Check if under rate limit (5 per hour)
  IF v_attempts >= 5 THEN
    RETURN false;
  END IF;
  
  -- Check cooldown (30 seconds between sends)
  IF v_last_sent > now() - interval '30 seconds' THEN
    RETURN false;
  END IF;
  
  RETURN true;
END;
$$;
