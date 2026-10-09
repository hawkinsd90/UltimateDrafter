/*
# Phase 3D: Update reject RPC for picks + enable realtime

## Overview
1. Updates `reject_player_trade_proposal` to also log pick rejection
   (no ownership change — picks are only released from the pending state).
2. The cancel function already works correctly for picks because pick
   ownership only changes on acceptance. No changes needed to cancel logic.
3. Enables realtime for the new pick tables.
*/

-- ============================================================================
-- Update reject to handle picks
-- ============================================================================
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
  v_pick_prop       league_trade_proposal_picks%ROWTYPE;
  v_pick            league_draft_pick_assets%ROWTYPE;
  v_from_team_name  text;
  v_to_team_name    text;
  v_proposer_member league_members%ROWTYPE;
  v_pick_label      text;
  v_pick_from_member uuid;
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

  -- Load proposer for team name resolution
  SELECT * INTO v_proposer_member
  FROM league_members
  WHERE id = v_proposal.proposer_member_id;

  SELECT team_name INTO v_from_team_name
  FROM league_imported_members lim
  WHERE lim.invited_user_id = v_proposer_member.user_id
    AND lim.league_id = v_proposal.league_id
  LIMIT 1;

  SELECT team_name INTO v_to_team_name
  FROM league_imported_members lim
  WHERE lim.invited_user_id = v_receiver_member.user_id
    AND lim.league_id = v_proposal.league_id
  LIMIT 1;

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

  -- Insert a trade_reject pick transaction row per pick (no ownership change)
  FOR v_pick_prop IN
    SELECT * FROM league_trade_proposal_picks
    WHERE trade_proposal_id = p_trade_proposal_id
  LOOP
    SELECT * INTO v_pick FROM league_draft_pick_assets WHERE id = v_pick_prop.pick_asset_id;
    v_pick_label := v_pick.season_year::text || ' Round ' || v_pick.round_number::text;

    IF v_pick_prop.direction = 'send' THEN
      v_pick_from_member := v_proposal.proposer_member_id;
    ELSE
      v_pick_from_member := v_proposal.receiver_member_id;
    END IF;

    INSERT INTO league_draft_pick_transactions (
      league_id,
      pick_asset_id,
      trade_proposal_id,
      actor_user_id,
      from_member_id,
      to_member_id,
      season_year,
      round_number,
      metadata
    ) VALUES (
      v_proposal.league_id,
      v_pick_prop.pick_asset_id,
      p_trade_proposal_id,
      v_caller_id,
      v_pick_from_member,
      NULL,
      v_pick.season_year,
      v_pick.round_number,
      jsonb_build_object(
        'asset_kind', 'pick',
        'pick_label', v_pick_label,
        'action',     'reject'
      )
    );
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

-- ============================================================================
-- Enable realtime for new pick tables
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE league_draft_pick_assets;
    ALTER PUBLICATION supabase_realtime ADD TABLE league_trade_proposal_picks;
    ALTER PUBLICATION supabase_realtime ADD TABLE league_draft_pick_transactions;
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;
