/*
  # Create get_draft_player_pool_with_rankings RPC

  ## Purpose
  Replaces direct queries to nfl_draft_player_pool for the Add Players tab.
  Joins the pool with player_rankings for a given provider/format/season/type,
  applies position/search filters, and sorts by the requested mode.
  Always returns players even if no ranking data exists (LEFT JOIN).

  ## Parameters
  - p_provider       text    — 'espn' | 'sleeper' | 'fantasypros' | 'manual'
  - p_scoring_format text    — 'standard' | 'half_ppr' | 'ppr' | 'any'
  - p_season         integer — NFL season year e.g. 2026
  - p_ranking_type   text    — 'draft_rank' | 'ecr' | 'search_rank' | 'adp' | 'last_season_points' | 'trending'
  - p_position       text    — NULL for all, or 'QB','RB','WR','TE','K','DST'
  - p_search         text    — NULL or search string (min 2 chars, applied as ilike)
  - p_sort_mode      text    — 'name' | 'overall_rank' | 'position_rank' | 'fantasy_points' | 'adp' | 'relevance'
  - p_limit          integer — default 100
  - p_offset         integer — default 0

  ## Returns
  One row per player. Includes all pool columns plus ranking columns.
  has_ranking_data = true if at least one ranking row matched.

  ## Sort behavior
  - name:           display_name ASC
  - overall_rank:   overall_rank ASC NULLS LAST, then display_name ASC
  - position_rank:  position_rank ASC NULLS LAST, then display_name ASC
  - fantasy_points: fantasy_points DESC NULLS LAST, then display_name ASC
  - adp:            adp ASC NULLS LAST, then display_name ASC
  - relevance:      overall_rank ASC NULLS LAST (same column, different label)
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
SECURITY DEFINER
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
