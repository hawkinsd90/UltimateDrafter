/*
  # Create player_season_stats table

  ## Purpose
  Stores aggregated season-level NFL player stats synced from Sleeper's weekly
  stats API. Used in Phase 3 to calculate fantasy points by joining these stats
  against draft_scoring_rule_values (canonical stat keys).

  Stats are aggregated by summing all regular-season weekly values per player.

  ## Provider notes
  - Sleeper: bulk weekly endpoint returns all players keyed by player_id (string).
    DST teams use string keys like "TEAM_BUF" instead of numeric IDs.
    Zero-value stats are omitted entirely from the API response.
  - All stat columns are numeric (float in Sleeper), nullable (player may not
    have played or may not have stats in a given category).

  ## Columns — matches canonical stat_key names in draft_scoring_rule_values
  All numeric columns use the same names as the canonical stat_key values so
  Phase 3 can join directly by column name reflection or a simple CASE mapping.

  ## Uniqueness
  One row per (sports_player_id, provider, season, stat_type).
  Upserted on re-sync — updated_at reflects last sync time.

  ## Security
  RLS enabled. SELECT for all authenticated users (stats are not sensitive).
  INSERT/UPDATE/DELETE only via service_role (edge functions).
*/

CREATE TABLE IF NOT EXISTS player_season_stats (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sports_player_id     uuid NOT NULL REFERENCES sports_players(id) ON DELETE CASCADE,
  provider             text NOT NULL,
  provider_player_id   text,
  season               integer NOT NULL,
  stat_type            text NOT NULL DEFAULT 'regular_season',
  games                numeric,

  -- Passing
  passing_yards        numeric,
  passing_tds          numeric,
  passing_ints         numeric,
  passing_2pt          numeric,

  -- Rushing
  rushing_yards        numeric,
  rushing_tds          numeric,
  rushing_2pt          numeric,

  -- Receiving
  receptions           numeric,
  receiving_yards      numeric,
  receiving_tds        numeric,
  receiving_2pt        numeric,

  -- Misc offense
  fumbles_lost         numeric,
  return_tds           numeric,

  -- Kicking
  fg_made_0_39         numeric,
  fg_made_40_49        numeric,
  fg_made_50_plus      numeric,
  fg_missed            numeric,
  xp_made              numeric,
  xp_missed            numeric,

  -- Defense / Special Teams
  sacks                numeric,
  def_interceptions    numeric,
  fumble_recoveries    numeric,
  def_tds              numeric,
  safeties             numeric,
  blocks               numeric,
  points_allowed       numeric,
  yards_allowed        numeric,

  -- Raw provider data for debugging / future stat additions
  raw_data             jsonb,

  synced_at            timestamptz NOT NULL DEFAULT now(),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT player_season_stats_unique
    UNIQUE (sports_player_id, provider, season, stat_type),

  CONSTRAINT player_season_stats_provider_check
    CHECK (provider IN ('sleeper', 'espn', 'nflfastr')),

  CONSTRAINT player_season_stats_stat_type_check
    CHECK (stat_type IN ('regular_season', 'postseason', 'full_season'))
);

-- Lookup by player (most common query pattern)
CREATE INDEX IF NOT EXISTS idx_player_season_stats_player
  ON player_season_stats (sports_player_id);

-- Lookup by season + type (sync and calculation queries)
CREATE INDEX IF NOT EXISTS idx_player_season_stats_season
  ON player_season_stats (provider, season, stat_type);

-- Enable RLS
ALTER TABLE player_season_stats ENABLE ROW LEVEL SECURITY;

-- SELECT: all authenticated users (stats are not sensitive data)
CREATE POLICY "Authenticated users can read player season stats"
  ON player_season_stats
  FOR SELECT
  TO authenticated
  USING (true);

-- No INSERT/UPDATE/DELETE policies — only service_role (used by edge functions)
-- bypasses RLS, so no explicit policy needed for writes.
