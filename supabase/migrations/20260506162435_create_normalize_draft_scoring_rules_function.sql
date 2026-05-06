/*
  # Create normalize_draft_scoring_rules() function

  ## Purpose
  Reads raw ESPN or Sleeper scoring JSON from draft_scoring_rules and populates
  draft_scoring_rule_values with canonical, provider-agnostic stat_key rows.

  This is Phase 1 of the Last Season scoring feature. The canonical rows are
  later used in Phase 3 to calculate fantasy points by joining
  player_season_stats columns against canonical stat_key values.

  ## Canonical stat_key names
  These names match the column names that will be created in player_season_stats
  in Phase 2, ensuring the dot-product calculation in Phase 3 is a direct join.

  ## ESPN statId → canonical mapping
  Derived from the ESPN Fantasy Football API statId reference (community
  reverse-engineered; stable since ~2015). All 52 statIds present in the
  current imported league data are covered.

  Tiered stats (DST points-allowed, yards-allowed) use is_tiered=true with
  threshold_min/threshold_max ranges. The stat_key for tiered stats is
  'points_allowed' or 'yards_allowed' so the future calculation can evaluate
  which tier a team's actual stat falls in.

  ## Returns
  Table of:
  - rule_id
  - stat_key mapped or unmapped label
  - provider_stat_id
  - points_per_unit
  - is_tiered
  - status: 'inserted', 'updated', 'skipped_zero_inactive', 'unmapped'

  ## Parameters
  - p_draft_id uuid DEFAULT NULL — if provided, only normalize that draft's rules.
    If NULL, normalize all draft_scoring_rules rows.

  ## Idempotent
  Uses INSERT ... ON CONFLICT DO UPDATE so re-running is safe.
*/

CREATE OR REPLACE FUNCTION normalize_draft_scoring_rules(
  p_draft_id uuid DEFAULT NULL
)
RETURNS TABLE (
  rule_id            uuid,
  stat_key_result    text,
  provider_stat_id   text,
  points_per_unit    numeric,
  is_tiered          boolean,
  status             text
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_rule        record;
  v_item        record;
  v_stat_id     integer;
  v_points      numeric;
  v_canonical   text;
  v_tiered      boolean;
  v_tmin        numeric;
  v_tmax        numeric;
BEGIN
  FOR v_rule IN
    SELECT dsr.id AS rule_id, dsr.draft_id, dsr.source, dsr.scoring_type,
           dsr.raw_scoring,
           -- Detect provider from external_league_links
           COALESCE(
             (SELECT ell.provider
              FROM external_league_links ell
              WHERE ell.draft_id = dsr.draft_id
              LIMIT 1),
             'espn'  -- default assumption if no link found
           ) AS provider
    FROM draft_scoring_rules dsr
    WHERE (p_draft_id IS NULL OR dsr.draft_id = p_draft_id)
      AND dsr.raw_scoring IS NOT NULL
      AND dsr.raw_scoring ? 'scoringItems'  -- ESPN format check
  LOOP

    -- ── ESPN format: raw_scoring->'scoringItems' is a JSON array ────────────
    FOR v_item IN
      SELECT
        (elem->>'statId')::integer                     AS stat_id,
        COALESCE((elem->>'points')::numeric, 0)        AS points,
        elem->'pointsOverrides'                        AS overrides,
        elem                                           AS raw
      FROM jsonb_array_elements(v_rule.raw_scoring->'scoringItems') AS elem
    LOOP
      v_stat_id := v_item.stat_id;
      v_points  := v_item.points;
      v_tiered  := false;
      v_tmin    := NULL;
      v_tmax    := NULL;

      -- ── ESPN statId → canonical stat_key lookup ─────────────────────────
      -- Source: ESPN Fantasy Football API statId reference (community-verified,
      -- stable since ~2015). All IDs present in the current import are mapped.
      v_canonical := CASE v_stat_id
        -- ── Passing ────────────────────────────────────────────────────────
        WHEN 3   THEN 'passing_yards'
        WHEN 4   THEN 'passing_tds'
        WHEN 19  THEN 'passing_2pt'
        WHEN 20  THEN 'passing_ints'
        -- ── Rushing ────────────────────────────────────────────────────────
        WHEN 24  THEN 'rushing_yards'
        WHEN 25  THEN 'rushing_tds'
        WHEN 26  THEN 'rushing_2pt'
        -- ── Receiving ──────────────────────────────────────────────────────
        WHEN 42  THEN 'receiving_yards'
        WHEN 43  THEN 'receiving_tds'
        WHEN 44  THEN 'receiving_2pt'
        WHEN 53  THEN 'receptions'
        -- ── Misc offense ───────────────────────────────────────────────────
        WHEN 63  THEN 'return_tds'       -- combined KR/PR TD
        WHEN 72  THEN 'fumbles_lost'
        -- Passing yards milestone bonuses (applied as overrides per scoring period)
        -- 112 = 300+ passing yards bonus, 113 = 400+ passing yards bonus
        -- These are milestone bonuses, not per-yard — map as bonus keys
        WHEN 112 THEN 'passing_yards_300_bonus'
        WHEN 113 THEN 'passing_yards_400_bonus'
        -- Rushing yards milestone bonuses
        WHEN 114 THEN 'rushing_yards_100_bonus'
        WHEN 115 THEN 'rushing_yards_150_bonus'
        -- ── Kicking ────────────────────────────────────────────────────────
        WHEN 77  THEN 'fg_made_40_49'
        WHEN 80  THEN 'fg_made_0_39'
        WHEN 85  THEN 'fg_missed'
        WHEN 86  THEN 'xp_made'
        -- ── Defense / Special Teams ────────────────────────────────────────
        WHEN 93  THEN 'def_tds'          -- defensive/special teams TD (all types)
        WHEN 95  THEN 'def_tds'          -- alternate def TD mapping (some leagues)
        WHEN 98  THEN 'sacks'
        WHEN 198 THEN 'sacks'            -- alternate sack statId in H2H scoring
        WHEN 201 THEN 'def_interceptions'
        WHEN 206 THEN 'safeties'
        WHEN 209 THEN 'fumble_recoveries'
        -- DST return / special team TDs (separate from def_tds above)
        -- 101 = kick return TD, 102 = punt return TD, 103 = blocked kick TD,
        -- 104 = blocked punt TD — all map to return_tds for calculation purposes
        WHEN 101 THEN 'return_tds'
        WHEN 102 THEN 'return_tds'
        WHEN 103 THEN 'return_tds'
        WHEN 104 THEN 'return_tds'
        -- DST blocked kicks (non-TD)
        WHEN 106 THEN 'blocks'
        -- ── DST Points Allowed tiers ──────────────────────────────────────
        -- ESPN uses separate statIds per scoring tier. Points come from the
        -- pointsOverrides map (key = scoring period). The base 'points' field
        -- is the regular-season value; we use that for season-stat calculation.
        -- is_tiered=true marks these for threshold-based scoring in Phase 3.
        WHEN 89  THEN 'points_allowed'   -- 0 points allowed
        WHEN 90  THEN 'points_allowed'   -- 1-6 points allowed
        WHEN 91  THEN 'points_allowed'   -- 7-13 points allowed
        WHEN 92  THEN 'points_allowed'   -- 14-20 points allowed
        WHEN 96  THEN 'points_allowed'   -- 21-27 points allowed
        WHEN 97  THEN 'points_allowed'   -- 28-34 points allowed
        WHEN 99  THEN 'points_allowed'   -- 35+ points allowed
        -- ── DST Yards Allowed tiers ───────────────────────────────────────
        WHEN 123 THEN 'yards_allowed'    -- < 100 yards
        WHEN 124 THEN 'yards_allowed'    -- 100-199 yards
        WHEN 125 THEN 'yards_allowed'    -- 200-299 yards
        WHEN 128 THEN 'yards_allowed'    -- 300-349 yards
        WHEN 129 THEN 'yards_allowed'    -- 350-399 yards
        WHEN 130 THEN 'yards_allowed'    -- 400-449 yards
        WHEN 131 THEN 'yards_allowed'    -- 450-499 yards
        WHEN 132 THEN 'yards_allowed'    -- 500-549 yards
        WHEN 133 THEN 'yards_allowed'    -- 550+ yards
        WHEN 134 THEN 'yards_allowed'    -- alternative yards tier
        WHEN 135 THEN 'yards_allowed'    -- alternative yards tier
        WHEN 136 THEN 'yards_allowed'    -- alternative yards tier
        ELSE NULL  -- unmapped
      END;

      -- Set tier ranges for points_allowed statIds
      IF v_canonical = 'points_allowed' THEN
        v_tiered := true;
        v_tmin := CASE v_stat_id
          WHEN 89  THEN 0
          WHEN 90  THEN 1
          WHEN 91  THEN 7
          WHEN 92  THEN 14
          WHEN 96  THEN 21
          WHEN 97  THEN 28
          WHEN 99  THEN 35
          ELSE NULL
        END;
        v_tmax := CASE v_stat_id
          WHEN 89  THEN 0
          WHEN 90  THEN 6
          WHEN 91  THEN 13
          WHEN 92  THEN 20
          WHEN 96  THEN 27
          WHEN 97  THEN 34
          WHEN 99  THEN NULL  -- open-ended
          ELSE NULL
        END;
      END IF;

      -- Set tier ranges for yards_allowed statIds
      IF v_canonical = 'yards_allowed' THEN
        v_tiered := true;
        v_tmin := CASE v_stat_id
          WHEN 123 THEN 0
          WHEN 124 THEN 100
          WHEN 125 THEN 200
          WHEN 128 THEN 300
          WHEN 129 THEN 350
          WHEN 130 THEN 400
          WHEN 131 THEN 450
          WHEN 132 THEN 500
          WHEN 133 THEN 550
          WHEN 134 THEN 600
          WHEN 135 THEN 650
          WHEN 136 THEN 700
          ELSE NULL
        END;
        v_tmax := CASE v_stat_id
          WHEN 123 THEN 99
          WHEN 124 THEN 199
          WHEN 125 THEN 299
          WHEN 128 THEN 349
          WHEN 129 THEN 399
          WHEN 130 THEN 449
          WHEN 131 THEN 499
          WHEN 132 THEN 549
          WHEN 133 THEN NULL  -- open-ended
          WHEN 134 THEN NULL
          WHEN 135 THEN NULL
          WHEN 136 THEN NULL
          ELSE NULL
        END;
      END IF;

      -- Return unmapped statIds for review without inserting
      IF v_canonical IS NULL THEN
        rule_id          := v_rule.rule_id;
        stat_key_result  := 'unmapped_espn_' || v_stat_id::text;
        provider_stat_id := v_stat_id::text;
        points_per_unit  := v_points;
        is_tiered        := false;
        status           := 'unmapped';
        RETURN NEXT;
        CONTINUE;
      END IF;

      -- Skip inserting tiered rows where both base points and all overrides are 0
      -- (indicates this tier is not used in this league's scoring)
      IF v_tiered AND v_points = 0 AND v_item.overrides IS NULL THEN
        rule_id          := v_rule.rule_id;
        stat_key_result  := v_canonical;
        provider_stat_id := v_stat_id::text;
        points_per_unit  := 0;
        is_tiered        := true;
        status           := 'skipped_zero_inactive';
        RETURN NEXT;
        CONTINUE;
      END IF;

      -- Upsert into draft_scoring_rule_values
      IF v_tiered THEN
        INSERT INTO draft_scoring_rule_values (
          draft_scoring_rule_id, provider, stat_key,
          provider_stat_id, provider_stat_key,
          points_per_unit, threshold_min, threshold_max,
          is_tiered, raw_item
        ) VALUES (
          v_rule.rule_id, v_rule.provider, v_canonical,
          v_stat_id::text, NULL,
          v_points, v_tmin, v_tmax,
          true, v_item.raw
        )
        ON CONFLICT DO NOTHING;
        -- For tiered: use DO NOTHING since multiple statIds map to same key/threshold
      ELSE
        INSERT INTO draft_scoring_rule_values (
          draft_scoring_rule_id, provider, stat_key,
          provider_stat_id, provider_stat_key,
          points_per_unit, threshold_min, threshold_max,
          is_tiered, raw_item
        ) VALUES (
          v_rule.rule_id, v_rule.provider, v_canonical,
          v_stat_id::text, NULL,
          v_points, NULL, NULL,
          false, v_item.raw
        )
        ON CONFLICT (draft_scoring_rule_id, stat_key)
          WHERE is_tiered = false
        DO UPDATE SET
          points_per_unit = EXCLUDED.points_per_unit,
          provider_stat_id = EXCLUDED.provider_stat_id,
          raw_item = EXCLUDED.raw_item,
          updated_at = now();
      END IF;

      rule_id          := v_rule.rule_id;
      stat_key_result  := v_canonical;
      provider_stat_id := v_stat_id::text;
      points_per_unit  := v_points;
      is_tiered        := v_tiered;
      status           := 'inserted';
      RETURN NEXT;

    END LOOP;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION normalize_draft_scoring_rules(uuid) TO authenticated;
