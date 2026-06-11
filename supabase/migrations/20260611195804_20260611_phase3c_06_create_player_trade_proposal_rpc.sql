/*
  Phase 3C - Migration 6
  RPC: create_player_trade_proposal

  Creates a pending two-team player trade proposal.
  All validation is server-side; the client provides only IDs.
*/

CREATE OR REPLACE FUNCTION create_player_trade_proposal(
  p_league_id          uuid,
  p_receiver_member_id uuid,
  p_send_lrp_ids       uuid[],
  p_receive_lrp_ids    uuid[],
  p_message            text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id            uuid := auth.uid();
  v_proposer_member_id   uuid;
  v_receiver_member      league_members%ROWTYPE;
  v_proposal_id          uuid;
  v_expires_at           timestamptz;
  v_lrp                  league_roster_players%ROWTYPE;
  v_combined_ids         uuid[];
  v_lrp_id               uuid;
  v_snapshot_team        text;
BEGIN
  -- 1. Auth required
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- 2. Both sides must be non-empty
  IF array_length(p_send_lrp_ids, 1) IS NULL OR array_length(p_send_lrp_ids, 1) = 0 THEN
    RAISE EXCEPTION 'Both sides of a trade must include at least one player';
  END IF;
  IF array_length(p_receive_lrp_ids, 1) IS NULL OR array_length(p_receive_lrp_ids, 1) = 0 THEN
    RAISE EXCEPTION 'Both sides of a trade must include at least one player';
  END IF;

  -- 3. No player on both sides
  v_combined_ids := p_send_lrp_ids || p_receive_lrp_ids;
  IF (SELECT count(*) FROM (SELECT unnest(v_combined_ids)) AS u(id)) !=
     (SELECT count(DISTINCT id) FROM (SELECT unnest(v_combined_ids)) AS u(id)) THEN
    RAISE EXCEPTION 'The same player cannot appear on both sides of a trade';
  END IF;

  -- 4. Derive proposer league_member_id
  SELECT id INTO v_proposer_member_id
  FROM league_members
  WHERE league_id = p_league_id
    AND user_id   = v_caller_id;

  IF v_proposer_member_id IS NULL THEN
    RAISE EXCEPTION 'You are not a member of this league';
  END IF;

  -- 5. Validate receiver exists in same league and is not proposer
  SELECT * INTO v_receiver_member
  FROM league_members
  WHERE id       = p_receiver_member_id
    AND league_id = p_league_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Receiver is not a member of this league';
  END IF;

  IF v_receiver_member.id = v_proposer_member_id THEN
    RAISE EXCEPTION 'You cannot trade with yourself';
  END IF;

  -- 6. Validate send players (proposer's players)
  FOREACH v_lrp_id IN ARRAY p_send_lrp_ids LOOP
    SELECT * INTO v_lrp
    FROM league_roster_players
    WHERE id = v_lrp_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Roster player not found: %', v_lrp_id;
    END IF;
    IF v_lrp.roster_status != 'active' THEN
      RAISE EXCEPTION 'Player % is not on an active roster', COALESCE(v_lrp.external_player_name, v_lrp_id::text);
    END IF;
    IF v_lrp.user_id IS DISTINCT FROM v_caller_id THEN
      RAISE EXCEPTION 'You do not own %', COALESCE(v_lrp.external_player_name, 'this player');
    END IF;
    IF v_lrp.sports_player_id IS NULL THEN
      RAISE EXCEPTION '% is unresolved and cannot be traded. Resolve the player mapping first.', COALESCE(v_lrp.external_player_name, 'A player');
    END IF;
    IF EXISTS (
      SELECT 1 FROM league_trade_proposal_players ltpp
      JOIN league_trade_proposals ltp ON ltp.id = ltpp.trade_proposal_id
      WHERE ltpp.league_roster_player_id = v_lrp_id
        AND ltp.status = 'pending'
    ) THEN
      RAISE EXCEPTION '% is already part of a pending trade proposal', COALESCE(v_lrp.external_player_name, 'A player');
    END IF;
  END LOOP;

  -- 7. Validate receive players (receiver's players)
  FOREACH v_lrp_id IN ARRAY p_receive_lrp_ids LOOP
    SELECT * INTO v_lrp
    FROM league_roster_players
    WHERE id = v_lrp_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Roster player not found: %', v_lrp_id;
    END IF;
    IF v_lrp.roster_status != 'active' THEN
      RAISE EXCEPTION 'Player % is not on an active roster', COALESCE(v_lrp.external_player_name, v_lrp_id::text);
    END IF;
    IF v_lrp.league_member_id IS DISTINCT FROM p_receiver_member_id THEN
      RAISE EXCEPTION '% does not belong to the selected trade partner', COALESCE(v_lrp.external_player_name, 'A player');
    END IF;
    IF v_lrp.sports_player_id IS NULL THEN
      RAISE EXCEPTION '% is unresolved and cannot be traded. Resolve the player mapping first.', COALESCE(v_lrp.external_player_name, 'A player');
    END IF;
    IF EXISTS (
      SELECT 1 FROM league_trade_proposal_players ltpp
      JOIN league_trade_proposals ltp ON ltp.id = ltpp.trade_proposal_id
      WHERE ltpp.league_roster_player_id = v_lrp_id
        AND ltp.status = 'pending'
    ) THEN
      RAISE EXCEPTION '% is already part of a pending trade proposal', COALESCE(v_lrp.external_player_name, 'A player');
    END IF;
  END LOOP;

  -- 8. Insert proposal
  INSERT INTO league_trade_proposals (
    league_id, proposer_member_id, proposer_user_id, receiver_member_id, message
  )
  VALUES (
    p_league_id, v_proposer_member_id, v_caller_id, p_receiver_member_id, p_message
  )
  RETURNING id, expires_at INTO v_proposal_id, v_expires_at;

  -- 9. Insert proposal player rows (send side)
  FOREACH v_lrp_id IN ARRAY p_send_lrp_ids LOOP
    SELECT * INTO v_lrp FROM league_roster_players WHERE id = v_lrp_id;
    -- Snapshot team name from league_imported_members
    SELECT team_name INTO v_snapshot_team
    FROM league_imported_members WHERE id = v_lrp.imported_member_id;

    INSERT INTO league_trade_proposal_players (
      trade_proposal_id, direction,
      league_roster_player_id, sports_player_id,
      snapshot_player_name, snapshot_position, snapshot_team_name
    ) VALUES (
      v_proposal_id, 'send',
      v_lrp_id, v_lrp.sports_player_id,
      COALESCE(v_lrp.external_player_name, 'Unknown'), v_lrp.external_position,
      v_snapshot_team
    );
  END LOOP;

  -- 10. Insert proposal player rows (receive side)
  FOREACH v_lrp_id IN ARRAY p_receive_lrp_ids LOOP
    SELECT * INTO v_lrp FROM league_roster_players WHERE id = v_lrp_id;
    SELECT team_name INTO v_snapshot_team
    FROM league_imported_members WHERE id = v_lrp.imported_member_id;

    INSERT INTO league_trade_proposal_players (
      trade_proposal_id, direction,
      league_roster_player_id, sports_player_id,
      snapshot_player_name, snapshot_position, snapshot_team_name
    ) VALUES (
      v_proposal_id, 'receive',
      v_lrp_id, v_lrp.sports_player_id,
      COALESCE(v_lrp.external_player_name, 'Unknown'), v_lrp.external_position,
      v_snapshot_team
    );
  END LOOP;

  RETURN jsonb_build_object(
    'success',           true,
    'trade_proposal_id', v_proposal_id,
    'expires_at',        v_expires_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION create_player_trade_proposal(uuid, uuid, uuid[], uuid[], text) TO authenticated;
