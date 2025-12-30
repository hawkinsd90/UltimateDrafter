/*
  # DraftMaster Core Schema - Provider Agnostic Draft System

  ## Overview
  This migration creates the foundation for a fantasy sports draft platform
  that works independently of external providers (ESPN, Sleeper, etc.).

  ## New Tables

  ### 1. `leagues`
  Stores league information and settings
  - `id` (uuid, primary key)
  - `name` (text) - league name
  - `sport` (text) - sport type (football, basketball, etc.)
  - `season` (text) - season identifier
  - `owner_id` (uuid) - creator of the league
  - `settings` (jsonb) - league configuration
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

  ### 2. `drafts`
  Stores draft session information
  - `id` (uuid, primary key)
  - `league_id` (uuid, foreign key)
  - `name` (text) - draft name
  - `draft_type` (text) - snake, linear, auction
  - `status` (text) - pending, in_progress, completed, paused
  - `current_pick_number` (integer) - current pick in draft order
  - `current_participant_id` (uuid) - whose turn it is
  - `pick_time_seconds` (integer) - time allowed per pick
  - `start_time` (timestamptz) - scheduled start
  - `settings` (jsonb) - draft-specific settings
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

  ### 3. `draft_participants`
  Links users to drafts with their draft position
  - `id` (uuid, primary key)
  - `draft_id` (uuid, foreign key)
  - `user_id` (uuid) - participant identifier
  - `team_name` (text)
  - `draft_position` (integer) - draft order position
  - `phone_number` (text) - for notifications
  - `email` (text) - for notifications
  - `notification_preferences` (jsonb)
  - `joined_at` (timestamptz)

  ### 4. `players`
  Provider-agnostic player database
  - `id` (uuid, primary key)
  - `external_id` (text) - optional external provider ID
  - `name` (text)
  - `position` (text)
  - `team` (text) - real-world team
  - `sport` (text)
  - `metadata` (jsonb) - additional player data
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

  ### 5. `draft_picks`
  Records each pick made in a draft
  - `id` (uuid, primary key)
  - `draft_id` (uuid, foreign key)
  - `participant_id` (uuid, foreign key)
  - `player_id` (uuid, foreign key, nullable)
  - `pick_number` (integer) - overall pick number
  - `round` (integer)
  - `pick_in_round` (integer)
  - `picked_at` (timestamptz)
  - `time_taken_seconds` (integer)
  - `is_autopick` (boolean) - was this an automatic pick

  ### 6. `notifications_outbox`
  Queue for pending notifications
  - `id` (uuid, primary key)
  - `draft_id` (uuid, foreign key)
  - `participant_id` (uuid, foreign key)
  - `notification_type` (text) - your_turn, pick_made, draft_started, etc.
  - `channel` (text) - sms, email
  - `recipient` (text) - phone number or email
  - `message` (text)
  - `status` (text) - pending, sent, failed
  - `metadata` (jsonb)
  - `created_at` (timestamptz)
  - `sent_at` (timestamptz, nullable)
  - `error` (text, nullable)

  ### 7. `user_settings`
  User notification preferences
  - `id` (uuid, primary key)
  - `user_id` (uuid, unique)
  - `phone_number` (text)
  - `email` (text)
  - `notify_on_turn` (boolean) - default true
  - `notify_on_pick_made` (boolean) - default false
  - `notify_on_draft_start` (boolean) - default true
  - `preferred_channel` (text) - sms, email, both
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

  ## Security

  Row Level Security (RLS) is enabled on all tables with restrictive policies:
  
  - **leagues**: Users can view leagues they're participating in, create their own
  - **drafts**: Users can view drafts they're participating in
  - **draft_participants**: Users can view participants in their drafts, update their own record
  - **players**: Public read access for all authenticated users
  - **draft_picks**: Users can view picks in their drafts
  - **notifications_outbox**: Service role access only
  - **user_settings**: Users can only access their own settings

  ## Indexes

  Performance indexes added for:
  - Draft lookups by league
  - Participant lookups by draft and user
  - Pick lookups by draft
  - Notification queue processing
  - Player searches by name and position
*/

-- Create leagues table
CREATE TABLE IF NOT EXISTS leagues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  sport text NOT NULL,
  season text NOT NULL,
  owner_id uuid NOT NULL,
  settings jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create drafts table
CREATE TABLE IF NOT EXISTS drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id uuid NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  name text NOT NULL,
  draft_type text NOT NULL DEFAULT 'snake',
  status text NOT NULL DEFAULT 'pending',
  current_pick_number integer DEFAULT 1,
  current_participant_id uuid,
  pick_time_seconds integer DEFAULT 90,
  start_time timestamptz,
  settings jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT valid_draft_type CHECK (draft_type IN ('snake', 'linear', 'auction')),
  CONSTRAINT valid_status CHECK (status IN ('pending', 'in_progress', 'completed', 'paused'))
);

-- Create players table
CREATE TABLE IF NOT EXISTS players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id text,
  name text NOT NULL,
  position text NOT NULL,
  team text,
  sport text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_players_name ON players(name);
CREATE INDEX IF NOT EXISTS idx_players_position ON players(position);
CREATE INDEX IF NOT EXISTS idx_players_sport ON players(sport);
CREATE INDEX IF NOT EXISTS idx_players_external_id ON players(external_id);

-- Create draft_participants table
CREATE TABLE IF NOT EXISTS draft_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id uuid NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  team_name text NOT NULL,
  draft_position integer NOT NULL,
  phone_number text,
  email text,
  notification_preferences jsonb DEFAULT '{"notify_on_turn": true, "notify_on_pick_made": false}'::jsonb,
  joined_at timestamptz DEFAULT now(),
  UNIQUE(draft_id, user_id),
  UNIQUE(draft_id, draft_position)
);

CREATE INDEX IF NOT EXISTS idx_draft_participants_draft ON draft_participants(draft_id);
CREATE INDEX IF NOT EXISTS idx_draft_participants_user ON draft_participants(user_id);

-- Create draft_picks table
CREATE TABLE IF NOT EXISTS draft_picks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id uuid NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES draft_participants(id) ON DELETE CASCADE,
  player_id uuid REFERENCES players(id) ON DELETE SET NULL,
  pick_number integer NOT NULL,
  round integer NOT NULL,
  pick_in_round integer NOT NULL,
  picked_at timestamptz DEFAULT now(),
  time_taken_seconds integer DEFAULT 0,
  is_autopick boolean DEFAULT false,
  UNIQUE(draft_id, pick_number)
);

CREATE INDEX IF NOT EXISTS idx_draft_picks_draft ON draft_picks(draft_id);
CREATE INDEX IF NOT EXISTS idx_draft_picks_participant ON draft_picks(participant_id);
CREATE INDEX IF NOT EXISTS idx_draft_picks_player ON draft_picks(player_id);

-- Create notifications_outbox table
CREATE TABLE IF NOT EXISTS notifications_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id uuid REFERENCES drafts(id) ON DELETE CASCADE,
  participant_id uuid REFERENCES draft_participants(id) ON DELETE CASCADE,
  notification_type text NOT NULL,
  channel text NOT NULL,
  recipient text NOT NULL,
  message text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  sent_at timestamptz,
  error text,
  CONSTRAINT valid_notification_type CHECK (notification_type IN ('your_turn', 'pick_made', 'draft_started', 'draft_completed', 'missed_pick')),
  CONSTRAINT valid_channel CHECK (channel IN ('sms', 'email')),
  CONSTRAINT valid_status CHECK (status IN ('pending', 'sent', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_notifications_status_created ON notifications_outbox(status, created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_draft ON notifications_outbox(draft_id);

-- Create user_settings table
CREATE TABLE IF NOT EXISTS user_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE NOT NULL,
  phone_number text,
  email text,
  notify_on_turn boolean DEFAULT true,
  notify_on_pick_made boolean DEFAULT false,
  notify_on_draft_start boolean DEFAULT true,
  preferred_channel text DEFAULT 'sms',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT valid_preferred_channel CHECK (preferred_channel IN ('sms', 'email', 'both'))
);

CREATE INDEX IF NOT EXISTS idx_user_settings_user ON user_settings(user_id);

-- Add foreign key for current_participant_id in drafts
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'drafts_current_participant_id_fkey'
  ) THEN
    ALTER TABLE drafts 
    ADD CONSTRAINT drafts_current_participant_id_fkey 
    FOREIGN KEY (current_participant_id) 
    REFERENCES draft_participants(id) 
    ON DELETE SET NULL;
  END IF;
END $$;

-- Enable RLS on all tables
ALTER TABLE leagues ENABLE ROW LEVEL SECURITY;
ALTER TABLE drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE draft_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE draft_picks ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

-- RLS Policies for leagues
CREATE POLICY "Users can view leagues they own or participate in"
  ON leagues FOR SELECT
  TO authenticated
  USING (
    owner_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM draft_participants dp
      JOIN drafts d ON d.id = dp.draft_id
      WHERE d.league_id = leagues.id
      AND dp.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create leagues"
  ON leagues FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "League owners can update their leagues"
  ON leagues FOR UPDATE
  TO authenticated
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

-- RLS Policies for drafts
CREATE POLICY "Users can view drafts they participate in"
  ON drafts FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM draft_participants
      WHERE draft_participants.draft_id = drafts.id
      AND draft_participants.user_id = auth.uid()
    ) OR
    EXISTS (
      SELECT 1 FROM leagues
      WHERE leagues.id = drafts.league_id
      AND leagues.owner_id = auth.uid()
    )
  );

CREATE POLICY "League owners can create drafts"
  ON drafts FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM leagues
      WHERE leagues.id = league_id
      AND leagues.owner_id = auth.uid()
    )
  );

CREATE POLICY "League owners can update their drafts"
  ON drafts FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM leagues
      WHERE leagues.id = drafts.league_id
      AND leagues.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM leagues
      WHERE leagues.id = drafts.league_id
      AND leagues.owner_id = auth.uid()
    )
  );

-- RLS Policies for players
CREATE POLICY "Authenticated users can view all players"
  ON players FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can add players"
  ON players FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- RLS Policies for draft_participants
CREATE POLICY "Users can view participants in their drafts"
  ON draft_participants FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM draft_participants dp
      WHERE dp.draft_id = draft_participants.draft_id
      AND dp.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can join drafts"
  ON draft_participants FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own participant record"
  ON draft_participants FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- RLS Policies for draft_picks
CREATE POLICY "Users can view picks in their drafts"
  ON draft_picks FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM draft_participants
      WHERE draft_participants.draft_id = draft_picks.draft_id
      AND draft_participants.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can make picks in their drafts"
  ON draft_picks FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM draft_participants
      WHERE draft_participants.id = participant_id
      AND draft_participants.user_id = auth.uid()
    )
  );

-- RLS Policies for notifications_outbox (service role only)
CREATE POLICY "Service role can manage all notifications"
  ON notifications_outbox FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- RLS Policies for user_settings
CREATE POLICY "Users can view their own settings"
  ON user_settings FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own settings"
  ON user_settings FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own settings"
  ON user_settings FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Add triggers for updated_at
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_leagues_updated_at') THEN
    CREATE TRIGGER update_leagues_updated_at BEFORE UPDATE ON leagues
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_drafts_updated_at') THEN
    CREATE TRIGGER update_drafts_updated_at BEFORE UPDATE ON drafts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_players_updated_at') THEN
    CREATE TRIGGER update_players_updated_at BEFORE UPDATE ON players
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_user_settings_updated_at') THEN
    CREATE TRIGGER update_user_settings_updated_at BEFORE UPDATE ON user_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;
