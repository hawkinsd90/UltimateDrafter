/*
  # Switch get_draft_player_pool_with_rankings to SECURITY INVOKER

  ## Reason
  The original function used SECURITY DEFINER. This was not necessary because:
  - nfl_draft_player_pool is a plain view with no RLS of its own
  - sports_players SELECT policy is USING (true) for authenticated users
  - sports_teams and sports_leagues have no RLS blocking reads
  - player_rankings SELECT policy is USING (true) for authenticated users

  SECURITY INVOKER is safer: the function executes with the calling user's
  privileges rather than the function owner's, so RLS is applied normally.
  No behavior change for authenticated users — they can already read all
  referenced tables.

  ## Change
  Recreate the function identical to before but with SECURITY INVOKER
  (the default — so the SECURITY DEFINER clause is simply removed).
*/

CREATE OR REPLACE FUNCTION get_draft_player_pool_with_rankings(
  p_provider       text,
  p_scoring_format text,
  p_season         integer,
  p_ranking_type   text,
  p_position       text    DEFAULT NULL,
  p_search         text    DEFAULT NULL,
  p_sort_mode      text    DEFAULT 'name',
  p_limit          integer DEFAULT 100,
  p_offset         integer DEFAULT 0
)
RETURNS TABLE (
  id                   uuid,
  pool_provider        text,
  provider_player_id   text,
  display_name         text,
  nfl_position         text,
  fantasy_position     text,
  status               text,
  injury_status        text,
  team_abbr            text,
  team_name            text,
  headshot_url         text,
  years_exp            integer,
  overall_rank         integer,
  position_rank        integer,
  position_rank_label  text,
  fantasy_points       numeric,
  adp                  numeric,
  auction_value        numeric,
  percent_owned        numeric,
  trend_count          integer,
  ranking_source_label text,
  has_ranking_data     boolean
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    pool.id,
    pool.provider                             AS pool_provider,
    pool.provider_player_id,
    pool.display_name,
    pool.position                             AS nfl_position,
    pool.fantasy_position,
    pool.status,
    pool.injury_status,
    pool.team_abbr,
    pool.team_name,
    pool.headshot_url,
    pool.years_exp,
    pr.overall_rank,
    pr.position_rank,
    pr.position_rank_label,
    pr.fantasy_points,
    pr.adp,
    pr.auction_value,
    pr.percent_owned,
    pr.trend_count,
    pr.source_label                           AS ranking_source_label,
    (pr.sports_player_id IS NOT NULL)         AS has_ranking_data
  FROM nfl_draft_player_pool pool
  LEFT JOIN player_rankings pr
    ON  pr.sports_player_id = pool.id
    AND pr.provider         = p_provider
    AND pr.scoring_format   = p_scoring_format
    AND pr.season           = p_season
    AND pr.ranking_type     = p_ranking_type
  WHERE
    (p_position IS NULL OR pool.fantasy_position = p_position)
    AND (
      p_search IS NULL
      OR length(p_search) < 2
      OR pool.display_name ILIKE '%' || p_search || '%'
    )
  ORDER BY
    CASE WHEN p_sort_mode = 'name'
      THEN pool.display_name END ASC NULLS LAST,
    CASE WHEN p_sort_mode IN ('overall_rank', 'relevance')
      THEN pr.overall_rank END ASC NULLS LAST,
    CASE WHEN p_sort_mode = 'position_rank'
      THEN pr.position_rank END ASC NULLS LAST,
    CASE WHEN p_sort_mode = 'adp'
      THEN pr.adp END ASC NULLS LAST,
    CASE WHEN p_sort_mode = 'fantasy_points'
      THEN pr.fantasy_points END DESC NULLS LAST,
    pool.display_name ASC
  LIMIT p_limit
  OFFSET p_offset;
$$;

GRANT EXECUTE ON FUNCTION get_draft_player_pool_with_rankings(text,text,integer,text,text,text,text,integer,integer)
  TO authenticated;
