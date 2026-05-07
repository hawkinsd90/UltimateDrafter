/*
  # Add draft_id exclusion filter to get_draft_player_pool_with_rankings

  ## Summary
  Adds a p_draft_id parameter to the player pool RPC so that players in
  draft_player_exclusions are filtered out of the results. Previously, exclusions
  were stored correctly but never applied — excluded players still appeared in the
  Add Players list.

  ## Change
  - Adds optional parameter: p_draft_id uuid DEFAULT NULL
  - When p_draft_id is provided, excludes any player whose id appears in
    draft_player_exclusions for that draft
  - All other parameters and behavior are unchanged

  ## Security
  - SECURITY INVOKER: runs as calling user
  - draft_player_exclusions RLS SELECT policy allows authenticated participants
    and league owners to read rows — the NOT EXISTS subquery will correctly
    filter only the rows the caller is allowed to see
*/

CREATE OR REPLACE FUNCTION get_draft_player_pool_with_rankings(
  p_provider               text,
  p_scoring_format         text,
  p_season                 integer,
  p_ranking_type           text,
  p_position               text    DEFAULT NULL,
  p_search                 text    DEFAULT NULL,
  p_sort_mode              text    DEFAULT 'name',
  p_limit                  integer DEFAULT 100,
  p_offset                 integer DEFAULT 0,
  p_draft_scoring_rule_id  uuid    DEFAULT NULL,
  p_draft_id               uuid    DEFAULT NULL
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
SECURITY INVOKER
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
    AND (
      (p_draft_scoring_rule_id IS NULL     AND pr.draft_scoring_rule_id IS NULL)
      OR
      (p_draft_scoring_rule_id IS NOT NULL AND pr.draft_scoring_rule_id = p_draft_scoring_rule_id)
    )
  WHERE
    (p_position IS NULL OR pool.fantasy_position = p_position)
    AND (
      p_search IS NULL
      OR length(p_search) < 2
      OR pool.display_name ILIKE '%' || p_search || '%'
    )
    AND (
      p_draft_id IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM draft_player_exclusions dpe
        WHERE dpe.draft_id        = p_draft_id
          AND dpe.sports_player_id = pool.id
      )
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

GRANT EXECUTE ON FUNCTION get_draft_player_pool_with_rankings(text,text,integer,text,text,text,text,integer,integer,uuid,uuid)
  TO authenticated;
