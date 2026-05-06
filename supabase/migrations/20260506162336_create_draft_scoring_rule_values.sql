/*
  # Create draft_scoring_rule_values table

  ## Purpose
  Stores the normalized, canonical representation of scoring rules imported
  from external leagues (ESPN, Sleeper). Where draft_scoring_rules stores the
  raw provider JSON blob, this table stores one row per meaningful scoring event,
  using canonical stat_key names that are provider-agnostic.

  This canonical representation is the bridge between:
  - ESPN scoring (statId-based array)
  - Sleeper scoring (key-value map like {"rec": 1, "pass_yd": 0.04})
  - player_season_stats columns (canonical column names)

  Enabling Phase 3 fantasy point calculation as a straightforward dot-product:
    SUM(stat_value * points_per_unit) for each matching canonical stat_key.

  ## Columns
  - `draft_scoring_rule_id` — FK to draft_scoring_rules row being normalized
  - `provider` — source provider ('espn', 'sleeper') for debugging
  - `stat_key` — canonical stat name (e.g. 'passing_yards', 'receptions')
  - `provider_stat_id` — ESPN statId as text (e.g. '53') — null for Sleeper
  - `provider_stat_key` — Sleeper key (e.g. 'rec') — null for ESPN
  - `points_per_unit` — fantasy points awarded per 1 unit of this stat
  - `threshold_min` — for tiered stats (e.g. DST pts allowed), minimum of range
  - `threshold_max` — for tiered stats, maximum of range (null = open-ended)
  - `is_tiered` — true when this row represents one tier of a tiered stat
  - `raw_item` — the original provider JSON item for debugging

  ## Uniqueness strategy
  The unique constraint needs to handle:
  1. Normal stats: one row per (rule, stat_key) — threshold_min/max are null
  2. Tiered stats: multiple rows per stat_key, one per tier — threshold_min differs

  Using a partial index approach:
  - For non-tiered rows (is_tiered = false): unique on (draft_scoring_rule_id, stat_key)
  - For tiered rows (is_tiered = true): unique on (draft_scoring_rule_id, stat_key, threshold_min)

  This avoids the Postgres null-distinctness problem with threshold_min in a
  single unique constraint (two null threshold_min values would not collide,
  causing phantom duplicates for normal stats).

  ## Security
  RLS enabled. SELECT granted to authenticated users who belong to the draft's
  league. INSERT/UPDATE/DELETE restricted to service_role (sync functions use
  service_role key).
*/

CREATE TABLE IF NOT EXISTS draft_scoring_rule_values (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_scoring_rule_id uuid NOT NULL
    REFERENCES draft_scoring_rules(id) ON DELETE CASCADE,
  provider              text NOT NULL,
  stat_key              text NOT NULL,
  provider_stat_id      text,
  provider_stat_key     text,
  points_per_unit       numeric NOT NULL,
  threshold_min         numeric,
  threshold_max         numeric,
  is_tiered             boolean NOT NULL DEFAULT false,
  raw_item              jsonb,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- Partial unique index for non-tiered rows: one row per canonical stat per ruleset
CREATE UNIQUE INDEX IF NOT EXISTS draft_scoring_rule_values_normal_unique
  ON draft_scoring_rule_values (draft_scoring_rule_id, stat_key)
  WHERE is_tiered = false;

-- Partial unique index for tiered rows: one row per tier per canonical stat per ruleset
CREATE UNIQUE INDEX IF NOT EXISTS draft_scoring_rule_values_tiered_unique
  ON draft_scoring_rule_values (draft_scoring_rule_id, stat_key, threshold_min)
  WHERE is_tiered = true;

-- Lookup index for joins from player_rankings calculation
CREATE INDEX IF NOT EXISTS idx_draft_scoring_rule_values_rule
  ON draft_scoring_rule_values (draft_scoring_rule_id);

-- Enable RLS
ALTER TABLE draft_scoring_rule_values ENABLE ROW LEVEL SECURITY;

-- SELECT: authenticated users who are a participant or owner of the associated draft
CREATE POLICY "Authenticated users can read scoring rule values for their drafts"
  ON draft_scoring_rule_values
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM draft_scoring_rules dsr
      JOIN draft_participants dp ON dp.draft_id = dsr.draft_id
      WHERE dsr.id = draft_scoring_rule_values.draft_scoring_rule_id
        AND dp.user_id = auth.uid()
    )
    OR
    EXISTS (
      SELECT 1
      FROM draft_scoring_rules dsr
      JOIN drafts d ON d.id = dsr.draft_id
      JOIN leagues l ON l.id = d.league_id
      WHERE dsr.id = draft_scoring_rule_values.draft_scoring_rule_id
        AND l.owner_id = auth.uid()
    )
  );

-- INSERT/UPDATE/DELETE: only service_role (edge functions use service_role key)
-- No explicit policies needed — with RLS enabled and no INSERT policy for
-- authenticated, inserts from the client are blocked. Service_role bypasses RLS.
