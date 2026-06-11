/*
  Phase 3C - Migration 8
  RPC: reject_player_trade_proposal

  Only the receiver can reject. Inserts one trade_reject transaction row
  per player in the proposal so history is preserved.
*/

CREATE OR REPLACE FUNCTION reject_player_trade_proposal(
  p_trade_proposal_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id       uuid := auth.uid();
  v_proposal        league_trade_proposals%ROWTYPE;
  v_receiver_member league_members%ROWTYPE;
  v_pp              league_trade_proposal_players%ROWTYPE;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_proposal
  FROM league_trade_proposals
  WHERE id = p_trade_proposal_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trade proposal not found';
  END IF;

  IF v_proposal.status != 'pending' THEN
    RAISE EXCEPTION 'This trade proposal is no longer pending (status: %)', v_proposal.status;
  END IF;

  SELECT * INTO v_receiver_member
  FROM league_members
  WHERE id = v_proposal.receiver_member_id;

  IF v_receiver_member.user_id IS DISTINCT FROM v_caller_id THEN
    RAISE EXCEPTION 'Only the receiving team owner may reject this trade';
  END IF;

  -- Insert a trade_reject transaction row per player
  FOR v_pp IN
    SELECT * FROM league_trade_proposal_players
    WHERE trade_proposal_id = p_trade_proposal_id
  LOOP
    DECLARE
      v_lrp league_roster_players%ROWTYPE;
    BEGIN
      SELECT * INTO v_lrp FROM league_roster_players WHERE id = v_pp.league_roster_player_id;

      INSERT INTO league_roster_transactions (
        league_id,
        transaction_type,
        actor_user_id,
        from_league_member_id,
        imported_member_id,
        league_roster_player_id,
        sports_player_id,
        external_player_name,
        external_position,
        trade_proposal_id,
        metadata
      ) VALUES (
        v_proposal.league_id,
        'trade_reject',
        v_caller_id,
        v_lrp.league_member_id,
        v_lrp.imported_member_id,
        v_pp.league_roster_player_id,
        v_lrp.sports_player_id,
        v_lrp.external_player_name,
        v_lrp.external_position,
        p_trade_proposal_id,
        jsonb_build_object('commissioner_action', false)
      );
    END;
  END LOOP;

  UPDATE league_trade_proposals
  SET status              = 'rejected',
      resolved_by_user_id = v_caller_id,
      commissioner_action = false,
      updated_at          = now()
  WHERE id = p_trade_proposal_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION reject_player_trade_proposal(uuid) TO authenticated;
