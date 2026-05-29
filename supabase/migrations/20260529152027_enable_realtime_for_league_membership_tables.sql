/*
  # Enable Realtime for League Membership Tables

  ## Problem
  LeagueDetail subscribes to postgres_changes on league_members, league_invites,
  and league_imported_members to live-update when someone joins, leaves, or is
  invited. However, none of these tables were in the supabase_realtime publication,
  so events were never broadcast and the page only updated on manual refresh.

  ## Changes
  - Add league_members to supabase_realtime publication
  - Add league_invites to supabase_realtime publication
  - Add league_imported_members to supabase_realtime publication

  Once added, any INSERT/UPDATE/DELETE on these tables will be broadcast to
  subscribed clients, enabling live membership updates without a page refresh.
*/

ALTER PUBLICATION supabase_realtime ADD TABLE league_members;
ALTER PUBLICATION supabase_realtime ADD TABLE league_invites;
ALTER PUBLICATION supabase_realtime ADD TABLE league_imported_members;
