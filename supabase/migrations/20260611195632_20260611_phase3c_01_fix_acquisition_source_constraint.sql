/*
  Phase 3C - Migration 1
  Add 'traded' to league_roster_players.acquisition_source CHECK constraint.
*/

ALTER TABLE league_roster_players
  DROP CONSTRAINT league_roster_players_acquisition_source_check;

ALTER TABLE league_roster_players
  ADD CONSTRAINT league_roster_players_acquisition_source_check
  CHECK (acquisition_source IN ('imported', 'drafted', 'added', 'waiver', 'traded'));
