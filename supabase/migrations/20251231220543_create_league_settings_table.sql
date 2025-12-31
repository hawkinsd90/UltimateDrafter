/*
  # Create League Settings Table

  ## Overview
  Creates a league_settings table with 1:1 relationship to leagues.
  Stores draft configuration, roster requirements, and league behavior flags.

  ## New Tables
  
  ### `league_settings`
  - `league_id` (uuid, primary key) - References leagues(id), cascade delete
  - `created_by` (uuid) - User who created settings, references auth.users
  - `created_at` (timestamptz) - When settings were created
  - `updated_at` (timestamptz) - Last update timestamp
  
  #### Draft Settings
  - `draft_format` (text) - Draft type: 'snake' or 'linear'
  - `pick_timer_seconds` (int) - Seconds per pick, 0 = unlimited
  - `allow_pauses` (boolean) - Whether draft can be paused
  - `drafting_hours_enabled` (boolean) - Restrict drafting to specific hours
  - `drafting_hours_start` (time) - Start of allowed drafting window
  - `drafting_hours_end` (time) - End of allowed drafting window
  
  #### Roster Settings
  - `roster_qb` (int) - Number of QB slots
  - `roster_rb` (int) - Number of RB slots
  - `roster_wr` (int) - Number of WR slots
  - `roster_te` (int) - Number of TE slots
  - `roster_flex` (int) - Number of FLEX slots
  - `roster_k` (int) - Number of K slots
  - `roster_dst` (int) - Number of DST slots
  - `bench` (int) - Number of bench slots
  
  #### League Behavior
  - `allow_trades` (boolean) - Whether trades are enabled
  - `allow_pick_trades` (boolean) - Whether draft pick trades are enabled

  ## Security
  - Enable RLS on league_settings
  - SELECT: Authenticated users can view settings for any league
  - INSERT: Only authenticated users can create settings for their own leagues
  - UPDATE: Only league owners can update settings
  - DELETE: Only league owners can delete settings

  ## Triggers
  - Auto-update `updated_at` timestamp on row updates
*/

-- Create league_settings table
CREATE TABLE IF NOT EXISTS league_settings (
  league_id uuid PRIMARY KEY REFERENCES leagues(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  
  -- Draft settings
  draft_format text NOT NULL DEFAULT 'snake' CHECK (draft_format IN ('snake', 'linear')),
  pick_timer_seconds int NOT NULL DEFAULT 90 CHECK (pick_timer_seconds >= 0),
  allow_pauses boolean NOT NULL DEFAULT true,
  drafting_hours_enabled boolean NOT NULL DEFAULT false,
  drafting_hours_start time,
  drafting_hours_end time,
  
  -- Roster settings
  roster_qb int NOT NULL DEFAULT 1 CHECK (roster_qb >= 0),
  roster_rb int NOT NULL DEFAULT 2 CHECK (roster_rb >= 0),
  roster_wr int NOT NULL DEFAULT 2 CHECK (roster_wr >= 0),
  roster_te int NOT NULL DEFAULT 1 CHECK (roster_te >= 0),
  roster_flex int NOT NULL DEFAULT 1 CHECK (roster_flex >= 0),
  roster_k int NOT NULL DEFAULT 1 CHECK (roster_k >= 0),
  roster_dst int NOT NULL DEFAULT 1 CHECK (roster_dst >= 0),
  bench int NOT NULL DEFAULT 6 CHECK (bench >= 0),
  
  -- League behavior
  allow_trades boolean NOT NULL DEFAULT true,
  allow_pick_trades boolean NOT NULL DEFAULT true,
  
  -- Validate drafting hours if enabled
  CONSTRAINT valid_drafting_hours CHECK (
    NOT drafting_hours_enabled OR 
    (drafting_hours_start IS NOT NULL AND drafting_hours_end IS NOT NULL)
  )
);

-- Create updated_at trigger function if it doesn't exist
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add trigger to auto-update updated_at
DROP TRIGGER IF EXISTS update_league_settings_updated_at ON league_settings;
CREATE TRIGGER update_league_settings_updated_at
  BEFORE UPDATE ON league_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Enable RLS
ALTER TABLE league_settings ENABLE ROW LEVEL SECURITY;

-- SELECT: Authenticated users can view settings for any league
CREATE POLICY "Authenticated users can view league settings"
  ON league_settings
  FOR SELECT
  TO authenticated
  USING (true);

-- INSERT: Only league owners can create settings for their leagues
CREATE POLICY "League owners can create settings"
  ON league_settings
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = created_by AND
    EXISTS (
      SELECT 1 FROM leagues
      WHERE leagues.id = league_settings.league_id
      AND leagues.owner_id = auth.uid()
    )
  );

-- UPDATE: Only league owners can update settings
CREATE POLICY "League owners can update settings"
  ON league_settings
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM leagues
      WHERE leagues.id = league_settings.league_id
      AND leagues.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM leagues
      WHERE leagues.id = league_settings.league_id
      AND leagues.owner_id = auth.uid()
    )
  );

-- DELETE: Only league owners can delete settings
CREATE POLICY "League owners can delete settings"
  ON league_settings
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM leagues
      WHERE leagues.id = league_settings.league_id
      AND leagues.owner_id = auth.uid()
    )
  );
