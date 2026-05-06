/*
  # Derive Sleeper position_rank and position_rank_label from search_rank

  ## Purpose
  The Sleeper backfill migration populated overall_rank from raw_data.search_rank
  but left position_rank and position_rank_label null. This migration derives
  position ranks by partitioning the existing Sleeper search_rank rows by position
  and assigning a sequential position_rank within each group.

  ## What this does
  For the set of player_rankings rows where:
    - provider = 'sleeper'
    - scoring_format = 'any'
    - ranking_type = 'search_rank'
    - season = 2026
    - overall_rank IS NOT NULL
    - position IS NOT NULL

  It assigns:
    - position_rank = ROW_NUMBER() OVER (PARTITION BY position ORDER BY overall_rank ASC)
    - position_rank_label = position || position_rank  e.g. 'RB1', 'WR12', 'QB3'

  The result lets the Add Players tab sort by Position Relevance within a position
  group while clearly labeling these as Sleeper relevance-derived ranks, not
  official draft position rankings.

  ## Example output
  Josh Allen     QB  overall_rank=1   → position_rank=1  position_rank_label='QB1'
  Lamar Jackson  QB  overall_rank=12  → position_rank=2  position_rank_label='QB2'
  Bijan Robinson RB  overall_rank=1   → position_rank=1  position_rank_label='RB1'
  CMC            RB  overall_rank=5   → position_rank=2  position_rank_label='RB2'

  ## Safety
  - Only updates existing rows in player_rankings (no inserts, no deletes)
  - Idempotent: re-running overwrites with the same values
*/

UPDATE player_rankings pr
SET
  position_rank       = derived.pos_rank,
  position_rank_label = derived.pos_label,
  updated_at          = now()
FROM (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY position
      ORDER BY overall_rank ASC
    )::integer                            AS pos_rank,
    position || ROW_NUMBER() OVER (
      PARTITION BY position
      ORDER BY overall_rank ASC
    )::text                               AS pos_label
  FROM player_rankings
  WHERE provider      = 'sleeper'
    AND scoring_format = 'any'
    AND ranking_type  = 'search_rank'
    AND season        = 2026
    AND overall_rank  IS NOT NULL
    AND position      IS NOT NULL
) derived
WHERE pr.id = derived.id;
