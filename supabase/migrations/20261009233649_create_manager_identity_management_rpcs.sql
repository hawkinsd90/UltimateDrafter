/*
# Manager Identity Management RPCs

## Purpose
Provides commissioner controls for managing historical manager identities:
- Rename a manager's display name
- Link a manager to an existing UltimateDrafter user account
- Merge two duplicate managers into one (preserving all aliases, teams, picks)
- Split a co-manager from a primary manager (creating a new separate identity)

## Security
All functions are SECURITY DEFINER with search_path = public.
The edge function calls these with the service role key.
EXECUTE is granted only to authenticated (not anon) so the edge function
can call them via the service role while direct REST access by anon is blocked.

## Functions
1. rename_historical_manager(p_manager_id, p_league_id, p_display_name)
2. link_historical_manager(p_manager_id, p_league_id, p_linked_user_id)
3. merge_historical_managers(p_source_id, p_target_id, p_league_id)
4. split_historical_manager(p_team_manager_id, p_league_id, p_new_display_name)
*/

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Rename historical manager
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rename_historical_manager(
  p_manager_id uuid,
  p_league_id uuid,
  p_display_name text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_name text;
BEGIN
  SELECT display_name INTO v_old_name
  FROM league_history_managers
  WHERE id = p_manager_id AND league_id = p_league_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Manager not found in this league.');
  END IF;

  UPDATE league_history_managers
  SET display_name = p_display_name, updated_at = now()
  WHERE id = p_manager_id;

  RETURN jsonb_build_object(
    'success', true,
    'managerId', p_manager_id,
    'oldName', v_old_name,
    'newName', p_display_name
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Link historical manager to UltimateDrafter user
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.link_historical_manager(
  p_manager_id uuid,
  p_league_id uuid,
  p_linked_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE league_history_managers
  SET linked_user_id = p_linked_user_id, updated_at = now()
  WHERE id = p_manager_id AND league_id = p_league_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Manager not found in this league.');
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'managerId', p_manager_id,
    'linkedUserId', p_linked_user_id
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Merge two managers: move all aliases, season teams, and team_managers
--    from source to target, then delete source. Preserves co-manager roles.
--    Rejects if managers are in different leagues.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.merge_historical_managers(
  p_source_id uuid,
  p_target_id uuid,
  p_league_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source_league uuid;
  v_target_league uuid;
  v_merged_aliases int := 0;
  v_merged_teams int := 0;
BEGIN
  -- Verify both managers belong to the same league
  SELECT league_id INTO v_source_league FROM league_history_managers WHERE id = p_source_id;
  SELECT league_id INTO v_target_league FROM league_history_managers WHERE id = p_target_id;

  IF v_source_league IS NULL OR v_target_league IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'One or both managers not found.');
  END IF;

  IF v_source_league != p_league_id OR v_target_league != p_league_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Managers must belong to the specified league.');
  END IF;

  IF p_source_id = p_target_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot merge a manager with itself.');
  END IF;

  -- Move aliases to target (skip duplicates)
  INSERT INTO league_history_manager_aliases (manager_id, provider, external_owner_id, display_name, first_season, last_season, match_method, match_confidence, confirmed_by, confirmed_at)
  SELECT p_target_id, provider, external_owner_id, display_name, first_season, last_season, match_method, match_confidence, confirmed_by, confirmed_at
  FROM league_history_manager_aliases
  WHERE manager_id = p_source_id
  ON CONFLICT (manager_id, provider, external_owner_id) DO NOTHING;

  GET DIAGNOSTICS v_merged_aliases = ROW_COUNT;

  -- Move primary_manager_id references on season teams
  UPDATE league_history_season_teams
  SET primary_manager_id = p_target_id
  WHERE primary_manager_id = p_source_id;

  -- Move team_managers associations (skip duplicates)
  INSERT INTO league_history_team_managers (season_team_id, manager_id, role)
  SELECT season_team_id, p_target_id, role
  FROM league_history_team_managers
  WHERE manager_id = p_source_id
  ON CONFLICT (season_team_id, manager_id) DO NOTHING;

  GET DIAGNOSTICS v_merged_teams = ROW_COUNT;

  -- Delete source manager (cascades to remaining aliases and team_managers)
  DELETE FROM league_history_managers WHERE id = p_source_id;

  RETURN jsonb_build_object(
    'success', true,
    'sourceId', p_source_id,
    'targetId', p_target_id,
    'mergedAliases', v_merged_aliases,
    'mergedTeamAssociations', v_merged_teams
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Split a co-manager from a team: creates a new manager identity and
--    re-associates the team_manager row to the new manager.
--    The caller specifies which team_manager row to split.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.split_historical_manager(
  p_team_manager_id uuid,
  p_league_id uuid,
  p_new_display_name text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tm record;
  v_new_manager_id uuid;
BEGIN
  SELECT tm.season_team_id, tm.manager_id, tm.role
  INTO v_tm
  FROM league_history_team_managers tm
  JOIN league_history_season_teams st ON st.id = tm.season_team_id
  WHERE tm.id = p_team_manager_id AND st.league_id = p_league_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Team manager association not found in this league.');
  END IF;

  -- Create new manager
  INSERT INTO league_history_managers (league_id, display_name)
  VALUES (p_league_id, p_new_display_name)
  RETURNING id INTO v_new_manager_id;

  -- Update the team_manager row to point to the new manager
  UPDATE league_history_team_managers
  SET manager_id = v_new_manager_id
  WHERE id = p_team_manager_id;

  RETURN jsonb_build_object(
    'success', true,
    'newManagerId', v_new_manager_id,
    'displayName', p_new_display_name,
    'seasonTeamId', v_tm.season_team_id
  );
END;
$$;

-- Grant EXECUTE to authenticated (edge function uses service role which bypasses)
-- These will be revoked from authenticated in a follow-up to match save_historical_season
GRANT EXECUTE ON FUNCTION public.rename_historical_manager(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.link_historical_manager(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.merge_historical_managers(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.split_historical_manager(uuid, uuid, text) TO authenticated;
