/*
# Update merge_historical_managers to redirect override references

## Problem
When two managers are merged, override rows pointing to the source manager
become stale after the source is deleted (CASCADE would delete them, losing
the correction).

## Fix
Before deleting the source manager, update all override rows that reference
the source manager to point to the target manager instead.

## Also: Add membership validation to link_historical_manager

## Problem
link_historical_manager accepts any UUID for p_linked_user_id without
verifying that the user is a member of the specified league.

## Fix
Added a check: if p_linked_user_id is not NULL, verify the user exists in
league_members for the specified league. Reject if not found.
Unlinking (NULL) remains supported without validation.
*/

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
  v_overrides_updated int := 0;
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

  -- Redirect override references from source to target
  UPDATE league_history_manager_overrides
  SET target_manager_id = p_target_id
  WHERE target_manager_id = p_source_id;

  GET DIAGNOSTICS v_overrides_updated = ROW_COUNT;

  -- Delete source manager (cascades to remaining aliases and team_managers)
  DELETE FROM league_history_managers WHERE id = p_source_id;

  RETURN jsonb_build_object(
    'success', true,
    'sourceId', p_source_id,
    'targetId', p_target_id,
    'mergedAliases', v_merged_aliases,
    'mergedTeamAssociations', v_merged_teams,
    'overridesRedirected', v_overrides_updated
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- link_historical_manager: add league membership validation
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
DECLARE
  v_is_member boolean;
BEGIN
  -- Unlinking (NULL) is always allowed without validation
  IF p_linked_user_id IS NULL THEN
    UPDATE league_history_managers
    SET linked_user_id = NULL, updated_at = now()
    WHERE id = p_manager_id AND league_id = p_league_id;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'Manager not found in this league.');
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'managerId', p_manager_id,
      'linkedUserId', NULL
    );
  END IF;

  -- Verify the linked user is a member of the specified league
  SELECT EXISTS(
    SELECT 1 FROM league_members
    WHERE league_id = p_league_id AND user_id = p_linked_user_id
  ) INTO v_is_member;

  IF NOT v_is_member THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Linked user is not a member of this league.'
    );
  END IF;

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
