/*
  # Drop and recreate normalize_draft_scoring_rules with fixed return type

  The initial version used `is_tiered` as both a return column name and a local
  variable, causing Postgres to reject the ON CONFLICT ... WHERE predicate.
  The fix renames the return column to `result_is_tiered` and the local variable
  to `v_is_tiered`. Since the return type changed, we must drop and recreate.
*/

DROP FUNCTION IF EXISTS normalize_draft_scoring_rules(uuid);

CREATE FUNCTION normalize_draft_scoring_rules(
  p_draft_id uuid DEFAULT NULL
)
RETURNS TABLE (
  rule_id            uuid,
  stat_key_result    text,
  provider_stat_id   text,
  points_per_unit    numeric,
  result_is_tiered   boolean,
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
  v_is_tiered   boolean;
  v_tmin        numeric;
  v_tmax        numeric;
BEGIN
  FOR v_rule IN
    SELECT dsr.id AS rule_id, dsr.draft_id, dsr.source, dsr.scoring_type,
           dsr.raw_scoring,
           COALESCE(
             (SELECT ell.provider
              FROM external_league_links ell
              WHERE ell.draft_id = dsr.draft_id
              LIMIT 1),
             'espn'
           ) AS provider
    FROM draft_scoring_rules dsr
    WHERE (p_draft_id IS NULL OR dsr.draft_id = p_draft_id)
      AND dsr.raw_scoring IS NOT NULL
      AND dsr.raw_scoring ? 'scoringItems'
  LOOP

    FOR v_item IN
      SELECT
        (elem->>'statId')::integer                     AS stat_id,
        COALESCE((elem->>'points')::numeric, 0)        AS points,
        elem->'pointsOverrides'                        AS overrides,
        elem                                           AS raw
      FROM jsonb_array_elements(v_rule.raw_scoring->'scoringItems') AS elem
    LOOP
      v_stat_id   := v_item.stat_id;
      v_points    := v_item.points;
      v_is_tiered := false;
      v_tmin      := NULL;
      v_tmax      := NULL;

      v_canonical := CASE v_stat_id
        WHEN 3   THEN 'passing_yards'
        WHEN 4   THEN 'passing_tds'
        WHEN 19  THEN 'passing_2pt'
        WHEN 20  THEN 'passing_ints'
        WHEN 24  THEN 'rushing_yards'
        WHEN 25  THEN 'rushing_tds'
        WHEN 26  THEN 'rushing_2pt'
        WHEN 42  THEN 'receiving_yards'
        WHEN 43  THEN 'receiving_tds'
        WHEN 44  THEN 'receiving_2pt'
        WHEN 53  THEN 'receptions'
        WHEN 63  THEN 'return_tds'
        WHEN 72  THEN 'fumbles_lost'
        WHEN 112 THEN 'passing_yards_300_bonus'
        WHEN 113 THEN 'passing_yards_400_bonus'
        WHEN 114 THEN 'rushing_yards_100_bonus'
        WHEN 115 THEN 'rushing_yards_150_bonus'
        WHEN 77  THEN 'fg_made_40_49'
        WHEN 80  THEN 'fg_made_0_39'
        WHEN 85  THEN 'fg_missed'
        WHEN 86  THEN 'xp_made'
        WHEN 93  THEN 'def_tds'
        WHEN 95  THEN 'def_tds'
        WHEN 98  THEN 'sacks'
        WHEN 198 THEN 'sacks'
        WHEN 201 THEN 'def_interceptions'
        WHEN 206 THEN 'safeties'
        WHEN 209 THEN 'fumble_recoveries'
        WHEN 101 THEN 'return_tds'
        WHEN 102 THEN 'return_tds'
        WHEN 103 THEN 'return_tds'
        WHEN 104 THEN 'return_tds'
        WHEN 106 THEN 'blocks'
        WHEN 89  THEN 'points_allowed'
        WHEN 90  THEN 'points_allowed'
        WHEN 91  THEN 'points_allowed'
        WHEN 92  THEN 'points_allowed'
        WHEN 96  THEN 'points_allowed'
        WHEN 97  THEN 'points_allowed'
        WHEN 99  THEN 'points_allowed'
        WHEN 123 THEN 'yards_allowed'
        WHEN 124 THEN 'yards_allowed'
        WHEN 125 THEN 'yards_allowed'
        WHEN 128 THEN 'yards_allowed'
        WHEN 129 THEN 'yards_allowed'
        WHEN 130 THEN 'yards_allowed'
        WHEN 131 THEN 'yards_allowed'
        WHEN 132 THEN 'yards_allowed'
        WHEN 133 THEN 'yards_allowed'
        WHEN 134 THEN 'yards_allowed'
        WHEN 135 THEN 'yards_allowed'
        WHEN 136 THEN 'yards_allowed'
        ELSE NULL
      END;

      IF v_canonical = 'points_allowed' THEN
        v_is_tiered := true;
        v_tmin := CASE v_stat_id
          WHEN 89 THEN 0   WHEN 90 THEN 1   WHEN 91 THEN 7
          WHEN 92 THEN 14  WHEN 96 THEN 21  WHEN 97 THEN 28
          WHEN 99 THEN 35  ELSE NULL
        END;
        v_tmax := CASE v_stat_id
          WHEN 89 THEN 0   WHEN 90 THEN 6   WHEN 91 THEN 13
          WHEN 92 THEN 20  WHEN 96 THEN 27  WHEN 97 THEN 34
          WHEN 99 THEN NULL  ELSE NULL
        END;
      END IF;

      IF v_canonical = 'yards_allowed' THEN
        v_is_tiered := true;
        v_tmin := CASE v_stat_id
          WHEN 123 THEN 0    WHEN 124 THEN 100  WHEN 125 THEN 200
          WHEN 128 THEN 300  WHEN 129 THEN 350  WHEN 130 THEN 400
          WHEN 131 THEN 450  WHEN 132 THEN 500  WHEN 133 THEN 550
          WHEN 134 THEN 600  WHEN 135 THEN 650  WHEN 136 THEN 700
          ELSE NULL
        END;
        v_tmax := CASE v_stat_id
          WHEN 123 THEN 99   WHEN 124 THEN 199  WHEN 125 THEN 299
          WHEN 128 THEN 349  WHEN 129 THEN 399  WHEN 130 THEN 449
          WHEN 131 THEN 499  WHEN 132 THEN 549
          ELSE NULL
        END;
      END IF;

      IF v_canonical IS NULL THEN
        rule_id          := v_rule.rule_id;
        stat_key_result  := 'unmapped_espn_' || v_stat_id::text;
        provider_stat_id := v_stat_id::text;
        points_per_unit  := v_points;
        result_is_tiered := false;
        status           := 'unmapped';
        RETURN NEXT;
        CONTINUE;
      END IF;

      IF v_is_tiered AND v_points = 0 AND v_item.overrides IS NULL THEN
        rule_id          := v_rule.rule_id;
        stat_key_result  := v_canonical;
        provider_stat_id := v_stat_id::text;
        points_per_unit  := 0;
        result_is_tiered := true;
        status           := 'skipped_zero_inactive';
        RETURN NEXT;
        CONTINUE;
      END IF;

      IF v_is_tiered THEN
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
        ON CONFLICT ON CONSTRAINT draft_scoring_rule_values_normal_unique
        DO UPDATE SET
          points_per_unit  = EXCLUDED.points_per_unit,
          provider_stat_id = EXCLUDED.provider_stat_id,
          raw_item         = EXCLUDED.raw_item,
          updated_at       = now();
      END IF;

      rule_id          := v_rule.rule_id;
      stat_key_result  := v_canonical;
      provider_stat_id := v_stat_id::text;
      points_per_unit  := v_points;
      result_is_tiered := v_is_tiered;
      status           := 'inserted';
      RETURN NEXT;

    END LOOP;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION normalize_draft_scoring_rules(uuid) TO authenticated;
