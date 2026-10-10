/*
# Fix split_historical_manager for durable identity corrections

## Problem
The existing split_historical_manager RPC only updates the team_managers row.
On re-import, save_historical_season deletes and rebuilds all team_managers
from the ESPN alias mapping, reversing the split.

## Fix
1. Look up the season_year and external_team_id for the team_manager row.
2. Identify which external_owner_id from the original manager's aliases
   corresponds to this team association.
3. Create the new manager.
4. Update the team_managers row.
5. Update primary_manager_id on season_teams if the split manager was primary.
6. Write a durable override row to league_history_manager_overrides so that
   future re-imports redirect the owner ID to the new manager for this
   specific team+season combination.
*/

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
  v_season_team_id uuid;
  v_orig_manager_id uuid;
  v_role text;
  v_season_year integer;
  v_ext_team_id text;
  v_ext_owner_id text;
  v_new_manager_id uuid;
  v_was_primary boolean;
BEGIN
  -- Look up the team_manager row with season and team info
  SELECT tm.season_team_id, tm.manager_id, tm.role,
         st.external_team_id, s.season_year
  INTO v_season_team_id, v_orig_manager_id, v_role, v_ext_team_id, v_season_year
  FROM league_history_team_managers tm
  JOIN league_history_season_teams st ON st.id = tm.season_team_id
  JOIN league_history_seasons s ON s.id = st.season_id
  WHERE tm.id = p_team_manager_id AND st.league_id = p_league_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Team manager association not found in this league.');
  END IF;

  v_was_primary := (v_role = 'primary');

  -- Find the ESPN owner ID that corresponds to the original manager.
  -- This is the owner ID that save_historical_season will use to match
  -- during re-import, so the override must target it.
  SELECT ma.external_owner_id INTO v_ext_owner_id
  FROM league_history_manager_aliases ma
  WHERE ma.manager_id = v_orig_manager_id
    AND ma.provider = 'espn'
  ORDER BY ma.created_at ASC
  LIMIT 1;

  -- Create new manager
  INSERT INTO league_history_managers (league_id, display_name)
  VALUES (p_league_id, p_new_display_name)
  RETURNING id INTO v_new_manager_id;

  -- Update the team_manager row to point to the new manager
  UPDATE league_history_team_managers
  SET manager_id = v_new_manager_id
  WHERE id = p_team_manager_id;

  -- If the split manager was the primary, update primary_manager_id on the season team
  IF v_was_primary THEN
    UPDATE league_history_season_teams
    SET primary_manager_id = v_new_manager_id
    WHERE id = v_season_team_id;
  END IF;

  -- Write a durable override so re-import preserves the split
  IF v_ext_owner_id IS NOT NULL THEN
    INSERT INTO league_history_manager_overrides (
      league_id, season_year, external_team_id, external_owner_id,
      provider, target_manager_id, note
    ) VALUES (
      p_league_id, v_season_year, v_ext_team_id, v_ext_owner_id,
      'espn', v_new_manager_id, 'Split from manager ' || v_orig_manager_id::text
    )
    ON CONFLICT (league_id, season_year, external_team_id, external_owner_id, provider)
    DO UPDATE SET target_manager_id = v_new_manager_id, created_at = now();
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'newManagerId', v_new_manager_id,
    'displayName', p_new_display_name,
    'seasonTeamId', v_season_team_id,
    'seasonYear', v_season_year,
    'externalTeamId', v_ext_team_id,
    'wasPrimary', v_was_primary,
    'overrideCreated', v_ext_owner_id IS NOT NULL
  );
END;
$$;
