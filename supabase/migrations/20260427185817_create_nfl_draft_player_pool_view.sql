/*
  # Create nfl_draft_player_pool view

  ## Purpose
  Provides a clean, draft-ready NFL fantasy player pool separate from the raw
  sports_players import table. sports_players intentionally retains all raw
  Sleeper data including historical/retired players that Sleeper marks as Active
  with no team assignment.

  ## Key filter logic
  - Only players with a team assignment (team_id IS NOT NULL) for skill positions.
    This eliminates the ~1,500 "Active" historical/free-agent players Sleeper
    keeps in its dataset (e.g. retired veterans, cut players never updated).
  - DST rows are synthetic and always have a team, so they pass automatically.
  - Statuses: Active, Injured Reserve (IR players are draftable in most formats).
    Inactive is excluded.
  - Positions: QB, RB, WR, TE, K, DST only.

  ## Columns returned
  - id, provider, provider_player_id
  - display_name, position, fantasy_position
  - status, injury_status
  - team_abbr, team_name
  - headshot_url, years_exp
  - updated_at

  ## Notes
  - No RLS needed on views — access is controlled by the underlying tables.
  - This view does NOT replace sports_players; raw data is preserved there.
*/

CREATE OR REPLACE VIEW public.nfl_draft_player_pool AS
SELECT
  sp.id,
  sp.provider,
  sp.provider_player_id,
  sp.display_name,
  sp.position,
  sp.fantasy_position,
  sp.status,
  sp.injury_status,
  st.abbreviation  AS team_abbr,
  st.name          AS team_name,
  sp.headshot_url,
  sp.years_exp,
  sp.updated_at
FROM sports_players sp
JOIN sports_leagues sl ON sl.id = sp.league_id AND sl.abbreviation = 'NFL'
JOIN sports_teams   st ON st.id = sp.team_id
WHERE
  sp.fantasy_position IN ('QB', 'RB', 'WR', 'TE', 'K', 'DST')
  AND sp.status IN ('Active', 'Injured Reserve')
  AND sp.team_id IS NOT NULL;
