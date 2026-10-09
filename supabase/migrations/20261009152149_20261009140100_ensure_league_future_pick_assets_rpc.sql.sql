/*
# Phase 3D: ensure_league_future_pick_assets RPC

## Overview
Creates a SECURITY DEFINER function that generates missing future draft pick
assets for all league members. This is the foundation for future pick trading.

## Function: ensure_league_future_pick_assets(p_league_id uuid) → jsonb

### Behavior
1. Verifies the caller is a league member or the league owner.
2. Reads `leagues.season` to derive the base year (e.g. "2026-27" → 2026).
3. Reads `league_settings` for:
   - `allow_future_picks` — must be true to generate assets
   - `future_pick_years` — how many years ahead to create
   - `default_rounds` — how many rounds per year
4. Inserts missing pick assets for every league member, every future year,
   and every round. Uses `ON CONFLICT DO NOTHING` so existing assets (including
   traded ones) are never reset.
5. Returns a summary with the count of created assets.

### Season parsing
Parses `leagues.season` by extracting the first 4-digit year:
- "2026-27" → 2026
- "2026" → 2026
Malformed seasons raise an error rather than silently using the calendar year.

### Security
- SECURITY DEFINER with search_path = public
- Granted to authenticated role
- Caller must be a league member or league owner
*/

CREATE OR REPLACE FUNCTION ensure_league_future_pick_assets(
  p_league_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id        uuid := auth.uid();
  v_season           text;
  v_base_year        integer;
  v_allow_future     boolean;
  v_future_years     integer;
  v_rounds           integer;
  v_inserted_count   integer;
BEGIN
  -- 1. Auth required
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- 2. Verify caller is league member or owner
  IF NOT EXISTS (
    SELECT 1 FROM league_members lm
    WHERE lm.league_id = p_league_id AND lm.user_id = v_caller_id
  ) AND NOT EXISTS (
    SELECT 1 FROM leagues l
    WHERE l.id = p_league_id AND l.owner_id = v_caller_id
  ) THEN
    RAISE EXCEPTION 'You are not a member of this league';
  END IF;

  -- 3. Read league season
  SELECT season INTO v_season FROM leagues WHERE id = p_league_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'League not found';
  END IF;

  -- 4. Parse base year from season (e.g. "2026-27" → 2026, "2026" → 2026)
  v_base_year := substring(v_season from '\d{4}')::integer;
  IF v_base_year IS NULL THEN
    RAISE EXCEPTION 'Cannot parse league season "%". Expected format like "2026-27" or "2026".', v_season;
  END IF;

  -- 5. Read league settings
  SELECT
    allow_future_picks,
    future_pick_years,
    default_rounds
  INTO
    v_allow_future,
    v_future_years,
    v_rounds
  FROM league_settings
  WHERE league_id = p_league_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'League settings not found';
  END IF;

  IF NOT v_allow_future THEN
    RAISE EXCEPTION 'Future pick trading is not enabled for this league';
  END IF;

  IF v_future_years IS NULL OR v_future_years < 1 THEN
    v_future_years := 1;
  END IF;

  IF v_rounds IS NULL OR v_rounds < 1 THEN
    v_rounds := 15;
  END IF;

  -- 6. Insert missing pick assets (idempotent, never resets ownership)
  INSERT INTO league_draft_pick_assets (
    league_id,
    season_year,
    round_number,
    original_member_id,
    current_member_id
  )
  SELECT
    p_league_id,
    v_base_year + year_offset,
    round_number,
    member.id,
    member.id
  FROM league_members member
  CROSS JOIN generate_series(1, v_future_years) AS years(year_offset)
  CROSS JOIN generate_series(1, v_rounds) AS rounds(round_number)
  WHERE member.league_id = p_league_id
  ON CONFLICT (league_id, season_year, round_number, original_member_id)
    DO NOTHING;

  GET DIAGNOSTICS v_inserted_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'success',        true,
    'created_count',  v_inserted_count,
    'base_year',      v_base_year,
    'future_years',   v_future_years,
    'rounds',         v_rounds
  );
END;
$$;

GRANT EXECUTE ON FUNCTION ensure_league_future_pick_assets(uuid) TO authenticated;
