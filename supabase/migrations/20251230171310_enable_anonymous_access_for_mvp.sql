/*
  # Enable Anonymous Access for MVP

  Temporarily allow anonymous access to all tables for MVP testing.
  This should be replaced with proper authentication in production.

  ## Changes
  - Add anonymous access policies for leagues, drafts, participants, picks
  - Allow anonymous access to notifications_outbox for logging
*/

-- Leagues: Allow anonymous users to create and view all leagues
CREATE POLICY "Anonymous can create leagues"
  ON leagues FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Anonymous can view all leagues"
  ON leagues FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Anonymous can update leagues"
  ON leagues FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

-- Drafts: Allow anonymous access
CREATE POLICY "Anonymous can create drafts"
  ON drafts FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Anonymous can view all drafts"
  ON drafts FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Anonymous can update drafts"
  ON drafts FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

-- Draft Participants: Allow anonymous access
CREATE POLICY "Anonymous can add participants"
  ON draft_participants FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Anonymous can view all participants"
  ON draft_participants FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Anonymous can update participants"
  ON draft_participants FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

-- Draft Picks: Allow anonymous access
CREATE POLICY "Anonymous can make picks"
  ON draft_picks FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Anonymous can view all picks"
  ON draft_picks FOR SELECT
  TO anon
  USING (true);

-- Notifications Outbox: Allow anonymous inserts
CREATE POLICY "Anonymous can log notifications"
  ON notifications_outbox FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Anonymous can view notifications"
  ON notifications_outbox FOR SELECT
  TO anon
  USING (true);

-- User Settings: Allow anonymous access
CREATE POLICY "Anonymous can create settings"
  ON user_settings FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Anonymous can view settings"
  ON user_settings FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Anonymous can update settings"
  ON user_settings FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);
