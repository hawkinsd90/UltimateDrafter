/*
  # Backfill Sleeper search_rank into player_rankings

  ## Purpose
  Extracts the `search_rank` field already stored in sports_players.raw_data
  (imported via Sleeper's /v1/players/nfl endpoint) and inserts it into the
  new player_rankings table as a proper ranking row.

  ## What this does
  - Reads raw_data->>'search_rank' from all sports_players where:
    - provider = 'sleeper'
    - fantasy_position is one of QB, RB, WR, TE, K, DST
    - search_rank is non-null and less than 9999999 (9999999 = Sleeper's sentinel
      for irrelevant/inactive players)
  - Inserts one player_rankings row per player with:
    - provider = 'sleeper'
    - scoring_format = 'any'  (search_rank is format-agnostic)
    - season = 2026           (current NFL season)
    - ranking_type = 'search_rank'
    - overall_rank = the search_rank integer
    - position = fantasy_position (for position-filtered sorts)
    - source_label = 'Sleeper Relevance'
  - Uses INSERT ... ON CONFLICT DO NOTHING so safe to re-run

  ## Notes
  - 1,691 of 3,131 fantasy-position players have meaningful search_rank values
  - search_rank is NOT a draft ADP. It is Sleeper's internal search relevance
    ordering. It is labeled "Sleeper Relevance" in the UI, not "Sleeper Rank."
  - Values for relevant active players range from 1 (Josh Allen) to ~1000+
  - The 9999999 sentinel is excluded — those are inactive/practice squad players
*/

INSERT INTO player_rankings (
  sports_player_id,
  provider,
  scoring_format,
  season,
  ranking_type,
  overall_rank,
  position,
  source_label,
  synced_at,
  created_at,
  updated_at
)
SELECT
  id                                          AS sports_player_id,
  'sleeper'                                   AS provider,
  'any'                                       AS scoring_format,
  2026                                        AS season,
  'search_rank'                               AS ranking_type,
  (raw_data->>'search_rank')::integer         AS overall_rank,
  fantasy_position                            AS position,
  'Sleeper Relevance'                         AS source_label,
  now()                                       AS synced_at,
  now()                                       AS created_at,
  now()                                       AS updated_at
FROM sports_players
WHERE provider = 'sleeper'
  AND fantasy_position IN ('QB','RB','WR','TE','K','DST')
  AND raw_data->>'search_rank' IS NOT NULL
  AND (raw_data->>'search_rank')::integer < 9999999
ON CONFLICT (sports_player_id, provider, scoring_format, season, ranking_type)
DO NOTHING;
