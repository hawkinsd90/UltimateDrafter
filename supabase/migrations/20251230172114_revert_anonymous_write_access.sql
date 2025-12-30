/*
  # Revert Anonymous Write Access
  
  Security fix: Remove all anonymous write access policies.
  Tables should be read-only for anonymous users.
  
  ## Changes
  - Drop all anonymous insert/update policies
  - Keep only SELECT policies for anonymous users
  - Authenticated policies remain for future auth implementation
*/

-- Players: Remove anonymous insert policy, keep read-only
DROP POLICY IF EXISTS "Anyone can add players" ON players;
DROP POLICY IF EXISTS "Anyone can view players" ON players;

CREATE POLICY "Anonymous users can view all players"
  ON players FOR SELECT
  TO anon, authenticated
  USING (true);

-- Leagues: Remove write access for anonymous
DROP POLICY IF EXISTS "Anonymous can create leagues" ON leagues;
DROP POLICY IF EXISTS "Anonymous can view all leagues" ON leagues;
DROP POLICY IF EXISTS "Anonymous can update leagues" ON leagues;

CREATE POLICY "Anonymous users can view all leagues"
  ON leagues FOR SELECT
  TO anon, authenticated
  USING (true);

-- Drafts: Remove write access for anonymous
DROP POLICY IF EXISTS "Anonymous can create drafts" ON drafts;
DROP POLICY IF EXISTS "Anonymous can view all drafts" ON drafts;
DROP POLICY IF EXISTS "Anonymous can update drafts" ON drafts;

CREATE POLICY "Anonymous users can view all drafts"
  ON drafts FOR SELECT
  TO anon, authenticated
  USING (true);

-- Draft Participants: Remove write access for anonymous
DROP POLICY IF EXISTS "Anonymous can add participants" ON draft_participants;
DROP POLICY IF EXISTS "Anonymous can view all participants" ON draft_participants;
DROP POLICY IF EXISTS "Anonymous can update participants" ON draft_participants;

CREATE POLICY "Anonymous users can view all participants"
  ON draft_participants FOR SELECT
  TO anon, authenticated
  USING (true);

-- Draft Picks: Remove write access for anonymous
DROP POLICY IF EXISTS "Anonymous can make picks" ON draft_picks;
DROP POLICY IF EXISTS "Anonymous can view all picks" ON draft_picks;

CREATE POLICY "Anonymous users can view all picks"
  ON draft_picks FOR SELECT
  TO anon, authenticated
  USING (true);

-- Notifications Outbox: Remove write access for anonymous
DROP POLICY IF EXISTS "Anonymous can log notifications" ON notifications_outbox;
DROP POLICY IF EXISTS "Anonymous can view notifications" ON notifications_outbox;

CREATE POLICY "Anonymous users can view notifications"
  ON notifications_outbox FOR SELECT
  TO anon, authenticated
  USING (true);

-- User Settings: Remove write access for anonymous
DROP POLICY IF EXISTS "Anonymous can create settings" ON user_settings;
DROP POLICY IF EXISTS "Anonymous can view settings" ON user_settings;
DROP POLICY IF EXISTS "Anonymous can update settings" ON user_settings;

CREATE POLICY "Anonymous users can view settings"
  ON user_settings FOR SELECT
  TO anon, authenticated
  USING (true);
