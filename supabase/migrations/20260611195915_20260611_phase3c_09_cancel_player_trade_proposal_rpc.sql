/*
  Phase 3C - Migration 9
  RPC: cancel_player_trade_proposal

  Proposer or league owner/commissioner can cancel a pending proposal.
  Commissioner cancels are logged with commissioner_action = true.
  No roster mutation. No transaction rows needed for cancel.
*/

CREATE OR REPLACE FUNCTION cancel_player_trade_proposal(
  p_trade_proposal_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id         uuid := auth.uid();
  v_proposal          league_trade_proposals%ROWTYPE;
  v_league_owner_id   uuid;
  v_is_commissioner   boolean := false;
  v_is_proposer       boolean := false;
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

  -- Check proposer
  v_is_proposer := (v_proposal.proposer_user_id = v_caller_id);

  -- Check commissioner/league owner
  SELECT owner_id INTO v_league_owner_id
  FROM leagues WHERE id = v_proposal.league_id;

  v_is_commissioner := (v_league_owner_id = v_caller_id);

  IF NOT v_is_proposer AND NOT v_is_commissioner THEN
    RAISE EXCEPTION 'Only the proposing team owner or league commissioner may cancel this trade';
  END IF;

  UPDATE league_trade_proposals
  SET status              = 'canceled',
      resolved_by_user_id = v_caller_id,
      commissioner_action = v_is_commissioner AND NOT v_is_proposer,
      commissioner_note   = CASE
                              WHEN v_is_commissioner AND NOT v_is_proposer
                              THEN 'Commissioner canceled this trade proposal'
                              ELSE NULL
                            END,
      updated_at          = now()
  WHERE id = p_trade_proposal_id;

  RETURN jsonb_build_object(
    'success',            true,
    'commissioner_action', v_is_commissioner AND NOT v_is_proposer
  );
END;
$$;

GRANT EXECUTE ON FUNCTION cancel_player_trade_proposal(uuid) TO authenticated;
