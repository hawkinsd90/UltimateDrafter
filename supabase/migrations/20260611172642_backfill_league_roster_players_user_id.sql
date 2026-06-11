
-- Backfill user_id on league_roster_players rows that were created from
-- external_roster_players (where user_id was not populated).
-- Uses league_imported_members.invited_user_id as the owner.

UPDATE league_roster_players lrp
SET user_id = lim.invited_user_id
FROM league_imported_members lim
WHERE lim.id = lrp.imported_member_id
  AND lrp.user_id IS NULL
  AND lim.invited_user_id IS NOT NULL;
