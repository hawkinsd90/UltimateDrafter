/*
  # Fix rebuild_draft_player_exclusions to respect league_roster_players.roster_status

  ## Problem
  The existing function rebuilds draft_player_exclusions by reading external_roster_players
  directly. It does not check app-owned league_roster_players state. This means:

  - A player dropped before a draft exists will have roster_status = 'dropped' in
    league_roster_players, but their external_roster_players row still exists.
  - When a draft is created and rebuild_draft_player_exclusions runs, the dropped player
    gets re-added to draft_player_exclusions and is excluded from the draft pool,
    incorrectly blocking them from being drafted.

  ## Fix
  The INSERT now LEFT JOINs league_roster_players on external_roster_player_id.
  The WHERE clause adds:

    AND (lrp.id IS NULL OR lrp.roster_status = 'active')

  Meaning:
  - If no league_roster_players row exists for the snapshot row (legacy leagues
    or before the import seed ran), behave as before — exclude the player.
  - If a league_roster_players row exists with roster_status = 'active', exclude.
  - If a league_roster_players row exists with roster_status = 'dropped' (or any
    other non-active status), skip — do NOT create an exclusion row. The dropped
    player is available for the draft.

  ## Rookie draft behavior
  Dropped veterans will not appear in rookie pools because the frontend applies a
  years_exp = 0 filter. No special handling is needed in this function.
*/

CREATE OR REPLACE FUNCTION rebuild_draft_player_exclusions(p_draft_id uuid)
RETURNS TABLE (
  draft_id                        uuid,
  deleted_count                   int,
  inserted_count                  int,
  total_exclusions                int,
  mapped_team_count               int,
  ignored_unavailable_team_count  int,
  ignored_available_team_count    int,
  unresolved_roster_players_count int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted     int := 0;
  v_inserted    int := 0;
  v_total       int := 0;
  v_mapped      int := 0;
  v_ign_unavail int := 0;
  v_ign_avail   int := 0;
  v_unresolved  int := 0;
  v_league_id   uuid;
  v_caller_id   uuid := auth.uid();
BEGIN
  -- Verify caller is the league owner for this draft
  SELECT l.id INTO v_league_id
  FROM drafts d
  JOIN leagues l ON l.id = d.league_id
  WHERE d.id = p_draft_id
    AND l.owner_id = v_caller_id;

  IF v_league_id IS NULL THEN
    RAISE EXCEPTION 'Permission denied: caller is not the league owner for draft %', p_draft_id;
  END IF;

  -- Count team categories for the summary
  SELECT
    COUNT(*) FILTER (WHERE elt.mapping_status = 'mapped') INTO v_mapped
  FROM external_league_teams elt
  JOIN external_league_links ell ON ell.id = elt.link_id
  WHERE ell.draft_id = p_draft_id;

  SELECT
    COUNT(*) FILTER (WHERE elt.mapping_status = 'ignored' AND elt.player_pool_policy = 'unavailable'),
    COUNT(*) FILTER (WHERE elt.mapping_status = 'ignored' AND elt.player_pool_policy != 'unavailable')
  INTO v_ign_unavail, v_ign_avail
  FROM external_league_teams elt
  JOIN external_league_links ell ON ell.id = elt.link_id
  WHERE ell.draft_id = p_draft_id;

  -- Count unresolved roster players for the summary
  SELECT COUNT(*) INTO v_unresolved
  FROM external_roster_players erp
  JOIN external_league_teams elt ON elt.link_id = erp.link_id AND elt.external_team_id = erp.external_team_id
  JOIN external_league_links ell ON ell.id = erp.link_id
  WHERE ell.draft_id = p_draft_id
    AND erp.sports_player_id IS NULL
    AND (
      elt.mapping_status = 'mapped'
      OR (elt.mapping_status = 'ignored' AND elt.player_pool_policy = 'unavailable')
    );

  -- Delete all import-driven exclusions for this draft (preserves 'manual' rows)
  DELETE FROM draft_player_exclusions
  WHERE draft_player_exclusions.draft_id = p_draft_id
    AND source IN ('external_ignored_team', 'external_mapped_team');

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  -- Insert fresh exclusions, respecting app-owned roster state.
  --
  -- The LEFT JOIN to league_roster_players checks whether this provider snapshot
  -- row has a corresponding app-owned row. If it does and that row is not 'active'
  -- (e.g. 'dropped'), we skip creating an exclusion — the player is available.
  --
  -- If no app-owned row exists (lrp.id IS NULL), we fall back to the old behaviour
  -- and exclude the player (preserves correctness for older leagues without LRP rows).
  --
  -- Priority: mapped teams before ignored teams (DISTINCT ON + ORDER BY).
  INSERT INTO draft_player_exclusions (
    draft_id,
    sports_player_id,
    source,
    external_league_team_id,
    external_roster_player_id,
    reason
  )
  SELECT DISTINCT ON (erp.sports_player_id)
    p_draft_id,
    erp.sports_player_id,
    CASE WHEN elt.mapping_status = 'mapped' THEN 'external_mapped_team' ELSE 'external_ignored_team' END,
    elt.id,
    erp.id,
    CASE WHEN elt.mapping_status = 'mapped'
      THEN 'Mapped team: ' || elt.external_team_name
      ELSE 'Ignored team (unavailable): ' || elt.external_team_name
    END
  FROM external_roster_players erp
  JOIN external_league_teams elt
    ON  elt.link_id          = erp.link_id
    AND elt.external_team_id = erp.external_team_id
  JOIN external_league_links ell ON ell.id = erp.link_id
  -- Check app-owned roster state: skip players that have been dropped
  LEFT JOIN league_roster_players lrp
    ON lrp.external_roster_player_id = erp.id
  WHERE ell.draft_id = p_draft_id
    AND erp.sports_player_id IS NOT NULL
    AND (
      elt.mapping_status = 'mapped'
      OR (elt.mapping_status = 'ignored' AND elt.player_pool_policy = 'unavailable')
    )
    -- Only exclude players who are still active in app state,
    -- or have no app-owned row yet (legacy fallback behaviour).
    AND (lrp.id IS NULL OR lrp.roster_status = 'active')
  ORDER BY
    erp.sports_player_id,
    CASE WHEN elt.mapping_status = 'mapped' THEN 0 ELSE 1 END
  ON CONFLICT (draft_id, sports_player_id) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  SELECT COUNT(*) INTO v_total
  FROM draft_player_exclusions
  WHERE draft_player_exclusions.draft_id = p_draft_id;

  RETURN QUERY SELECT
    p_draft_id,
    v_deleted,
    v_inserted,
    v_total,
    v_mapped,
    v_ign_unavail,
    v_ign_avail,
    v_unresolved;
END;
$$;

GRANT EXECUTE ON FUNCTION rebuild_draft_player_exclusions(uuid) TO authenticated;
