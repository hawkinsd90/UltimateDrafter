/*
# Fix save_historical_season: championship lookup and column references

## Problem
The championship team lookup used `SELECT external_team_id FROM jsonb_array_elements(...)`
but jsonb_array_elements returns a scalar jsonb value, not a row with named columns.
The correct syntax is `SELECT team_obj->>'externalTeamId' FROM jsonb_array_elements(...) AS team_obj`.

## Fix
- Fix champion/runner-up lookup to use ->> operator
- Ensure all JSONB field access uses ->> for text or -> for jsonb
*/
CREATE OR REPLACE FUNCTION public.save_historical_season(
  p_league_id uuid,
  p_season_year int,
  p_data jsonb,
  p_caller_user_id uuid,
  p_external_link_id uuid DEFAULT NULL,
  p_provider text DEFAULT 'espn',
  p_external_league_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_season_id uuid;
  v_existing_season_id uuid;
  v_draft_id uuid;
  v_team_uuid uuid;
  v_team_id_map jsonb := '{}'::jsonb;
  v_owner_id text;
  v_manager_id uuid;
  v_alias_id uuid;
  v_teams_imported int := 0;
  v_matchups_imported int := 0;
  v_draft_picks_imported int := 0;
  v_managers_matched int := 0;
  v_managers_created int := 0;
  v_warnings jsonb := '[]'::jsonb;
  v_pick_row jsonb;
  v_matchup_row jsonb;
  v_champion_team_id text;
  v_runner_up_team_id text;
  v_team_json jsonb;
BEGIN
  IF p_data ? 'warnings' AND jsonb_typeof(p_data->'warnings') = 'array' THEN
    v_warnings := p_data->'warnings';
  END IF;

  -- ── 1. Upsert season ──────────────────────────────────────────────────────
  SELECT id INTO v_existing_season_id
  FROM league_history_seasons
  WHERE league_id = p_league_id AND season_year = p_season_year
  FOR UPDATE;

  IF v_existing_season_id IS NOT NULL THEN
    v_season_id := v_existing_season_id;
    UPDATE league_history_seasons SET
      external_link_id = p_external_link_id,
      external_league_id = p_external_league_id,
      display_name = COALESCE(p_data->>'displayName', display_name),
      num_teams = COALESCE((p_data->>'numTeams')::int, num_teams),
      scoring_type = COALESCE(p_data->>'scoringType', scoring_type),
      raw_settings = COALESCE(p_data->'rawSettings', raw_settings),
      raw_scoring = COALESCE(p_data->'rawScoring', raw_scoring),
      import_status = 'complete',
      import_completeness = COALESCE(p_data->'completeness', import_completeness),
      import_errors = COALESCE(v_warnings, '[]'::jsonb),
      imported_at = now(),
      imported_by = p_caller_user_id,
      updated_at = now()
    WHERE id = v_season_id;
  ELSE
    INSERT INTO league_history_seasons (
      league_id, external_link_id, season_year, external_league_id,
      display_name, num_teams, scoring_type, raw_settings, raw_scoring,
      import_status, import_completeness, import_errors,
      imported_at, imported_by, updated_at
    ) VALUES (
      p_league_id, p_external_link_id, p_season_year, p_external_league_id,
      COALESCE(p_data->>'displayName', 'Unknown'), COALESCE((p_data->>'numTeams')::int, 0),
      COALESCE(p_data->>'scoringType', 'custom'),
      COALESCE(p_data->'rawSettings', '{}'::jsonb),
      COALESCE(p_data->'rawScoring', '{}'::jsonb),
      'complete', COALESCE(p_data->'completeness', '{}'::jsonb),
      COALESCE(v_warnings, '[]'::jsonb),
      now(), p_caller_user_id, now()
    )
    RETURNING id INTO v_season_id;
  END IF;

  -- ── 2. Match managers by provider owner ID ────────────────────────────────
  FOR v_team_json IN SELECT * FROM jsonb_array_elements(p_data->'teams')
  LOOP
    FOR v_owner_id IN SELECT * FROM jsonb_array_elements_text(v_team_json->'owners')
    LOOP
      IF v_team_id_map ? ('mgr_' || v_owner_id) THEN
        CONTINUE;
      END IF;

      SELECT ma.manager_id INTO v_manager_id
      FROM league_history_manager_aliases ma
      JOIN league_history_managers m ON m.id = ma.manager_id
      WHERE ma.provider = p_provider
        AND ma.external_owner_id = v_owner_id
        AND m.league_id = p_league_id
      LIMIT 1;

      IF v_manager_id IS NOT NULL THEN
        v_managers_matched := v_managers_matched + 1;
      ELSE
        INSERT INTO league_history_managers (league_id, display_name)
        VALUES (p_league_id, v_owner_id)
        RETURNING id INTO v_manager_id;

        INSERT INTO league_history_manager_aliases (
          manager_id, provider, external_owner_id, display_name,
          match_method, match_confidence
        ) VALUES (
          v_manager_id, p_provider, v_owner_id, v_owner_id,
          'auto_id', 1.0
        )
        RETURNING id INTO v_alias_id;

        v_managers_created := v_managers_created + 1;
      END IF;

      v_team_id_map := jsonb_set(v_team_id_map, ('mgr_' || v_owner_id), to_jsonb(v_manager_id));
    END LOOP;
  END LOOP;

  -- ── 3. Delete existing child data ─────────────────────────────────────────
  DELETE FROM league_history_draft_picks WHERE season_id = v_season_id;
  DELETE FROM league_history_drafts WHERE season_id = v_season_id;
  DELETE FROM league_history_matchups WHERE season_id = v_season_id;
  DELETE FROM league_history_team_managers
    WHERE season_team_id IN (
      SELECT id FROM league_history_season_teams WHERE season_id = v_season_id
    );
  DELETE FROM league_history_season_teams WHERE season_id = v_season_id;

  -- ── 4. Insert season teams ────────────────────────────────────────────────
  FOR v_team_json IN SELECT * FROM jsonb_array_elements(p_data->'teams')
  LOOP
    DECLARE
      v_ext_team_id text := v_team_json->>'externalTeamId';
      v_primary_owner text;
      v_primary_mgr_id uuid;
    BEGIN
      v_primary_owner := v_team_json->>'primaryOwner';
      IF v_primary_owner IS NOT NULL AND v_team_id_map ? ('mgr_' || v_primary_owner) THEN
        v_primary_mgr_id := (v_team_id_map -> ('mgr_' || v_primary_owner))::text::uuid;
      END IF;

      INSERT INTO league_history_season_teams (
        season_id, league_id, external_team_id, team_name, team_abbrev,
        primary_manager_id, wins, losses, ties, points_for, points_against,
        playoff_seed, final_standing, is_champion, is_runner_up,
        eliminated, elimination_period, raw_team_data
      ) VALUES (
        v_season_id, p_league_id, v_ext_team_id,
        COALESCE(v_team_json->>'teamName', 'Unknown'),
        COALESCE(v_team_json->>'teamAbbrev', ''),
        v_primary_mgr_id,
        COALESCE((v_team_json->>'wins')::int, 0),
        COALESCE((v_team_json->>'losses')::int, 0),
        COALESCE((v_team_json->>'ties')::int, 0),
        COALESCE((v_team_json->>'pointsFor')::numeric, 0),
        COALESCE((v_team_json->>'pointsAgainst')::numeric, 0),
        NULLIF((v_team_json->>'playoffSeed')::int, 0),
        NULLIF((v_team_json->>'finalStanding')::int, 0),
        (v_team_json->>'finalStanding')::int = 1,
        (v_team_json->>'finalStanding')::int = 2,
        COALESCE((v_team_json->>'eliminated')::boolean, false),
        NULLIF((v_team_json->>'eliminationPeriod')::int, 0),
        COALESCE(v_team_json->'rawTeamData', '{}'::jsonb)
      )
      RETURNING id INTO v_team_uuid;

      v_team_id_map := jsonb_set(v_team_id_map, v_ext_team_id, to_jsonb(v_team_uuid));
      v_teams_imported := v_teams_imported + 1;
    END;
  END LOOP;

  -- ── 5. Insert team_managers ───────────────────────────────────────────────
  FOR v_team_json IN SELECT * FROM jsonb_array_elements(p_data->'teams')
  LOOP
    DECLARE
      v_ext_team_id text := v_team_json->>'externalTeamId';
      v_season_team_id uuid;
      v_owner text;
      v_mgr_id uuid;
      v_is_primary boolean;
    BEGIN
      v_season_team_id := (v_team_id_map -> v_ext_team_id)::text::uuid;
      IF v_season_team_id IS NULL THEN CONTINUE; END IF;

      FOR v_owner IN SELECT * FROM jsonb_array_elements_text(v_team_json->'owners')
      LOOP
        IF NOT v_team_id_map ? ('mgr_' || v_owner) THEN CONTINUE; END IF;
        v_mgr_id := (v_team_id_map -> ('mgr_' || v_owner))::text::uuid;
        v_is_primary := (v_owner = v_team_json->>'primaryOwner');

        INSERT INTO league_history_team_managers (season_team_id, manager_id, role)
        VALUES (v_season_team_id, v_mgr_id, CASE WHEN v_is_primary THEN 'primary' ELSE 'co_manager' END)
        ON CONFLICT (season_team_id, manager_id) DO NOTHING;
      END LOOP;
    END;
  END LOOP;

  -- ── 6. Insert matchups ────────────────────────────────────────────────────
  FOR v_matchup_row IN SELECT * FROM jsonb_array_elements(p_data->'matchups')
  LOOP
    DECLARE
      v_home_ext text;
      v_away_ext text;
      v_home_id uuid;
      v_away_id uuid;
    BEGIN
      v_home_ext := v_matchup_row->>'homeTeamId';
      v_away_ext := v_matchup_row->>'awayTeamId';
      IF v_home_ext IS NOT NULL AND v_team_id_map ? v_home_ext THEN
        v_home_id := (v_team_id_map -> v_home_ext)::text::uuid;
      END IF;
      IF v_away_ext IS NOT NULL AND v_team_id_map ? v_away_ext THEN
        v_away_id := (v_team_id_map -> v_away_ext)::text::uuid;
      END IF;

      INSERT INTO league_history_matchups (
        season_id, league_id, source_matchup_id, matchup_period, classification,
        home_team_id, away_team_id, home_score, away_score, winner, raw_matchup_data
      ) VALUES (
        v_season_id, p_league_id,
        COALESCE((v_matchup_row->>'sourceMatchupId')::int, 0),
        COALESCE((v_matchup_row->>'matchupPeriod')::int, 0),
        COALESCE(v_matchup_row->>'classification', 'regular'),
        v_home_id, v_away_id,
        NULLIF((v_matchup_row->>'homeScore')::numeric, NULL),
        NULLIF((v_matchup_row->>'awayScore')::numeric, NULL),
        v_matchup_row->>'winner',
        COALESCE(v_matchup_row->'rawMatchupData', '{}'::jsonb)
      );
      v_matchups_imported := v_matchups_imported + 1;
    END;
  END LOOP;

  -- ── 7. Insert draft + picks ───────────────────────────────────────────────
  IF p_data ? 'draft' AND p_data->'draft' IS NOT NULL AND (p_data->'draft'->>'numPicks')::int > 0 THEN
    DECLARE
      v_draft jsonb := p_data->'draft';
      v_completed_at timestamptz;
    BEGIN
      IF v_draft ? 'completedAt' AND (v_draft->>'completedAt') IS NOT NULL THEN
        v_completed_at := to_timestamp((v_draft->>'completedAt')::bigint / 1000.0);
      END IF;

      INSERT INTO league_history_drafts (
        season_id, league_id, draft_type, num_rounds, num_picks,
        completed_at, raw_draft_detail
      ) VALUES (
        v_season_id, p_league_id,
        COALESCE(v_draft->>'draftType', 'unknown'),
        COALESCE((v_draft->>'numRounds')::int, 0),
        COALESCE((v_draft->>'numPicks')::int, 0),
        v_completed_at,
        COALESCE(v_draft->'rawDraftDetail', '{}'::jsonb)
      )
      RETURNING id INTO v_draft_id;

      FOR v_pick_row IN SELECT * FROM jsonb_array_elements(v_draft->'picks')
      LOOP
        DECLARE
          v_pick_team_ext text;
          v_pick_team_id uuid;
        BEGIN
          v_pick_team_ext := v_pick_row->>'teamId';
          IF v_pick_team_ext IS NOT NULL AND v_pick_team_ext != '' AND v_team_id_map ? v_pick_team_ext THEN
            v_pick_team_id := (v_team_id_map -> v_pick_team_ext)::text::uuid;
          END IF;

          INSERT INTO league_history_draft_picks (
            draft_id, season_id, league_id, overall_pick_number,
            round_number, round_pick_number, team_id, external_team_id,
            external_player_id, player_name, player_position,
            is_keeper, auction_bid_amount, raw_pick_data
          ) VALUES (
            v_draft_id, v_season_id, p_league_id,
            COALESCE((v_pick_row->>'overallPickNumber')::int, 0),
            COALESCE((v_pick_row->>'roundNumber')::int, 0),
            NULLIF((v_pick_row->>'roundPickNumber')::int, 0),
            v_pick_team_id,
            NULLIF(v_pick_row->>'teamId', ''),
            v_pick_row->>'externalPlayerId',
            NULLIF(v_pick_row->>'playerName', ''),
            NULL,
            COALESCE((v_pick_row->>'isKeeper')::boolean, false),
            NULLIF((v_pick_row->>'auctionBidAmount')::numeric, 0),
            COALESCE(v_pick_row->'rawPickData', '{}'::jsonb)
          );
        END;
      END LOOP;

      v_draft_picks_imported := (v_draft->>'numPicks')::int;
    END;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'seasonId', v_season_id,
    'seasonYear', p_season_year,
    'displayName', COALESCE(p_data->>'displayName', 'Unknown'),
    'teamsImported', v_teams_imported,
    'matchupsImported', v_matchups_imported,
    'draftPicksImported', v_draft_picks_imported,
    'managersMatched', v_managers_matched,
    'managersCreated', v_managers_created,
    'completeness', COALESCE(p_data->'completeness', '{}'::jsonb),
    'warnings', v_warnings
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_historical_season(uuid, int, jsonb, uuid, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_historical_season(uuid, int, jsonb, uuid, uuid, text, text) TO anon;