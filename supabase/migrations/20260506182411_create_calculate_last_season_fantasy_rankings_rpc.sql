/*
  # Create calculate_last_season_fantasy_rankings RPC

  ## Purpose
  Calculates per-player fantasy points for a specific draft's scoring rules using
  the previous season's player stats, then upserts results into player_rankings as
  custom last_season_points rows.

  ## Behavior
  1. Looks up draft_scoring_rules for the given draft_id.
  2. Loads all non-tiered draft_scoring_rule_values for that rule (tiered keys skipped —
     points_allowed/yards_allowed weekly aggregates are not available).
  3. Loads all player_season_stats for the given season from Sleeper.
  4. Calculates fantasy_points as a dot-product: SUM(stat_value * points_per_unit).
  5. Skips bonus keys (e.g. rushing_yards_100_bonus) that require weekly data.
  6. Ranks players overall and by fantasy_position descending.
  7. Upserts into player_rankings using partial unique index
     (sports_player_id, draft_scoring_rule_id, ranking_type) WHERE draft_scoring_rule_id IS NOT NULL.

  ## Security
  SECURITY DEFINER with explicit auth check: caller must be authenticated and either
  own the league that contains the draft, or be an admin user.

  ## Returns
  JSONB summary with success, counts, skipped keys, and top-10 samples.

  ## Notes
  - provider = 'manual' (the only non-provider-specific value allowed by the check constraint)
  - scoring_format = 'custom'
  - ranking_type = 'last_season_points'
  - Only non-tiered, non-bonus stat keys are calculated (safe with season totals)
*/

CREATE OR REPLACE FUNCTION calculate_last_season_fantasy_rankings(
  p_draft_id uuid,
  p_season   integer DEFAULT 2025
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id            uuid;
  v_is_admin           boolean := false;
  v_is_league_owner    boolean := false;
  v_rule_id            uuid;
  v_draft_name         text;
  v_league_id          uuid;

  -- Bonus key suffixes we cannot calculate from season totals
  v_bonus_suffixes     text[] := ARRAY[
    '_300_bonus', '_400_bonus', '_100_bonus', '_150_bonus', '_200_bonus'
  ];

  v_skipped_tiered     text[] := ARRAY[]::text[];
  v_skipped_bonus      text[] := ARRAY[]::text[];

  v_players_considered integer := 0;
  v_players_ranked     integer := 0;
  v_rows_upserted      integer := 0;

  v_top10_overall      jsonb;
  v_top10_by_pos       jsonb;
BEGIN
  -- ── Auth check ─────────────────────────────────────────────────────────────
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  -- Check admin
  SELECT EXISTS(
    SELECT 1 FROM admin_users WHERE user_id = v_user_id
  ) INTO v_is_admin;

  -- Check league owner
  SELECT EXISTS(
    SELECT 1
    FROM drafts d
    JOIN leagues l ON l.id = d.league_id
    WHERE d.id = p_draft_id
      AND l.owner_id = v_user_id
  ) INTO v_is_league_owner;

  IF NOT (v_is_admin OR v_is_league_owner) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Forbidden: must be admin or league owner');
  END IF;

  -- ── Load draft + rule ───────────────────────────────────────────────────────
  SELECT d.name, d.league_id
  INTO v_draft_name, v_league_id
  FROM drafts d
  WHERE d.id = p_draft_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Draft not found: ' || p_draft_id);
  END IF;

  SELECT id INTO v_rule_id
  FROM draft_scoring_rules
  WHERE draft_id = p_draft_id
  LIMIT 1;

  IF v_rule_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'No scoring rules found for draft ' || p_draft_id
    );
  END IF;

  -- ── Identify skipped keys ──────────────────────────────────────────────────
  SELECT array_agg(DISTINCT stat_key ORDER BY stat_key)
  INTO v_skipped_tiered
  FROM draft_scoring_rule_values
  WHERE draft_scoring_rule_id = v_rule_id
    AND is_tiered = true;

  SELECT array_agg(DISTINCT stat_key ORDER BY stat_key)
  INTO v_skipped_bonus
  FROM draft_scoring_rule_values
  WHERE draft_scoring_rule_id = v_rule_id
    AND is_tiered = false
    AND (
      stat_key LIKE '%_300_bonus' OR stat_key LIKE '%_400_bonus'
      OR stat_key LIKE '%_100_bonus' OR stat_key LIKE '%_150_bonus'
      OR stat_key LIKE '%_200_bonus'
    );

  -- Coerce NULLs to empty arrays
  v_skipped_tiered := COALESCE(v_skipped_tiered, ARRAY[]::text[]);
  v_skipped_bonus  := COALESCE(v_skipped_bonus,  ARRAY[]::text[]);

  -- ── Calculate and upsert ───────────────────────────────────────────────────
  -- Build a CTE that:
  --   1. Joins player_season_stats to the scoring rule values (non-tiered, non-bonus)
  --   2. Multiplies each stat column by its points_per_unit
  --   3. Sums per player
  --   4. Computes overall_rank and position_rank using RANK() OVER
  --   5. Upserts into player_rankings

  WITH scoring_rules AS (
    SELECT stat_key, points_per_unit
    FROM draft_scoring_rule_values
    WHERE draft_scoring_rule_id = v_rule_id
      AND is_tiered = false
      AND stat_key NOT LIKE '%_300_bonus'
      AND stat_key NOT LIKE '%_400_bonus'
      AND stat_key NOT LIKE '%_100_bonus'
      AND stat_key NOT LIKE '%_150_bonus'
      AND stat_key NOT LIKE '%_200_bonus'
      AND points_per_unit <> 0
  ),
  player_stats AS (
    SELECT
      pss.sports_player_id,
      sp.fantasy_position,
      sp.position,
      COALESCE(pss.passing_yards,    0) * COALESCE((SELECT points_per_unit FROM scoring_rules WHERE stat_key = 'passing_yards'),    0)
    + COALESCE(pss.passing_tds,      0) * COALESCE((SELECT points_per_unit FROM scoring_rules WHERE stat_key = 'passing_tds'),      0)
    + COALESCE(pss.passing_ints,     0) * COALESCE((SELECT points_per_unit FROM scoring_rules WHERE stat_key = 'passing_ints'),     0)
    + COALESCE(pss.passing_2pt,      0) * COALESCE((SELECT points_per_unit FROM scoring_rules WHERE stat_key = 'passing_2pt'),      0)
    + COALESCE(pss.rushing_yards,    0) * COALESCE((SELECT points_per_unit FROM scoring_rules WHERE stat_key = 'rushing_yards'),    0)
    + COALESCE(pss.rushing_tds,      0) * COALESCE((SELECT points_per_unit FROM scoring_rules WHERE stat_key = 'rushing_tds'),      0)
    + COALESCE(pss.rushing_2pt,      0) * COALESCE((SELECT points_per_unit FROM scoring_rules WHERE stat_key = 'rushing_2pt'),      0)
    + COALESCE(pss.receptions,       0) * COALESCE((SELECT points_per_unit FROM scoring_rules WHERE stat_key = 'receptions'),       0)
    + COALESCE(pss.receiving_yards,  0) * COALESCE((SELECT points_per_unit FROM scoring_rules WHERE stat_key = 'receiving_yards'),  0)
    + COALESCE(pss.receiving_tds,    0) * COALESCE((SELECT points_per_unit FROM scoring_rules WHERE stat_key = 'receiving_tds'),    0)
    + COALESCE(pss.receiving_2pt,    0) * COALESCE((SELECT points_per_unit FROM scoring_rules WHERE stat_key = 'receiving_2pt'),    0)
    + COALESCE(pss.fumbles_lost,     0) * COALESCE((SELECT points_per_unit FROM scoring_rules WHERE stat_key = 'fumbles_lost'),     0)
    + COALESCE(pss.return_tds,       0) * COALESCE((SELECT points_per_unit FROM scoring_rules WHERE stat_key = 'return_tds'),       0)
    + COALESCE(pss.fg_made_0_39,     0) * COALESCE((SELECT points_per_unit FROM scoring_rules WHERE stat_key = 'fg_made_0_39'),     0)
    + COALESCE(pss.fg_made_40_49,    0) * COALESCE((SELECT points_per_unit FROM scoring_rules WHERE stat_key = 'fg_made_40_49'),    0)
    + COALESCE(pss.fg_made_50_plus,  0) * COALESCE((SELECT points_per_unit FROM scoring_rules WHERE stat_key = 'fg_made_50_plus'),  0)
    + COALESCE(pss.fg_missed,        0) * COALESCE((SELECT points_per_unit FROM scoring_rules WHERE stat_key = 'fg_missed'),        0)
    + COALESCE(pss.xp_made,          0) * COALESCE((SELECT points_per_unit FROM scoring_rules WHERE stat_key = 'xp_made'),          0)
    + COALESCE(pss.xp_missed,        0) * COALESCE((SELECT points_per_unit FROM scoring_rules WHERE stat_key = 'xp_missed'),        0)
    + COALESCE(pss.sacks,            0) * COALESCE((SELECT points_per_unit FROM scoring_rules WHERE stat_key = 'sacks'),            0)
    + COALESCE(pss.def_interceptions,0) * COALESCE((SELECT points_per_unit FROM scoring_rules WHERE stat_key = 'def_interceptions'),0)
    + COALESCE(pss.fumble_recoveries,0) * COALESCE((SELECT points_per_unit FROM scoring_rules WHERE stat_key = 'fumble_recoveries'),0)
    + COALESCE(pss.def_tds,          0) * COALESCE((SELECT points_per_unit FROM scoring_rules WHERE stat_key = 'def_tds'),          0)
    + COALESCE(pss.safeties,         0) * COALESCE((SELECT points_per_unit FROM scoring_rules WHERE stat_key = 'safeties'),         0)
    + COALESCE(pss.blocks,           0) * COALESCE((SELECT points_per_unit FROM scoring_rules WHERE stat_key = 'blocks'),           0)
      AS fantasy_points
    FROM player_season_stats pss
    JOIN sports_players sp ON sp.id = pss.sports_player_id
    WHERE pss.provider  = 'sleeper'
      AND pss.season    = p_season
      AND pss.stat_type = 'regular_season'
      AND sp.fantasy_position IS NOT NULL
  ),
  ranked AS (
    SELECT
      sports_player_id,
      fantasy_position,
      position,
      ROUND(fantasy_points::numeric, 2) AS fantasy_points,
      RANK() OVER (ORDER BY fantasy_points DESC NULLS LAST)::integer AS overall_rank,
      RANK() OVER (PARTITION BY fantasy_position ORDER BY fantasy_points DESC NULLS LAST)::integer AS position_rank
    FROM player_stats
    WHERE fantasy_points > 0
  )
  INSERT INTO player_rankings (
    sports_player_id,
    provider,
    scoring_format,
    season,
    ranking_type,
    draft_scoring_rule_id,
    fantasy_points,
    overall_rank,
    position_rank,
    position_rank_label,
    position,
    source_label,
    raw_data,
    synced_at,
    updated_at
  )
  SELECT
    r.sports_player_id,
    'manual',
    'custom',
    p_season,
    'last_season_points',
    v_rule_id,
    r.fantasy_points,
    r.overall_rank,
    r.position_rank,
    r.fantasy_position || r.position_rank::text,
    r.fantasy_position,
    'Last Season — League Rules',
    jsonb_build_object(
      'draft_id',               p_draft_id,
      'draft_scoring_rule_id',  v_rule_id,
      'season',                 p_season,
      'stat_provider',          'sleeper',
      'skipped_tiered_keys',    to_jsonb(v_skipped_tiered),
      'skipped_bonus_keys',     to_jsonb(v_skipped_bonus)
    ),
    now(),
    now()
  FROM ranked r
  ON CONFLICT (sports_player_id, draft_scoring_rule_id, ranking_type)
  WHERE draft_scoring_rule_id IS NOT NULL
  DO UPDATE SET
    fantasy_points       = EXCLUDED.fantasy_points,
    overall_rank         = EXCLUDED.overall_rank,
    position_rank        = EXCLUDED.position_rank,
    position_rank_label  = EXCLUDED.position_rank_label,
    position             = EXCLUDED.position,
    source_label         = EXCLUDED.source_label,
    raw_data             = EXCLUDED.raw_data,
    synced_at            = EXCLUDED.synced_at,
    updated_at           = EXCLUDED.updated_at;

  GET DIAGNOSTICS v_rows_upserted = ROW_COUNT;

  -- Count considered (all with fantasy_position)
  SELECT COUNT(*) INTO v_players_considered
  FROM player_season_stats pss
  JOIN sports_players sp ON sp.id = pss.sports_player_id
  WHERE pss.provider = 'sleeper' AND pss.season = p_season
    AND pss.stat_type = 'regular_season' AND sp.fantasy_position IS NOT NULL;

  v_players_ranked := v_rows_upserted;

  -- ── Top 10 overall ─────────────────────────────────────────────────────────
  SELECT jsonb_agg(t ORDER BY t->>'overall_rank')
  INTO v_top10_overall
  FROM (
    SELECT jsonb_build_object(
      'rank',     pr.overall_rank,
      'player',   sp.display_name,
      'position', pr.position,
      'points',   pr.fantasy_points
    ) AS t
    FROM player_rankings pr
    JOIN sports_players sp ON sp.id = pr.sports_player_id
    WHERE pr.draft_scoring_rule_id = v_rule_id
      AND pr.ranking_type = 'last_season_points'
    ORDER BY pr.overall_rank
    LIMIT 10
  ) sub;

  -- ── Top 5 per position ─────────────────────────────────────────────────────
  SELECT jsonb_object_agg(pos, players)
  INTO v_top10_by_pos
  FROM (
    SELECT position AS pos,
           jsonb_agg(jsonb_build_object(
             'rank', position_rank, 'player', display_name, 'points', fantasy_points
           ) ORDER BY position_rank) AS players
    FROM (
      SELECT pr.position, pr.position_rank, sp.display_name, pr.fantasy_points,
             ROW_NUMBER() OVER (PARTITION BY pr.position ORDER BY pr.position_rank) AS rn
      FROM player_rankings pr
      JOIN sports_players sp ON sp.id = pr.sports_player_id
      WHERE pr.draft_scoring_rule_id = v_rule_id
        AND pr.ranking_type = 'last_season_points'
        AND pr.position IN ('QB','RB','WR','TE','K','DST')
    ) ranked_pos
    WHERE rn <= 5
    GROUP BY position
  ) agg;

  RETURN jsonb_build_object(
    'success',              true,
    'draft_id',             p_draft_id,
    'draft_name',           v_draft_name,
    'draft_scoring_rule_id', v_rule_id,
    'season',               p_season,
    'players_considered',   v_players_considered,
    'players_ranked',       v_players_ranked,
    'rows_upserted',        v_rows_upserted,
    'skipped_tiered_keys',  to_jsonb(v_skipped_tiered),
    'skipped_bonus_keys',   to_jsonb(v_skipped_bonus),
    'top_10_overall',       v_top10_overall,
    'top_10_by_position',   v_top10_by_pos
  );
END;
$$;

-- Grant execute to authenticated users (auth check is inside the function)
GRANT EXECUTE ON FUNCTION calculate_last_season_fantasy_rankings(uuid, integer) TO authenticated;
