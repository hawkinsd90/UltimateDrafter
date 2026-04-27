/*
  # Add player_pool_policy to external_league_teams

  ## Summary
  Adds a `player_pool_policy` column to `external_league_teams` to distinguish two
  behaviors for ignored imported teams:

  - `available`   — the team is ignored and its rostered players return to the open
                    draft pool (commissioners chose not to map them, but players are
                    still draftable).
  - `unavailable` — the team is ignored but its rostered players are blocked from the
                    draft pool (treated as if they are already taken, e.g. for a league
                    where all other teams' players should be off-limits).

  The existing `mapping_status = 'ignored'` only recorded that a team was skipped,
  not what should happen to its players. This column closes that gap without breaking
  existing data (all current rows default to 'available').

  ## Changes
  - `external_league_teams`: ADD COLUMN `player_pool_policy text NOT NULL DEFAULT 'available'`
    with CHECK constraint `IN ('available', 'unavailable')`.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'external_league_teams'
      AND column_name = 'player_pool_policy'
  ) THEN
    ALTER TABLE external_league_teams
      ADD COLUMN player_pool_policy text NOT NULL DEFAULT 'available'
      CHECK (player_pool_policy IN ('available', 'unavailable'));
  END IF;
END $$;
