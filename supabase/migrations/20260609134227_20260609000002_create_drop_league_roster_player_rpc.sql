/*
  # Create drop_league_roster_player RPC

  SECURITY DEFINER function that:
  1. Verifies the caller is authenticated.
  2. Locks the league_roster_players row FOR UPDATE.
  3. Checks roster_status = 'active' (idempotent-safe error otherwise).
  4. Allows the drop if caller owns the row OR caller is league owner.
  5. If p_draft_id is provided, validates the draft belongs to the same league
     and is not completed.
  6. Sets roster_status = 'dropped', removed_at = now().
  7. Removes the matching draft_player_exclusions row (if any) so the dropped
     player immediately re-enters the available pool in standard/all-player drafts.
     (Rookie pool is governed by years_exp = 0 filtering in the frontend — no
     special handling needed here.)
  8. Inserts a league_roster_transactions row with transaction_type = 'drop'.
  9. Returns JSON with success + transaction_id.

  ## Trust model
  - league_id, user_id, member_id are all derived from the roster row itself.
  - The caller provides only p_league_roster_player_id (the row to drop)
    and optionally p_draft_id (for immediate pool exclusion removal).
  - The function never trusts client-provided league or identity values.
*/

CREATE OR REPLACE FUNCTION drop_league_roster_player(
  p_league_roster_player_id uuid,
  p_draft_id                uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id       uuid := auth.uid();
  v_row             league_roster_players%ROWTYPE;
  v_league_owner_id uuid;
  v_draft_status    text;
  v_draft_league_id uuid;
  v_is_commissioner boolean;
  v_tx_id           uuid;
BEGIN
  -- 1. Must be authenticated
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- 2. Fetch and lock the roster row
  SELECT * INTO v_row
  FROM league_roster_players
  WHERE id = p_league_roster_player_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Roster row not found';
  END IF;

  -- 3. Must be active — idempotent-safe error for double-drop attempts
  IF v_row.roster_status != 'active' THEN
    RAISE EXCEPTION 'Player is not active (current status: %)', v_row.roster_status;
  END IF;

  -- 4. Check ownership: caller owns row OR caller is league owner/commissioner
  SELECT owner_id INTO v_league_owner_id
  FROM leagues WHERE id = v_row.league_id;

  v_is_commissioner := (v_league_owner_id = v_caller_id);

  IF (v_row.user_id IS DISTINCT FROM v_caller_id) AND NOT v_is_commissioner THEN
    RAISE EXCEPTION 'Permission denied: you do not own this roster slot';
  END IF;

  -- 5. Validate draft context if provided
  IF p_draft_id IS NOT NULL THEN
    SELECT status, league_id
    INTO v_draft_status, v_draft_league_id
    FROM drafts
    WHERE id = p_draft_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Draft not found';
    END IF;
    IF v_draft_league_id != v_row.league_id THEN
      RAISE EXCEPTION 'Draft does not belong to this league';
    END IF;
    IF v_draft_status = 'completed' THEN
      RAISE EXCEPTION 'Cannot drop players after a draft is completed';
    END IF;
    -- Allow: pending, in_progress, paused
  END IF;

  -- 6. Mark roster row as dropped
  UPDATE league_roster_players
  SET roster_status = 'dropped',
      removed_at    = now()
  WHERE id = p_league_roster_player_id;

  -- 7. Remove draft pool exclusion so the player re-enters the available pool.
  --    Only applies when a draft context is provided and the player is resolved.
  --    Pre-draft drops (p_draft_id = null) rely on rebuild_draft_player_exclusions
  --    skipping dropped rows — handled by a separate migration.
  IF p_draft_id IS NOT NULL AND v_row.sports_player_id IS NOT NULL THEN
    DELETE FROM draft_player_exclusions
    WHERE draft_id        = p_draft_id
      AND sports_player_id = v_row.sports_player_id;
  END IF;

  -- 8. Insert transaction log row
  INSERT INTO league_roster_transactions (
    league_id,
    draft_id,
    transaction_type,
    actor_user_id,
    from_league_member_id,
    imported_member_id,
    league_roster_player_id,
    sports_player_id,
    external_player_name,
    external_position,
    metadata
  )
  VALUES (
    v_row.league_id,
    p_draft_id,
    'drop',
    v_caller_id,
    v_row.league_member_id,
    v_row.imported_member_id,
    v_row.id,
    v_row.sports_player_id,
    v_row.external_player_name,
    v_row.external_position,
    jsonb_build_object(
      'commissioner_action',
      v_is_commissioner AND (v_row.user_id IS DISTINCT FROM v_caller_id)
    )
  )
  RETURNING id INTO v_tx_id;

  -- 9. Return success payload
  RETURN jsonb_build_object(
    'success',                  true,
    'league_roster_player_id',  p_league_roster_player_id,
    'transaction_id',           v_tx_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION drop_league_roster_player(uuid, uuid) TO authenticated;
