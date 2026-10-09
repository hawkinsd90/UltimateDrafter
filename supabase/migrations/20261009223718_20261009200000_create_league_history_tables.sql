/*
# League History & Legacy — Phase 1 Schema

## Purpose
Creates the foundational database tables for importing and storing
historical fantasy football league data from ESPN (and eventually Sleeper).
This is a read-only archive of past seasons — it does NOT modify any
active league, roster, draft, trade, or member functionality.

## New Tables (8)

1. league_history_seasons
   One row per imported historical season per league.
   Stores season metadata, scoring/roster settings, and import status.

2. league_history_managers
   Permanent historical manager identity, independent of team IDs.
   A manager is a person who has owned teams across one or more seasons.
   Linked optionally to a UltimateDrafter user account.

3. league_history_manager_aliases
   Normalized mapping of provider-specific owner IDs to permanent managers.
   One manager can have multiple aliases (different ESPN accounts over the years).
   Enforced unique on (manager_id, provider, external_owner_id).

4. league_history_season_teams
   One row per team per historical season.
   Stores the ESPN team ID, team name, official W/L/T, points, playoff seed,
   and final standing for that specific season.
   Links to the permanent manager identity via manager_id.

5. league_history_team_managers
   Association table for co-managed teams.
   One row per (season_team_id, manager_id) pair.
   Distinguishes primary owner from co-managers.

6. league_history_matchups
   Weekly matchup results for a historical season.
   Stores home/away team IDs, scores, winner, matchup period, and classification.
   Supports null away_team_id for bye weeks.
   Unique on (season_id, source_matchup_id) to prevent duplicates.

7. league_history_drafts
   Draft metadata for a historical season.
   One draft per season. Stores draft type, number of rounds, and completion date.

8. league_history_draft_picks
   Individual draft picks from a historical draft.
   Stores overall pick number, round, player info, keeper flag, and auction data.
   Unique on (draft_id, overall_pick_number) to prevent duplicates.

9. league_history_import_runs
   Audit trail of import attempts.
   One row per import attempt (including failures).
   Records status, diagnostics, and timestamps.
   Never stores credentials.

## RLS Policies
All tables: league members can SELECT; only league owner can INSERT/UPDATE/DELETE.
This matches existing league-level RLS patterns.

## Indexes
- Foreign keys indexed for join performance
- Unique constraints on natural keys for idempotency
- Composite indexes for common query patterns

## Security
- RLS enabled on all tables
- No credentials stored anywhere
- Only league owner can modify historical data
- All members can view historical data
*/

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. league_history_seasons
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS league_history_seasons (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id           uuid NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  external_link_id    uuid REFERENCES external_league_links(id) ON DELETE SET NULL,
  season_year         integer NOT NULL,
  external_league_id  text NOT NULL,
  display_name        text NOT NULL,
  num_teams           integer NOT NULL DEFAULT 0,
  scoring_type        text NOT NULL DEFAULT 'custom',
  raw_settings        jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_scoring         jsonb NOT NULL DEFAULT '{}'::jsonb,
  import_status       text NOT NULL DEFAULT 'pending',
  import_completeness jsonb NOT NULL DEFAULT '{}'::jsonb,
  import_errors       jsonb NOT NULL DEFAULT '[]'::jsonb,
  imported_at         timestamptz,
  imported_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_history_seasons_league_year UNIQUE (league_id, season_year)
);

ALTER TABLE league_history_seasons ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_history_seasons_league_id ON league_history_seasons(league_id);
CREATE INDEX IF NOT EXISTS idx_history_seasons_external_link ON league_history_seasons(external_link_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. league_history_managers
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS league_history_managers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id       uuid NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  display_name    text NOT NULL,
  linked_user_id  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  is_active       boolean NOT NULL DEFAULT true,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_history_managers_league_name UNIQUE (league_id, display_name)
);

ALTER TABLE league_history_managers ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_history_managers_league_id ON league_history_managers(league_id);
CREATE INDEX IF NOT EXISTS idx_history_managers_linked_user ON league_history_managers(linked_user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. league_history_manager_aliases
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS league_history_manager_aliases (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  manager_id         uuid NOT NULL REFERENCES league_history_managers(id) ON DELETE CASCADE,
  provider           text NOT NULL DEFAULT 'espn',
  external_owner_id  text NOT NULL,
  display_name       text,
  first_season       integer,
  last_season        integer,
  match_method       text NOT NULL DEFAULT 'auto_id',
  match_confidence   real NOT NULL DEFAULT 1.0,
  confirmed_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  confirmed_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_history_aliases_manager_provider_owner UNIQUE (manager_id, provider, external_owner_id)
);

ALTER TABLE league_history_manager_aliases ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_history_aliases_manager_id ON league_history_manager_aliases(manager_id);
CREATE INDEX IF NOT EXISTS idx_history_aliases_provider_owner ON league_history_manager_aliases(provider, external_owner_id);
CREATE INDEX IF NOT EXISTS idx_history_aliases_league_via_manager ON league_history_manager_aliases(manager_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. league_history_season_teams
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS league_history_season_teams (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id         uuid NOT NULL REFERENCES league_history_seasons(id) ON DELETE CASCADE,
  league_id         uuid NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  external_team_id  text NOT NULL,
  team_name         text NOT NULL,
  team_abbrev       text,
  primary_manager_id uuid REFERENCES league_history_managers(id) ON DELETE SET NULL,
  wins              integer NOT NULL DEFAULT 0,
  losses            integer NOT NULL DEFAULT 0,
  ties              integer NOT NULL DEFAULT 0,
  points_for        numeric(12,2) NOT NULL DEFAULT 0,
  points_against    numeric(12,2) NOT NULL DEFAULT 0,
  playoff_seed      integer,
  final_standing    integer,
  is_champion       boolean NOT NULL DEFAULT false,
  is_runner_up      boolean NOT NULL DEFAULT false,
  eliminated        boolean NOT NULL DEFAULT false,
  elimination_period integer,
  raw_team_data     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_history_season_teams_season_ext UNIQUE (season_id, external_team_id)
);

ALTER TABLE league_history_season_teams ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_history_season_teams_season_id ON league_history_season_teams(season_id);
CREATE INDEX IF NOT EXISTS idx_history_season_teams_league_id ON league_history_season_teams(league_id);
CREATE INDEX IF NOT EXISTS idx_history_season_teams_manager ON league_history_season_teams(primary_manager_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. league_history_team_managers
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS league_history_team_managers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_team_id  uuid NOT NULL REFERENCES league_history_season_teams(id) ON DELETE CASCADE,
  manager_id      uuid NOT NULL REFERENCES league_history_managers(id) ON DELETE CASCADE,
  role            text NOT NULL DEFAULT 'primary',
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_history_team_managers_team_manager UNIQUE (season_team_id, manager_id)
);

ALTER TABLE league_history_team_managers ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_history_team_managers_season_team ON league_history_team_managers(season_team_id);
CREATE INDEX IF NOT EXISTS idx_history_team_managers_manager ON league_history_team_managers(manager_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. league_history_matchups
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS league_history_matchups (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id         uuid NOT NULL REFERENCES league_history_seasons(id) ON DELETE CASCADE,
  league_id         uuid NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  source_matchup_id integer NOT NULL,
  matchup_period    integer NOT NULL,
  classification    text NOT NULL DEFAULT 'regular',
  home_team_id      uuid REFERENCES league_history_season_teams(id) ON DELETE SET NULL,
  away_team_id      uuid REFERENCES league_history_season_teams(id) ON DELETE SET NULL,
  home_score        numeric(12,2),
  away_score        numeric(12,2),
  winner            text,
  raw_matchup_data  jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_history_matchups_season_source UNIQUE (season_id, source_matchup_id)
);

ALTER TABLE league_history_matchups ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_history_matchups_season_id ON league_history_matchups(season_id);
CREATE INDEX IF NOT EXISTS idx_history_matchups_league_id ON league_history_matchups(league_id);
CREATE INDEX IF NOT EXISTS idx_history_matchups_period ON league_history_matchups(season_id, matchup_period);
CREATE INDEX IF NOT EXISTS idx_history_matchups_home ON league_history_matchups(home_team_id);
CREATE INDEX IF NOT EXISTS idx_history_matchups_away ON league_history_matchups(away_team_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. league_history_drafts
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS league_history_drafts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id         uuid NOT NULL REFERENCES league_history_seasons(id) ON DELETE CASCADE,
  league_id         uuid NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  draft_type        text NOT NULL DEFAULT 'snake',
  num_rounds        integer NOT NULL DEFAULT 0,
  num_picks         integer NOT NULL DEFAULT 0,
  completed_at      timestamptz,
  raw_draft_detail  jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_history_drafts_season UNIQUE (season_id)
);

ALTER TABLE league_history_drafts ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_history_drafts_season_id ON league_history_drafts(season_id);
CREATE INDEX IF NOT EXISTS idx_history_drafts_league_id ON league_history_drafts(league_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. league_history_draft_picks
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS league_history_draft_picks (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id            uuid NOT NULL REFERENCES league_history_drafts(id) ON DELETE CASCADE,
  season_id           uuid NOT NULL REFERENCES league_history_seasons(id) ON DELETE CASCADE,
  league_id           uuid NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  overall_pick_number integer NOT NULL,
  round_number        integer NOT NULL,
  round_pick_number   integer,
  team_id             uuid REFERENCES league_history_season_teams(id) ON DELETE SET NULL,
  external_team_id   text,
  external_player_id  text,
  player_name         text,
  player_position     text,
  is_keeper           boolean NOT NULL DEFAULT false,
  auction_bid_amount  integer,
  raw_pick_data       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_history_draft_picks_draft_overall UNIQUE (draft_id, overall_pick_number)
);

ALTER TABLE league_history_draft_picks ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_history_draft_picks_draft_id ON league_history_draft_picks(draft_id);
CREATE INDEX IF NOT EXISTS idx_history_draft_picks_season_id ON league_history_draft_picks(season_id);
CREATE INDEX IF NOT EXISTS idx_history_draft_picks_league_id ON league_history_draft_picks(league_id);
CREATE INDEX IF NOT EXISTS idx_history_draft_picks_team ON league_history_draft_picks(team_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. league_history_import_runs
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS league_history_import_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id       uuid NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  season_id       uuid REFERENCES league_history_seasons(id) ON DELETE SET NULL,
  season_year     integer NOT NULL,
  provider        text NOT NULL DEFAULT 'espn',
  external_league_id text NOT NULL,
  status          text NOT NULL DEFAULT 'running',
  diagnostics     jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message   text,
  started_by      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  started_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  CONSTRAINT ck_import_runs_status CHECK (status IN ('running', 'success', 'partial', 'failed'))
);

ALTER TABLE league_history_import_runs ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_history_import_runs_league_id ON league_history_import_runs(league_id);
CREATE INDEX IF NOT EXISTS idx_history_import_runs_season_id ON league_history_import_runs(season_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS Policies
-- All history tables: league members can SELECT, only league owner can modify.
-- The membership check uses an EXISTS subquery against league_members
-- (for authenticated users who joined the league) OR leagues.owner_id
-- (for the league owner). This matches the existing RLS pattern.
-- ─────────────────────────────────────────────────────────────────────────────

-- Helper function: check if the current user is the owner of a league
CREATE OR REPLACE FUNCTION is_league_owner(p_league_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM leagues
    WHERE id = p_league_id AND owner_id = auth.uid()
  );
$$;

-- Helper function: check if the current user is a member of a league
CREATE OR REPLACE FUNCTION is_league_member(p_league_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM leagues WHERE id = p_league_id AND owner_id = auth.uid()
  ) OR EXISTS (
    SELECT 1 FROM league_members
    WHERE league_id = p_league_id AND user_id = auth.uid()
  );
$$;

-- ── league_history_seasons ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "select_history_seasons" ON league_history_seasons;
CREATE POLICY "select_history_seasons" ON league_history_seasons
  FOR SELECT TO authenticated
  USING (is_league_member(league_id));

DROP POLICY IF EXISTS "insert_history_seasons" ON league_history_seasons;
CREATE POLICY "insert_history_seasons" ON league_history_seasons
  FOR INSERT TO authenticated
  WITH CHECK (is_league_owner(league_id));

DROP POLICY IF EXISTS "update_history_seasons" ON league_history_seasons;
CREATE POLICY "update_history_seasons" ON league_history_seasons
  FOR UPDATE TO authenticated
  USING (is_league_owner(league_id))
  WITH CHECK (is_league_owner(league_id));

DROP POLICY IF EXISTS "delete_history_seasons" ON league_history_seasons;
CREATE POLICY "delete_history_seasons" ON league_history_seasons
  FOR DELETE TO authenticated
  USING (is_league_owner(league_id));

-- ── league_history_managers ─────────────────────────────────────────────────
DROP POLICY IF EXISTS "select_history_managers" ON league_history_managers;
CREATE POLICY "select_history_managers" ON league_history_managers
  FOR SELECT TO authenticated
  USING (is_league_member(league_id));

DROP POLICY IF EXISTS "insert_history_managers" ON league_history_managers;
CREATE POLICY "insert_history_managers" ON league_history_managers
  FOR INSERT TO authenticated
  WITH CHECK (is_league_owner(league_id));

DROP POLICY IF EXISTS "update_history_managers" ON league_history_managers;
CREATE POLICY "update_history_managers" ON league_history_managers
  FOR UPDATE TO authenticated
  USING (is_league_owner(league_id))
  WITH CHECK (is_league_owner(league_id));

DROP POLICY IF EXISTS "delete_history_managers" ON league_history_managers;
CREATE POLICY "delete_history_managers" ON league_history_managers
  FOR DELETE TO authenticated
  USING (is_league_owner(league_id));

-- ── league_history_manager_aliases ──────────────────────────────────────────
DROP POLICY IF EXISTS "select_history_aliases" ON league_history_manager_aliases;
CREATE POLICY "select_history_aliases" ON league_history_manager_aliases
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM league_history_managers m
      WHERE m.id = manager_id AND is_league_member(m.league_id)
    )
  );

DROP POLICY IF EXISTS "insert_history_aliases" ON league_history_manager_aliases;
CREATE POLICY "insert_history_aliases" ON league_history_manager_aliases
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM league_history_managers m
      WHERE m.id = manager_id AND is_league_owner(m.league_id)
    )
  );

DROP POLICY IF EXISTS "update_history_aliases" ON league_history_manager_aliases;
CREATE POLICY "update_history_aliases" ON league_history_manager_aliases
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM league_history_managers m
      WHERE m.id = manager_id AND is_league_owner(m.league_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM league_history_managers m
      WHERE m.id = manager_id AND is_league_owner(m.league_id)
    )
  );

DROP POLICY IF EXISTS "delete_history_aliases" ON league_history_manager_aliases;
CREATE POLICY "delete_history_aliases" ON league_history_manager_aliases
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM league_history_managers m
      WHERE m.id = manager_id AND is_league_owner(m.league_id)
    )
  );

-- ── league_history_season_teams ─────────────────────────────────────────────
DROP POLICY IF EXISTS "select_history_season_teams" ON league_history_season_teams;
CREATE POLICY "select_history_season_teams" ON league_history_season_teams
  FOR SELECT TO authenticated
  USING (is_league_member(league_id));

DROP POLICY IF EXISTS "insert_history_season_teams" ON league_history_season_teams;
CREATE POLICY "insert_history_season_teams" ON league_history_season_teams
  FOR INSERT TO authenticated
  WITH CHECK (is_league_owner(league_id));

DROP POLICY IF EXISTS "update_history_season_teams" ON league_history_season_teams;
CREATE POLICY "update_history_season_teams" ON league_history_season_teams
  FOR UPDATE TO authenticated
  USING (is_league_owner(league_id))
  WITH CHECK (is_league_owner(league_id));

DROP POLICY IF EXISTS "delete_history_season_teams" ON league_history_season_teams;
CREATE POLICY "delete_history_season_teams" ON league_history_season_teams
  FOR DELETE TO authenticated
  USING (is_league_owner(league_id));

-- ── league_history_team_managers ────────────────────────────────────────────
DROP POLICY IF EXISTS "select_history_team_managers" ON league_history_team_managers;
CREATE POLICY "select_history_team_managers" ON league_history_team_managers
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM league_history_season_teams st
      WHERE st.id = season_team_id AND is_league_member(st.league_id)
    )
  );

DROP POLICY IF EXISTS "insert_history_team_managers" ON league_history_team_managers;
CREATE POLICY "insert_history_team_managers" ON league_history_team_managers
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM league_history_season_teams st
      WHERE st.id = season_team_id AND is_league_owner(st.league_id)
    )
  );

DROP POLICY IF EXISTS "delete_history_team_managers" ON league_history_team_managers;
CREATE POLICY "delete_history_team_managers" ON league_history_team_managers
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM league_history_season_teams st
      WHERE st.id = season_team_id AND is_league_owner(st.league_id)
    )
  );

-- ── league_history_matchups ─────────────────────────────────────────────────
DROP POLICY IF EXISTS "select_history_matchups" ON league_history_matchups;
CREATE POLICY "select_history_matchups" ON league_history_matchups
  FOR SELECT TO authenticated
  USING (is_league_member(league_id));

DROP POLICY IF EXISTS "insert_history_matchups" ON league_history_matchups;
CREATE POLICY "insert_history_matchups" ON league_history_matchups
  FOR INSERT TO authenticated
  WITH CHECK (is_league_owner(league_id));

DROP POLICY IF EXISTS "delete_history_matchups" ON league_history_matchups;
CREATE POLICY "delete_history_matchups" ON league_history_matchups
  FOR DELETE TO authenticated
  USING (is_league_owner(league_id));

-- ── league_history_drafts ───────────────────────────────────────────────────
DROP POLICY IF EXISTS "select_history_drafts" ON league_history_drafts;
CREATE POLICY "select_history_drafts" ON league_history_drafts
  FOR SELECT TO authenticated
  USING (is_league_member(league_id));

DROP POLICY IF EXISTS "insert_history_drafts" ON league_history_drafts;
CREATE POLICY "insert_history_drafts" ON league_history_drafts
  FOR INSERT TO authenticated
  WITH CHECK (is_league_owner(league_id));

DROP POLICY IF EXISTS "delete_history_drafts" ON league_history_drafts;
CREATE POLICY "delete_history_drafts" ON league_history_drafts
  FOR DELETE TO authenticated
  USING (is_league_owner(league_id));

-- ── league_history_draft_picks ──────────────────────────────────────────────
DROP POLICY IF EXISTS "select_history_draft_picks" ON league_history_draft_picks;
CREATE POLICY "select_history_draft_picks" ON league_history_draft_picks
  FOR SELECT TO authenticated
  USING (is_league_member(league_id));

DROP POLICY IF EXISTS "insert_history_draft_picks" ON league_history_draft_picks;
CREATE POLICY "insert_history_draft_picks" ON league_history_draft_picks
  FOR INSERT TO authenticated
  WITH CHECK (is_league_owner(league_id));

DROP POLICY IF EXISTS "delete_history_draft_picks" ON league_history_draft_picks;
CREATE POLICY "delete_history_draft_picks" ON league_history_draft_picks
  FOR DELETE TO authenticated
  USING (is_league_owner(league_id));

-- ── league_history_import_runs ──────────────────────────────────────────────
DROP POLICY IF EXISTS "select_history_import_runs" ON league_history_import_runs;
CREATE POLICY "select_history_import_runs" ON league_history_import_runs
  FOR SELECT TO authenticated
  USING (is_league_member(league_id));

DROP POLICY IF EXISTS "insert_history_import_runs" ON league_history_import_runs;
CREATE POLICY "insert_history_import_runs" ON league_history_import_runs
  FOR INSERT TO authenticated
  WITH CHECK (is_league_owner(league_id));

DROP POLICY IF EXISTS "update_history_import_runs" ON league_history_import_runs;
CREATE POLICY "update_history_import_runs" ON league_history_import_runs
  FOR UPDATE TO authenticated
  USING (is_league_owner(league_id))
  WITH CHECK (is_league_owner(league_id));

-- ─────────────────────────────────────────────────────────────────────────────
-- Enable realtime for history tables so the UI updates when imports complete
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE league_history_seasons REPLICA IDENTITY FULL;
ALTER TABLE league_history_season_teams REPLICA IDENTITY FULL;
ALTER TABLE league_history_matchups REPLICA IDENTITY FULL;
ALTER TABLE league_history_drafts REPLICA IDENTITY FULL;
ALTER TABLE league_history_draft_picks REPLICA IDENTITY FULL;
ALTER TABLE league_history_managers REPLICA IDENTITY FULL;
ALTER TABLE league_history_manager_aliases REPLICA IDENTITY FULL;
ALTER TABLE league_history_import_runs REPLICA IDENTITY FULL;

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE league_history_seasons;
  EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE league_history_season_teams;
  EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE league_history_matchups;
  EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE league_history_drafts;
  EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE league_history_draft_picks;
  EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE league_history_managers;
  EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE league_history_manager_aliases;
  EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE league_history_import_runs;
  EXCEPTION WHEN OTHERS THEN NULL; END;
END $$;
