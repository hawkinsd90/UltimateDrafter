/*
# Fix split_historical_manager owner ID identification

## Problem
The deployed `split_historical_manager` RPC identified the ESPN owner ID by
taking the first alias from `league_history_manager_aliases` ordered by
`created_at`. This is unsafe because:

1. A manager can have multiple ESPN aliases across seasons. The first alias
   by created_at may belong to a different season than the one being split,
   causing the override to be keyed to the wrong owner ID.
2. If no matching alias exists, the RPC creates a new manager and updates
   associations but silently skips creating the durable override, reporting
   success for a non-durable correction.

## Correction
The `raw_team_data` JSONB on `league_history_season_teams` stores the ESPN
`owners` array and `primaryOwner` field for each team in each season. This
is the per-team-per-season source of truth for which ESPN owner IDs were on
that team.

The corrected RPC now:

1. Loads `raw_team_data` from the season team.
2. For **primary** role: uses `primaryOwner` from `raw_team_data` as the
   ESPN owner ID. This is exactly what `save_historical_season` uses in
   step 4 to set `primary_manager_id` and in step 5 to create the primary
   team_manager row.
3. For **co_manager** role: finds the owner ID in `owners[]` (excluding
   `primaryOwner`) whose alias maps to the original manager. If exactly one
   match, uses it. If zero matches, falls back to the sole non-primary
   owner if there is only one. If multiple matches or no unambiguous
   candidate, returns an error.
4. Fails early (before creating any new manager) if the owner ID cannot be
   determined — no silent partial success.
5. Always creates the durable override when the owner ID is known. Removes
   the `IF v_ext_owner_id IS NOT NULL` guard that allowed success without
   an override.

## Security
- No new tables or columns.
- `EXECUTE` remains revoked from `PUBLIC`, `anon`, and `authenticated`.
- The function is `SECURITY DEFINER` with `SET search_path = public`.
- League ownership is verified by the edge function before calling this RPC.
- The RPC additionally verifies the team_manager belongs to the specified league.
*/

DROP FUNCTION IF EXISTS split_historical_manager(uuid, uuid, text);

CREATE OR REPLACE FUNCTION split_historical_manager(
  p_team_manager_id uuid,
  p_league_id uuid,
  p_new_display_name text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_season_team_id   uuid;
  v_orig_manager_id  uuid;
  v_role             text;
  v_season_year      integer;
  v_ext_team_id      text;
  v_raw_team_data    jsonb;
  v_owners           jsonb;
  v_primary_owner    text;
  v_ext_owner_id     text;
  v_match_count      integer;
  v_non_primary_count integer;
  v_new_manager_id   uuid;
  v_was_primary      boolean;
BEGIN
  -- ── 1. Look up the team_manager row with season, team, and raw data ──────
  SELECT tm.season_team_id, tm.manager_id, tm.role,
         st.external_team_id, s.season_year, st.raw_team_data
  INTO v_season_team_id, v_orig_manager_id, v_role,
       v_ext_team_id, v_season_year, v_raw_team_data
  FROM league_history_team_managers tm
  JOIN league_history_season_teams st ON st.id = tm.season_team_id
  JOIN league_history_seasons s ON s.id = st.season_id
  WHERE tm.id = p_team_manager_id
    AND st.league_id = p_league_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Team manager association not found in this league.');
  END IF;

  v_was_primary := (v_role = 'primary');

  -- ── 2. Extract ESPN owner data from raw_team_data ────────────────────────
  v_owners := v_raw_team_data->'owners';
  v_primary_owner := v_raw_team_data->>'primaryOwner';

  IF v_owners IS NULL OR jsonb_typeof(v_owners) != 'array' OR jsonb_array_length(v_owners) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error',
      'No ESPN owner data found for this team. Raw team data is missing the owners array.');
  END IF;

  -- ── 3. Determine the correct ESPN owner ID for this association ──────────
  IF v_was_primary THEN
    -- For primary manager: use primaryOwner from raw_team_data.
    -- This is exactly what save_historical_season uses in step 4.
    v_ext_owner_id := v_primary_owner;

    IF v_ext_owner_id IS NULL THEN
      -- Fallback: if primaryOwner is missing, use the first owner.
      -- This is safe only if there is exactly one owner.
      IF jsonb_array_length(v_owners) = 1 THEN
        v_ext_owner_id := v_owners->>0;
      ELSE
        RETURN jsonb_build_object('success', false, 'error',
          'Primary owner ID is missing from raw team data and multiple owners exist. ' ||
          'Cannot determine which ESPN owner ID corresponds to this primary manager.');
      END IF;
    END IF;
  ELSE
    -- For co-manager: find the owner in owners[] (excluding primaryOwner)
    -- whose alias maps to the original manager.
    SELECT count(*) INTO v_match_count
    FROM league_history_manager_aliases a
    WHERE a.manager_id = v_orig_manager_id
      AND a.provider = 'espn'
      AND a.external_owner_id IN (
        SELECT t.owner_id
        FROM jsonb_array_elements_text(v_owners) AS t(owner_id)
        WHERE t.owner_id <> COALESCE(v_primary_owner, '')
      );

    IF v_match_count = 1 THEN
      SELECT a.external_owner_id INTO v_ext_owner_id
      FROM league_history_manager_aliases a
      WHERE a.manager_id = v_orig_manager_id
        AND a.provider = 'espn'
        AND a.external_owner_id IN (
          SELECT t.owner_id
          FROM jsonb_array_elements_text(v_owners) AS t(owner_id)
          WHERE t.owner_id <> COALESCE(v_primary_owner, '')
        )
      LIMIT 1;
    ELSIF v_match_count > 1 THEN
      RETURN jsonb_build_object('success', false, 'error',
        'Multiple ESPN owner IDs in this team map to the same manager. ' ||
        'Cannot determine which owner ID corresponds to this co-manager association. ' ||
        'Please contact support to resolve this ambiguity.');
    ELSE
      -- v_match_count = 0: no alias match among non-primary owners.
      -- Fallback: if there is exactly one non-primary owner, use it.
      SELECT count(*) INTO v_non_primary_count
      FROM jsonb_array_elements_text(v_owners) AS t(owner_id)
      WHERE t.owner_id <> COALESCE(v_primary_owner, '');

      IF v_non_primary_count = 1 THEN
        SELECT t.owner_id INTO v_ext_owner_id
        FROM jsonb_array_elements_text(v_owners) AS t(owner_id)
        WHERE t.owner_id <> COALESCE(v_primary_owner, '')
        LIMIT 1;
      ELSE
        RETURN jsonb_build_object('success', false, 'error',
          'Could not identify the ESPN owner ID for this co-manager association. ' ||
          'The manager has no matching alias among this team''s owners, ' ||
          'and there are ' || v_non_primary_count || ' non-primary owners. ' ||
          'Cannot create a durable override without a definitive owner ID.');
      END IF;
    END IF;
  END IF;

  -- ── 4. Create the new manager (owner ID is now validated) ────────────────
  INSERT INTO league_history_managers (league_id, display_name)
  VALUES (p_league_id, p_new_display_name)
  RETURNING id INTO v_new_manager_id;

  -- ── 5. Update the team_manager row to point to the new manager ───────────
  UPDATE league_history_team_managers
  SET manager_id = v_new_manager_id
  WHERE id = p_team_manager_id;

  -- ── 6. Update primary_manager_id if the split was primary ────────────────
  IF v_was_primary THEN
    UPDATE league_history_season_teams
    SET primary_manager_id = v_new_manager_id
    WHERE id = v_season_team_id;
  END IF;

  -- ── 7. Write the durable override (always — owner ID is validated) ───────
  INSERT INTO league_history_manager_overrides (
    league_id, season_year, external_team_id, external_owner_id,
    provider, target_manager_id, note
  ) VALUES (
    p_league_id, v_season_year, v_ext_team_id, v_ext_owner_id,
    'espn', v_new_manager_id, 'Split from manager ' || v_orig_manager_id::text
  )
  ON CONFLICT (league_id, season_year, external_team_id, external_owner_id, provider)
  DO UPDATE SET target_manager_id = v_new_manager_id, created_at = now();

  -- ── 8. Return success ────────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'success', true,
    'newManagerId', v_new_manager_id,
    'displayName', p_new_display_name,
    'seasonTeamId', v_season_team_id,
    'seasonYear', v_season_year,
    'externalTeamId', v_ext_team_id,
    'externalOwnerId', v_ext_owner_id,
    'wasPrimary', v_was_primary,
    'overrideCreated', true
  );
END;
$$;

-- Revoke public access (idempotent)
REVOKE EXECUTE ON FUNCTION split_historical_manager(uuid, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION split_historical_manager(uuid, uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION split_historical_manager(uuid, uuid, text) FROM authenticated;
