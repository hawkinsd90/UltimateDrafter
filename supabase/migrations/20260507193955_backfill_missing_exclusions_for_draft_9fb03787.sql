/*
  # Backfill missing draft_player_exclusions for draft 9fb03787-596f-4890-939d-f03b95bc1ee4

  ## Summary
  50 roster players that should be excluded from the draft pool were missing from
  draft_player_exclusions. The original upsert used ON CONFLICT DO NOTHING, so any
  player appearing on more than one imported team roster had their exclusion silently
  dropped after the first insert.

  This migration inserts the missing exclusion rows directly, using the external_team_id
  and sports_player_id from external_roster_players for all teams that are either
  ignored/unavailable or mapped (all imported roster players should be excluded).
*/

INSERT INTO draft_player_exclusions (
  draft_id,
  sports_player_id,
  source,
  external_league_team_id,
  external_roster_player_id,
  reason
)
SELECT DISTINCT ON (erp.sports_player_id)
  '9fb03787-596f-4890-939d-f03b95bc1ee4',
  erp.sports_player_id,
  'external_ignored_team',
  elt.id,
  erp.id,
  'Imported team: ' || elt.external_team_name
FROM external_roster_players erp
JOIN external_league_teams elt
  ON  elt.link_id          = erp.link_id
  AND elt.external_team_id = erp.external_team_id
JOIN external_league_links ell ON ell.id = erp.link_id
WHERE ell.draft_id = '9fb03787-596f-4890-939d-f03b95bc1ee4'
  AND erp.sports_player_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM draft_player_exclusions dpe
    WHERE dpe.draft_id        = '9fb03787-596f-4890-939d-f03b95bc1ee4'
      AND dpe.sports_player_id = erp.sports_player_id
  )
ORDER BY erp.sports_player_id;
