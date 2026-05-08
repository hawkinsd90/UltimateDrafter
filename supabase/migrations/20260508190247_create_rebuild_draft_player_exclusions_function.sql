/*
  # Create rebuild_draft_player_exclusions function

  ## Summary
  Replaces the ad-hoc per-team delete/upsert pattern in TeamMapping with a single
  atomic database function that rebuilds all import-driven exclusions for a draft.

  ## What it does
  1. Deletes all existing exclusions that were created from imported roster data
     (source IN ('external_ignored_team', 'external_mapped_team')) for the draft.
     Preserves 'manual' and 'provider_import' source rows.
  2. Inserts fresh exclusions for:
     - Teams with mapping_status = 'mapped'  (source = 'external_mapped_team')
     - Teams with mapping_status = 'ignored' AND player_pool_policy = 'unavailable'
       (source = 'external_ignored_team')
  3. Deduplicates at the (draft_id, sports_player_id) level — a player appearing on
     multiple rosters gets one exclusion row (first mapped team wins, then ignored).
  4. Returns a summary row with counts for observability.

  ## Why a DB function
  - Atomic: no window where some teams are excluded and others are not
  - Reusable: called from TeamMapping save, admin tools, and future migrations
  - Security definer: runs as the function owner, bypassing RLS for the rebuild
    operation (callers must be authenticated; the RPC checks ownership)

  ## Source enum migration
  Adds 'external_mapped_team' to the CHECK constraint on draft_player_exclusions.source
  so mapped-team exclusions can be distinguished from ignored-team exclusions.

  ## Notes
  - UNIQUE (draft_id, sports_player_id) is preserved — ON CONFLICT DO NOTHING handles
    players on multiple rosters
  - player_pool_policy is intentionally ignored for mapped teams — all mapped roster
    players are excluded regardless
*/

-- Step 1: Extend the source CHECK constraint to include 'external_mapped_team'
ALTER TABLE draft_player_exclusions
  DROP CONSTRAINT IF EXISTS draft_player_exclusions_source_check;

ALTER TABLE draft_player_exclusions
  ADD CONSTRAINT draft_player_exclusions_source_check
    CHECK (source IN ('external_ignored_team', 'external_mapped_team', 'manual', 'provider_import'));

-- Step 2: Create the rebuild function
CREATE OR REPLACE FUNCTION rebuild_draft_player_exclusions(p_draft_id uuid)
RETURNS TABLE (
  draft_id                      uuid,
  deleted_count                 int,
  inserted_count                int,
  total_exclusions              int,
  mapped_team_count             int,
  ignored_unavailable_team_count int,
  ignored_available_team_count  int,
  unresolved_roster_players_count int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted   int := 0;
  v_inserted  int := 0;
  v_total     int := 0;
  v_mapped    int := 0;
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

  -- Count unresolved roster players
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

  -- Delete all import-driven exclusions for this draft
  DELETE FROM draft_player_exclusions
  WHERE draft_player_exclusions.draft_id = p_draft_id
    AND source IN ('external_ignored_team', 'external_mapped_team');

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  -- Insert fresh exclusions:
  --   Priority 1: mapped teams (source = 'external_mapped_team')
  --   Priority 2: ignored/unavailable teams (source = 'external_ignored_team')
  -- DISTINCT ON (sports_player_id) picks one row per player; ORDER ensures
  -- mapped rows come before ignored rows so mapped teams win on conflict.
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
  WHERE ell.draft_id = p_draft_id
    AND erp.sports_player_id IS NOT NULL
    AND (
      elt.mapping_status = 'mapped'
      OR (elt.mapping_status = 'ignored' AND elt.player_pool_policy = 'unavailable')
    )
  ORDER BY
    erp.sports_player_id,
    -- mapped teams have priority (0 sorts before 1)
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

-- Grant execute to authenticated users (ownership check is inside the function)
GRANT EXECUTE ON FUNCTION rebuild_draft_player_exclusions(uuid) TO authenticated;
