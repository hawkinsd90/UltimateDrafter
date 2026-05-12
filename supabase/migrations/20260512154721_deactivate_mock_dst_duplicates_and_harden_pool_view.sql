/*
  # Deactivate Mock DST Duplicates and Harden nfl_draft_player_pool View

  ## Summary
  Two stale mock-provider DST rows survived in sports_players as Active, causing
  nfl_draft_player_pool to show 34 DST entries instead of the expected 32 (one per NFL team).

  ## Root Cause
  A prior mock/seed data import created DST player rows for Kansas City Chiefs and
  San Francisco 49ers with provider='mock'. These were never deactivated. When the
  Sleeper import later added real DST rows for the same teams, both mock and Sleeper
  rows passed all view filters (fantasy_position, status, team_id), resulting in duplicates.

  ## Part A — One-Time Cleanup
  Deactivate (not delete) the 2 mock DST rows by exact UUID:
  - 058d2119-f1d6-4689-886f-5c0e66ac55ef  (Kansas City Chiefs D/ST, mock, dst_KC)
  - a2f35bf6-5408-4856-9ad2-4b1daaecdc5e  (San Francisco 49ers D/ST, mock, dst_SF)

  Deactivation is preferred over deletion: references to these IDs will not break,
  and the rows are preserved for audit history.

  The mock sports_teams rows (1dd6b9f7, 49aa955d) are NOT modified because they have
  other mock players attached (K, QB, TE, WR, RB) that would be orphaned.

  ## Part B — View Hardening
  Replace the nfl_draft_player_pool view to add:
    AND COALESCE(sp.provider, '') <> 'mock'
  This ensures mock rows can never appear in the real draft pool again, even if a
  future mock import sets status='Active' by mistake.

  ## Impact
  - DST count: 34 → 32
  - Total pool: 1060 → 1058 (2 mock DST rows excluded)
  - No change to Sleeper, ESPN, Last Season, or Draft Board logic
  - No change to sports_teams or other sports_players rows
*/

-- Part A: Deactivate the 2 mock DST duplicate rows by exact UUID
UPDATE sports_players
SET
  status = 'Inactive',
  updated_at = now()
WHERE id IN (
  '058d2119-f1d6-4689-886f-5c0e66ac55ef',
  'a2f35bf6-5408-4856-9ad2-4b1daaecdc5e'
)
  AND provider = 'mock'
  AND fantasy_position = 'DST';

-- Part B: Recreate nfl_draft_player_pool view with mock provider exclusion
CREATE OR REPLACE VIEW nfl_draft_player_pool AS
SELECT
  sp.id,
  sp.provider,
  sp.provider_player_id,
  sp.display_name,
  sp.position,
  sp.fantasy_position,
  sp.status,
  sp.injury_status,
  st.abbreviation AS team_abbr,
  st.name AS team_name,
  sp.headshot_url,
  sp.years_exp,
  sp.updated_at,
  sp.espn_rank,
  sp.sleeper_rank
FROM sports_players sp
JOIN sports_leagues sl ON sl.id = sp.league_id AND sl.abbreviation = 'NFL'
JOIN sports_teams st ON st.id = sp.team_id
WHERE sp.fantasy_position = ANY (ARRAY['QB', 'RB', 'WR', 'TE', 'K', 'DST'])
  AND sp.status = ANY (ARRAY['Active', 'Injured Reserve'])
  AND sp.team_id IS NOT NULL
  AND COALESCE(sp.provider, '') <> 'mock';
