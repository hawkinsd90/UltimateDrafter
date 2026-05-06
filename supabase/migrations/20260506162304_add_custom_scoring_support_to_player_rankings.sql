/*
  # Add custom/league-specific scoring support to player_rankings

  ## Purpose
  Extend player_rankings to support league-specific last-season fantasy point
  rankings, where two imported leagues can have different custom scoring rules
  and must store separate ranking rows without collision.

  ## Changes

  ### New column
  - `draft_scoring_rule_id` (uuid, nullable) — FK to draft_scoring_rules.
    NULL for all global/provider rankings (Sleeper, ESPN, FantasyPros).
    Non-NULL only for league-specific last_season_points rows.

  ### Updated check constraint
  - `scoring_format` now allows 'custom' in addition to existing values.
    Custom is used when scoring rules come from an imported league.

  ### Updated uniqueness
  The old single unique constraint `(sports_player_id, provider, scoring_format,
  season, ranking_type)` is replaced with two partial unique indexes:

  1. Global rows (draft_scoring_rule_id IS NULL):
     UNIQUE (sports_player_id, provider, scoring_format, season, ranking_type)
     — Same semantics as before, no collision risk for existing rows.

  2. League-custom rows (draft_scoring_rule_id IS NOT NULL):
     UNIQUE (sports_player_id, draft_scoring_rule_id, ranking_type)
     — Each league's custom ranking set is scoped to its scoring rule row.
     Two leagues with different scoring rules each get their own set.

  ## Safety
  - All existing rows have draft_scoring_rule_id = NULL and are covered by
    partial index #1. No existing data is affected.
  - The old unique constraint is dropped and replaced. The drop is safe because
    the new partial index #1 enforces identical uniqueness for existing rows.
  - scoring_format check constraint is widened (additive change only).
*/

-- 1. Add draft_scoring_rule_id column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'player_rankings'
      AND column_name  = 'draft_scoring_rule_id'
  ) THEN
    ALTER TABLE player_rankings
      ADD COLUMN draft_scoring_rule_id uuid
        REFERENCES draft_scoring_rules(id) ON DELETE CASCADE;
  END IF;
END $$;

-- 2. Update scoring_format check constraint to include 'custom'
ALTER TABLE player_rankings
  DROP CONSTRAINT IF EXISTS player_rankings_scoring_format_check;

ALTER TABLE player_rankings
  ADD CONSTRAINT player_rankings_scoring_format_check
    CHECK (scoring_format IN ('standard', 'half_ppr', 'ppr', 'any', 'custom'));

-- 3. Drop the old single unique constraint (it becomes partial index #1)
ALTER TABLE player_rankings
  DROP CONSTRAINT IF EXISTS player_rankings_unique;

-- 4. Partial unique index for all global rows (draft_scoring_rule_id IS NULL)
--    Equivalent to the old unique constraint but scoped to non-custom rows.
CREATE UNIQUE INDEX IF NOT EXISTS player_rankings_global_unique
  ON player_rankings (sports_player_id, provider, scoring_format, season, ranking_type)
  WHERE draft_scoring_rule_id IS NULL;

-- 5. Partial unique index for league-custom rows (draft_scoring_rule_id IS NOT NULL)
--    Scopes uniqueness to one ranking row per player per league scoring ruleset.
CREATE UNIQUE INDEX IF NOT EXISTS player_rankings_custom_unique
  ON player_rankings (sports_player_id, draft_scoring_rule_id, ranking_type)
  WHERE draft_scoring_rule_id IS NOT NULL;

-- 6. Index to support RPC lookups filtered by draft_scoring_rule_id
CREATE INDEX IF NOT EXISTS idx_player_rankings_scoring_rule
  ON player_rankings (draft_scoring_rule_id)
  WHERE draft_scoring_rule_id IS NOT NULL;
