/*
  Phase 3C - Migration 2
  Scope the active-player unique index to roster_status = 'active' only.

  The current index prevents a player from returning to the same team after
  being traded away, because the historical 'traded' row still exists.
  Adding AND roster_status = 'active' allows re-acquisition while keeping history.

  Confirmed index name from pg_indexes: league_roster_players_unique_resolved_player
*/

DROP INDEX league_roster_players_unique_resolved_player;

CREATE UNIQUE INDEX league_roster_players_unique_resolved_player
  ON league_roster_players(imported_member_id, sports_player_id)
  WHERE sports_player_id IS NOT NULL
    AND roster_status = 'active';
