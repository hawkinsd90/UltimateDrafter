/*
  # Create player_rankings table

  ## Purpose
  Flexible per-player ranking storage supporting multiple providers (ESPN, Sleeper,
  FantasyPros, manual), multiple scoring formats (standard, half_ppr, ppr, any),
  multiple seasons, and multiple ranking types (draft_rank, ecr, search_rank, adp,
  last_season_points, trending).

  ## New Tables
  - `player_rankings`
    - `sports_player_id` — FK to sports_players
    - `provider` — 'espn' | 'sleeper' | 'fantasypros' | 'manual'
    - `scoring_format` — 'standard' | 'half_ppr' | 'ppr' | 'any'
    - `season` — NFL season year
    - `ranking_type` — 'draft_rank' | 'ecr' | 'search_rank' | 'adp' | 'last_season_points' | 'trending'
    - `overall_rank` — integer rank (lower = better)
    - `position_rank` — integer position rank (lower = better)
    - `position_rank_label` — string label e.g. "RB3" from FantasyPros
    - `fantasy_points` — numeric points (for last_season_points)
    - `adp` — average draft position (numeric, lower = earlier)
    - `auction_value` — average auction value
    - `percent_owned` — percent owned across platform
    - `trend_count` — add/drop count for trending
    - `position` — position string for cross-check
    - `source_label` — human label e.g. "ESPN Draft Ranks PPR 2026"
    - `source_url` — source URL for audit trail
    - `raw_data` — full provider response for debugging/future fields
    - `synced_at` — when this row was last synced from provider

  ## Unique Constraint
  - (sports_player_id, provider, scoring_format, season, ranking_type)
    Allows one row per player per provider per format per season per type.
    ESPN can have both draft_rank and adp rows.

  ## Security
  - RLS enabled
  - SELECT: all authenticated users
  - INSERT/UPDATE/DELETE: admin only (via is_admin() function)

  ## Indexes
  - (provider, scoring_format, season, ranking_type, overall_rank) — primary sort
  - (provider, scoring_format, season, ranking_type, position, position_rank) — position sort
  - (sports_player_id) — join from pool
  - partial on overall_rank IS NOT NULL — skip unranked rows in rank-sorted queries
*/

CREATE TABLE IF NOT EXISTS player_rankings (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  sports_player_id    uuid        NOT NULL REFERENCES sports_players(id) ON DELETE CASCADE,
  provider            text        NOT NULL,
  scoring_format      text        NOT NULL,
  season              integer     NOT NULL,
  ranking_type        text        NOT NULL,
  overall_rank        integer,
  position_rank       integer,
  position_rank_label text,
  fantasy_points      numeric,
  adp                 numeric,
  auction_value       numeric,
  percent_owned       numeric,
  trend_count         integer,
  position            text,
  source_label        text,
  source_url          text,
  raw_data            jsonb,
  synced_at           timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT player_rankings_unique
    UNIQUE (sports_player_id, provider, scoring_format, season, ranking_type),

  CONSTRAINT player_rankings_provider_check
    CHECK (provider IN ('espn', 'sleeper', 'fantasypros', 'manual')),

  CONSTRAINT player_rankings_scoring_format_check
    CHECK (scoring_format IN ('standard', 'half_ppr', 'ppr', 'any')),

  CONSTRAINT player_rankings_ranking_type_check
    CHECK (ranking_type IN ('draft_rank', 'ecr', 'search_rank', 'adp', 'last_season_points', 'trending')),

  CONSTRAINT player_rankings_overall_rank_positive
    CHECK (overall_rank IS NULL OR overall_rank >= 1),

  CONSTRAINT player_rankings_position_rank_positive
    CHECK (position_rank IS NULL OR position_rank >= 1)
);

-- Sort by overall rank for a given provider/format/season/type
CREATE INDEX IF NOT EXISTS idx_player_rankings_sort_overall
  ON player_rankings (provider, scoring_format, season, ranking_type, overall_rank ASC NULLS LAST);

-- Sort by position rank within a position
CREATE INDEX IF NOT EXISTS idx_player_rankings_sort_position
  ON player_rankings (provider, scoring_format, season, ranking_type, position, position_rank ASC NULLS LAST);

-- Join from player pool side
CREATE INDEX IF NOT EXISTS idx_player_rankings_player
  ON player_rankings (sports_player_id);

-- Partial index: only ranked rows for overall sorts
CREATE INDEX IF NOT EXISTS idx_player_rankings_overall_not_null
  ON player_rankings (provider, scoring_format, season, ranking_type, overall_rank)
  WHERE overall_rank IS NOT NULL;

-- Partial index: only ranked rows for position sorts
CREATE INDEX IF NOT EXISTS idx_player_rankings_position_rank_not_null
  ON player_rankings (provider, scoring_format, season, ranking_type, position, position_rank)
  WHERE position_rank IS NOT NULL;

ALTER TABLE player_rankings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read player rankings"
  ON player_rankings FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can insert player rankings"
  ON player_rankings FOR INSERT
  TO authenticated
  WITH CHECK (is_admin());

CREATE POLICY "Admins can update player rankings"
  ON player_rankings FOR UPDATE
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

CREATE POLICY "Admins can delete player rankings"
  ON player_rankings FOR DELETE
  TO authenticated
  USING (is_admin());
