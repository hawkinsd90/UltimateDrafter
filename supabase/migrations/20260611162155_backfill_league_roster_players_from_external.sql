
-- Backfill league_roster_players from external_roster_players for all leagues
-- that have imported members but no league_roster_players rows yet.
-- This enables the Drop Player feature for pre-existing leagues.

INSERT INTO league_roster_players (
  league_id,
  imported_member_id,
  user_id,
  external_roster_player_id,
  sports_player_id,
  external_player_name,
  external_position,
  roster_status,
  acquisition_source,
  sort_order
)
SELECT
  lim.league_id,
  lim.id                     AS imported_member_id,
  lim.invited_user_id        AS user_id,
  erp.id                     AS external_roster_player_id,
  erp.sports_player_id,
  erp.external_player_name,
  erp.external_position,
  'active'                   AS roster_status,
  'imported'                 AS acquisition_source,
  ROW_NUMBER() OVER (
    PARTITION BY lim.id
    ORDER BY erp.external_player_name
  )                          AS sort_order
FROM league_imported_members lim
JOIN external_league_links ell
  ON ell.league_id          = lim.league_id
 AND ell.provider           = lim.provider
 AND ell.external_league_id = lim.external_league_id
JOIN external_roster_players erp
  ON erp.link_id            = ell.id
 AND erp.external_team_id   = lim.external_team_id
-- Only backfill members that have no league_roster_players rows yet
WHERE NOT EXISTS (
  SELECT 1 FROM league_roster_players lrp
  WHERE lrp.imported_member_id = lim.id
);
