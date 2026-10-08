/*
# Backfill app-owned roster rows required by player trades

1. Purpose
- Existing imported leagues can have resolved players only in the provider snapshot table.
- Player trade proposals require league_roster_players IDs because that table is the app-owned roster source of truth.
- This migration fills missing app-owned rows without changing the trade proposal model or adding pick assets.

2. Data changes
- Creates one active league_roster_players row for each external roster player missing from the app-owned table.
- Copies the resolved sports player reference, imported player name, position, and provider snapshot reference.
- Preserves imported roster ordering by external player name for newly created rows.
- Fills league_member_id and user_id from the currently claimed league member.

3. Safety
- Existing app-owned roster rows are not modified or duplicated.
- Duplicate provider rows for the same canonical player are collapsed per imported team.
- Unresolved external players remain non-tradeable in the UI and RPC.
- No tables, columns, or trade RPC signatures are changed.
- No pick-trading behavior is added.
*/

INSERT INTO league_roster_players (
  league_id,
  imported_member_id,
  league_member_id,
  user_id,
  external_roster_player_id,
  sports_player_id,
  external_player_name,
  external_position,
  roster_status,
  acquisition_source,
  sort_order
)
SELECT DISTINCT ON (lim.id, erp.sports_player_id)
  lim.league_id,
  lim.id,
  lm.id,
  lim.invited_user_id,
  erp.id,
  erp.sports_player_id,
  erp.external_player_name,
  erp.external_position,
  'active',
  'imported',
  ROW_NUMBER() OVER (
    PARTITION BY lim.id
    ORDER BY erp.external_player_name, erp.id
  )
FROM league_imported_members lim
JOIN external_league_links ell
  ON ell.league_id = lim.league_id
 AND ell.provider = lim.provider
 AND ell.external_league_id = lim.external_league_id
JOIN external_roster_players erp
  ON erp.link_id = ell.id
 AND erp.external_team_id = lim.external_team_id
LEFT JOIN league_members lm
  ON lm.league_id = lim.league_id
 AND lm.user_id = lim.invited_user_id
WHERE NOT EXISTS (
  SELECT 1
  FROM league_roster_players existing
  WHERE existing.external_roster_player_id = erp.id
     OR (
       existing.imported_member_id = lim.id
       AND existing.sports_player_id IS NOT DISTINCT FROM erp.sports_player_id
       AND erp.sports_player_id IS NOT NULL
     )
)
ORDER BY lim.id, erp.sports_player_id, erp.external_player_name, erp.id;

UPDATE league_roster_players lrp
SET league_member_id = lm.id,
    user_id = lim.invited_user_id
FROM league_imported_members lim
JOIN league_members lm
  ON lm.league_id = lim.league_id
 AND lm.user_id = lim.invited_user_id
WHERE lrp.imported_member_id = lim.id
  AND (lrp.league_member_id IS DISTINCT FROM lm.id OR lrp.user_id IS DISTINCT FROM lim.invited_user_id);