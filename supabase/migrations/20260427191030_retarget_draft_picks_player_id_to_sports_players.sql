/*
  # Retarget draft_picks.player_id FK from players to sports_players

  ## Summary
  The draft room was originally wired to a 30-row legacy `players` table seeded
  with demo data. This migration switches the foreign key on draft_picks.player_id
  to reference sports_players(id) instead, enabling the real Sleeper-imported NFL
  draft pool to be used in actual drafts.

  ## Changes

  ### draft_picks
  - DROP CONSTRAINT draft_picks_player_id_fkey (was → players.id)
  - ADD CONSTRAINT draft_picks_player_id_fkey (now → sports_players.id ON DELETE SET NULL)

  ## Safety
  - draft_picks has 0 rows at time of this migration — no data is affected.
  - The legacy `players` table is NOT dropped. It is preserved for reference.
  - No column renames. draft_picks.player_id stays as-is.

  ## Indexes added (if not already present)
  - draft_picks(player_id) — already exists from original migration; guard added
  - sports_players(is_fantasy_relevant) — partial index, already exists
  - sports_players(fantasy_position) — already exists
  - sports_players(team_id) — already exists

  All index creations use IF NOT EXISTS to be idempotent.
*/

-- Drop the old FK pointing to players(id)
ALTER TABLE draft_picks
  DROP CONSTRAINT IF EXISTS draft_picks_player_id_fkey;

-- Add new FK pointing to sports_players(id)
ALTER TABLE draft_picks
  ADD CONSTRAINT draft_picks_player_id_fkey
  FOREIGN KEY (player_id)
  REFERENCES sports_players(id)
  ON DELETE SET NULL;

-- Ensure indexes exist (all use IF NOT EXISTS — safe to re-run)
CREATE INDEX IF NOT EXISTS idx_draft_picks_player ON draft_picks(player_id);
CREATE INDEX IF NOT EXISTS idx_sports_players_fantasy_relevant ON sports_players(is_fantasy_relevant) WHERE is_fantasy_relevant = true;
CREATE INDEX IF NOT EXISTS idx_sports_players_fantasy_position ON sports_players(fantasy_position);
CREATE INDEX IF NOT EXISTS idx_sports_players_team ON sports_players(team_id);
