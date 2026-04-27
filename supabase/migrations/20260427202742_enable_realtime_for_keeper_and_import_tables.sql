/*
  # Realtime Publication — External Import + Keeper Tables

  Adds draft_keeper_assignments to the supabase_realtime publication
  so the draft room receives live updates when keepers are added or removed
  during the pre-draft setup phase.

  external_league_links is also added so the import wizard can react to
  import_status transitions (e.g. 'imported' → 'mapped' → 'locked') in real time.

  external_league_teams, external_roster_players, and draft_scoring_rules are
  not added to realtime — they are loaded on wizard step entry via direct queries,
  which is sufficient for the commissioner-only import flow.
*/

ALTER PUBLICATION supabase_realtime ADD TABLE draft_keeper_assignments;
ALTER PUBLICATION supabase_realtime ADD TABLE external_league_links;
