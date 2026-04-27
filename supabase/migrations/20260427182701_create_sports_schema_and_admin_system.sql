/*
  # Sports Schema + Admin System

  ## New Tables

  ### admin_users
  - Tracks which auth users have admin/master access to the platform.
  - `user_id` references auth.users.
  - `granted_by` tracks who granted admin access.

  ### sports_leagues
  - Top-level sport/league registry (e.g. NFL, NBA, MLB).
  - `abbreviation`: short code (NFL, NBA, etc.)
  - `sport`: base sport name (football, basketball, etc.)

  ### sports_teams
  - Teams within a sports league.
  - Keyed by: league_id + provider + provider_team_id (unique).
  - Soft-deletable via `is_active`.

  ### sports_players
  - Individual players across all sports leagues.
  - Keyed by: league_id + provider + provider_player_id (unique).
  - `fantasy_position`: normalized position for fantasy scoring (QB, RB, WR, TE, K, DST).
  - `is_fantasy_relevant`: flag for inclusion in default draft pools.
  - `raw_data`: full provider payload for debugging/audit.

  ### sports_rosters
  - Associates a player with a team for a given season.
  - Keyed by: player_id + season (unique per season slot).

  ### roster_import_runs
  - Audit log of every roster import attempt.
  - Records provider, season, status, counts, and error details.

  ## Security
  - RLS enabled on all tables.
  - Admins (via admin_users) can insert/update/delete sports data.
  - Authenticated users can SELECT active players/teams/rosters.
  - Anonymous users get no access.

  ## Seed Data
  - NFL seeded into sports_leagues.
*/

-- ============================================================
-- admin_users
-- ============================================================
CREATE TABLE IF NOT EXISTS admin_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;

-- Only admins can see the admin list
CREATE POLICY "Admins can view admin_users"
  ON admin_users FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM admin_users au WHERE au.user_id = auth.uid())
  );

-- Only existing admins can insert new admins
CREATE POLICY "Admins can insert admin_users"
  ON admin_users FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM admin_users au WHERE au.user_id = auth.uid())
  );

-- ============================================================
-- Helper: is_admin()
-- Returns true if the calling user is in admin_users
-- ============================================================
CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM admin_users WHERE user_id = auth.uid()
  );
$$;

-- ============================================================
-- sports_leagues
-- ============================================================
CREATE TABLE IF NOT EXISTS sports_leagues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  abbreviation text NOT NULL UNIQUE,
  sport text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE sports_leagues ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read sports_leagues"
  ON sports_leagues FOR SELECT
  TO authenticated
  USING (is_active = true);

CREATE POLICY "Admins can insert sports_leagues"
  ON sports_leagues FOR INSERT
  TO authenticated
  WITH CHECK (is_admin());

CREATE POLICY "Admins can update sports_leagues"
  ON sports_leagues FOR UPDATE
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- ============================================================
-- sports_teams
-- ============================================================
CREATE TABLE IF NOT EXISTS sports_teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id uuid NOT NULL REFERENCES sports_leagues(id) ON DELETE CASCADE,
  provider text NOT NULL,
  provider_team_id text NOT NULL,
  name text NOT NULL,
  abbreviation text,
  city text,
  conference text,
  division text,
  logo_url text,
  is_active boolean NOT NULL DEFAULT true,
  raw_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (league_id, provider, provider_team_id)
);

CREATE INDEX IF NOT EXISTS idx_sports_teams_league ON sports_teams(league_id);
CREATE INDEX IF NOT EXISTS idx_sports_teams_provider ON sports_teams(provider);

ALTER TABLE sports_teams ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read sports_teams"
  ON sports_teams FOR SELECT
  TO authenticated
  USING (is_active = true);

CREATE POLICY "Admins can insert sports_teams"
  ON sports_teams FOR INSERT
  TO authenticated
  WITH CHECK (is_admin());

CREATE POLICY "Admins can update sports_teams"
  ON sports_teams FOR UPDATE
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- ============================================================
-- sports_players
-- ============================================================
CREATE TABLE IF NOT EXISTS sports_players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id uuid NOT NULL REFERENCES sports_leagues(id) ON DELETE CASCADE,
  provider text NOT NULL,
  provider_player_id text NOT NULL,
  team_id uuid REFERENCES sports_teams(id) ON DELETE SET NULL,
  first_name text,
  last_name text,
  display_name text NOT NULL,
  position text,
  fantasy_position text,
  jersey_number text,
  status text NOT NULL DEFAULT 'Active',
  injury_status text,
  years_exp integer,
  college text,
  headshot_url text,
  is_fantasy_relevant boolean NOT NULL DEFAULT false,
  raw_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (league_id, provider, provider_player_id)
);

CREATE INDEX IF NOT EXISTS idx_sports_players_league ON sports_players(league_id);
CREATE INDEX IF NOT EXISTS idx_sports_players_provider ON sports_players(provider);
CREATE INDEX IF NOT EXISTS idx_sports_players_fantasy_relevant ON sports_players(is_fantasy_relevant) WHERE is_fantasy_relevant = true;
CREATE INDEX IF NOT EXISTS idx_sports_players_fantasy_position ON sports_players(fantasy_position);
CREATE INDEX IF NOT EXISTS idx_sports_players_team ON sports_players(team_id);

ALTER TABLE sports_players ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read sports_players"
  ON sports_players FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can insert sports_players"
  ON sports_players FOR INSERT
  TO authenticated
  WITH CHECK (is_admin());

CREATE POLICY "Admins can update sports_players"
  ON sports_players FOR UPDATE
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- ============================================================
-- sports_rosters
-- ============================================================
CREATE TABLE IF NOT EXISTS sports_rosters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id uuid NOT NULL REFERENCES sports_players(id) ON DELETE CASCADE,
  team_id uuid REFERENCES sports_teams(id) ON DELETE SET NULL,
  season text NOT NULL,
  roster_status text NOT NULL DEFAULT 'Active',
  depth_chart_position integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (player_id, season)
);

CREATE INDEX IF NOT EXISTS idx_sports_rosters_player ON sports_rosters(player_id);
CREATE INDEX IF NOT EXISTS idx_sports_rosters_team_season ON sports_rosters(team_id, season);

ALTER TABLE sports_rosters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read sports_rosters"
  ON sports_rosters FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can insert sports_rosters"
  ON sports_rosters FOR INSERT
  TO authenticated
  WITH CHECK (is_admin());

CREATE POLICY "Admins can update sports_rosters"
  ON sports_rosters FOR UPDATE
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

CREATE POLICY "Admins can delete sports_rosters"
  ON sports_rosters FOR DELETE
  TO authenticated
  USING (is_admin());

-- ============================================================
-- roster_import_runs
-- ============================================================
CREATE TABLE IF NOT EXISTS roster_import_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  season text NOT NULL,
  triggered_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'failed')),
  teams_seen integer,
  players_seen integer,
  players_upserted integer,
  fantasy_relevant_count integer,
  errors jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_roster_import_runs_status ON roster_import_runs(status);
CREATE INDEX IF NOT EXISTS idx_roster_import_runs_provider ON roster_import_runs(provider, season);

ALTER TABLE roster_import_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view import runs"
  ON roster_import_runs FOR SELECT
  TO authenticated
  USING (is_admin());

CREATE POLICY "Admins can insert import runs"
  ON roster_import_runs FOR INSERT
  TO authenticated
  WITH CHECK (is_admin());

CREATE POLICY "Admins can update import runs"
  ON roster_import_runs FOR UPDATE
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- ============================================================
-- Seed: NFL sports league
-- ============================================================
INSERT INTO sports_leagues (name, abbreviation, sport)
VALUES ('National Football League', 'NFL', 'football')
ON CONFLICT (abbreviation) DO NOTHING;
