/*
  # Add ESPN and Sleeper ranking columns to sports_players and player pool view

  1. Changes
    - Add `espn_rank` (integer, nullable) to `sports_players` — lower = better rank
    - Add `sleeper_rank` (integer, nullable) to `sports_players` — lower = better rank
  2. View update
    - Recreate `nfl_draft_player_pool` view to expose both rank columns
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sports_players' AND column_name = 'espn_rank'
  ) THEN
    ALTER TABLE sports_players ADD COLUMN espn_rank integer;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sports_players' AND column_name = 'sleeper_rank'
  ) THEN
    ALTER TABLE sports_players ADD COLUMN sleeper_rank integer;
  END IF;
END $$;

CREATE OR REPLACE VIEW nfl_draft_player_pool AS
  SELECT
    sp.id,
    sp.provider,
    sp.provider_player_id,
    sp.display_name,
    sp."position",
    sp.fantasy_position,
    sp.status,
    sp.injury_status,
    st.abbreviation AS team_abbr,
    st.name         AS team_name,
    sp.headshot_url,
    sp.years_exp,
    sp.updated_at,
    sp.espn_rank,
    sp.sleeper_rank
  FROM sports_players sp
  JOIN sports_leagues sl ON (sl.id = sp.league_id AND sl.abbreviation = 'NFL')
  JOIN sports_teams   st ON (st.id = sp.team_id)
  WHERE sp.fantasy_position = ANY (ARRAY['QB','RB','WR','TE','K','DST'])
    AND sp.status = ANY (ARRAY['Active','Injured Reserve'])
    AND sp.team_id IS NOT NULL;
