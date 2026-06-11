/*
  Phase 3C - Migration 10
  Update drop_league_roster_player RPC to block drops when a pending
  trade proposal includes the player.

  Error message tells the user to resolve the trade first.
  No auto-cancel — the user must explicitly cancel or reject the trade.
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

  -- 3. Block drop if player is part of a pending trade
  IF EXISTS (
    SELECT 1
    FROM league_trade_proposal_players ltpp
    JOIN league_trade_proposals ltp ON ltp.id = ltpp.trade_proposal_id
    WHERE ltpp.league_roster_player_id = p_league_roster_player_id
      AND ltp.status = 'pending'
  ) THEN
    RAISE EXCEPTION 'This player is part of a pending trade. Cancel or reject that trade before dropping the player.';
  END IF;

  -- 4. Must be active
  IF v_row.roster_status != 'active' THEN
    RAISE EXCEPTION 'Player is not active (current status: %)', v_row.roster_status;
  END IF;

  -- 5. Check ownership
  SELECT owner_id INTO v_league_owner_id
  FROM leagues WHERE id = v_row.league_id;

  v_is_commissioner := (v_league_owner_id = v_caller_id);

  IF (v_row.user_id IS DISTINCT FROM v_caller_id) AND NOT v_is_commissioner THEN
    RAISE EXCEPTION 'Permission denied: you do not own this roster slot';
  END IF;

  -- 6. Validate draft context if provided
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
  END IF;

  -- 7. Mark roster row as dropped
  UPDATE league_roster_players
  SET roster_status = 'dropped',
      removed_at    = now()
  WHERE id = p_league_roster_player_id;

  -- 8. Remove draft pool exclusion
  IF p_draft_id IS NOT NULL AND v_row.sports_player_id IS NOT NULL THEN
    DELETE FROM draft_player_exclusions
    WHERE draft_id         = p_draft_id
      AND sports_player_id = v_row.sports_player_id;
  END IF;

  -- 9. Insert transaction log row
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

  RETURN jsonb_build_object(
    'success',                  true,
    'league_roster_player_id',  p_league_roster_player_id,
    'transaction_id',           v_tx_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION drop_league_roster_player(uuid, uuid) TO authenticated;
