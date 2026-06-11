/*
  Phase 3C - Migration 7
  RPC: accept_player_trade_proposal

  Atomically swaps players between two teams:
  - Marks outgoing rows as 'traded'
  - Inserts new active rows for incoming players
  - Inserts one transaction row per moved player (all with same trade_proposal_id)
  - Safety-net draft exclusion INSERT for traded players
*/

CREATE OR REPLACE FUNCTION accept_player_trade_proposal(
  p_trade_proposal_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id              uuid := auth.uid();
  v_proposal               league_trade_proposals%ROWTYPE;
  v_receiver_member        league_members%ROWTYPE;
  v_proposer_member        league_members%ROWTYPE;

  v_pp                     league_trade_proposal_players%ROWTYPE;
  v_lrp                    league_roster_players%ROWTYPE;
  v_new_lrp_id             uuid;

  v_proposer_imported_id   uuid;
  v_receiver_imported_id   uuid;
  v_proposer_member_id     uuid;
  v_receiver_member_id     uuid;
  v_proposer_user_id       uuid;
  v_receiver_user_id       uuid;

  v_proposer_team_name     text;
  v_receiver_team_name     text;

  v_next_sort              integer;
  v_tx_ids                 uuid[] := '{}';
  v_tx_id                  uuid;
  v_draft                  RECORD;
BEGIN
  -- 1. Auth required
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- 2. Lock proposal row
  SELECT * INTO v_proposal
  FROM league_trade_proposals
  WHERE id = p_trade_proposal_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trade proposal not found';
  END IF;

  -- 3. Only pending proposals can be accepted
  IF v_proposal.status != 'pending' THEN
    RAISE EXCEPTION 'This trade proposal is no longer pending (status: %)', v_proposal.status;
  END IF;

  -- 4. Check expiry
  IF v_proposal.expires_at < now() THEN
    UPDATE league_trade_proposals
    SET status = 'expired', updated_at = now()
    WHERE id = p_trade_proposal_id;
    RAISE EXCEPTION 'This trade proposal has expired';
  END IF;

  -- 5. Only receiver can accept
  SELECT * INTO v_receiver_member
  FROM league_members
  WHERE id = v_proposal.receiver_member_id;

  IF v_receiver_member.user_id IS DISTINCT FROM v_caller_id THEN
    RAISE EXCEPTION 'Only the receiving team owner may accept this trade';
  END IF;

  -- 6. Load proposer member
  SELECT * INTO v_proposer_member
  FROM league_members
  WHERE id = v_proposal.proposer_member_id;

  -- Resolve imported member IDs from their respective league_members rows
  SELECT lim.id, lim.team_name INTO v_proposer_imported_id, v_proposer_team_name
  FROM league_imported_members lim
  WHERE lim.invited_user_id = v_proposer_member.user_id
    AND lim.league_id = v_proposal.league_id
  LIMIT 1;

  SELECT lim.id, lim.team_name INTO v_receiver_imported_id, v_receiver_team_name
  FROM league_imported_members lim
  WHERE lim.invited_user_id = v_receiver_member.user_id
    AND lim.league_id = v_proposal.league_id
  LIMIT 1;

  v_proposer_member_id := v_proposer_member.id;
  v_receiver_member_id := v_receiver_member.id;
  v_proposer_user_id   := v_proposer_member.user_id;
  v_receiver_user_id   := v_receiver_member.user_id;

  -- 7. Lock all involved roster rows and validate
  FOR v_pp IN
    SELECT * FROM league_trade_proposal_players
    WHERE trade_proposal_id = p_trade_proposal_id
  LOOP
    SELECT * INTO v_lrp
    FROM league_roster_players
    WHERE id = v_pp.league_roster_player_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Roster row not found for player %', v_pp.snapshot_player_name;
    END IF;
    IF v_lrp.roster_status != 'active' THEN
      RAISE EXCEPTION '% is no longer on an active roster and cannot be traded', v_pp.snapshot_player_name;
    END IF;
    -- Validate still on expected team
    IF v_pp.direction = 'send' AND v_lrp.league_member_id IS DISTINCT FROM v_proposer_member_id THEN
      RAISE EXCEPTION '% has moved teams since this trade was proposed', v_pp.snapshot_player_name;
    END IF;
    IF v_pp.direction = 'receive' AND v_lrp.league_member_id IS DISTINCT FROM v_receiver_member_id THEN
      RAISE EXCEPTION '% has moved teams since this trade was proposed', v_pp.snapshot_player_name;
    END IF;
  END LOOP;

  -- 8. Execute the swap
  FOR v_pp IN
    SELECT * FROM league_trade_proposal_players
    WHERE trade_proposal_id = p_trade_proposal_id
  LOOP
    SELECT * INTO v_lrp
    FROM league_roster_players
    WHERE id = v_pp.league_roster_player_id;

    -- Mark old row as traded
    UPDATE league_roster_players
    SET roster_status = 'traded',
        removed_at    = now()
    WHERE id = v_pp.league_roster_player_id;

    -- Determine receiving team's ownership columns
    -- 'send' direction: player moves proposer -> receiver
    -- 'receive' direction: player moves receiver -> proposer
    DECLARE
      v_new_imported_id   uuid;
      v_new_member_id     uuid;
      v_new_user_id       uuid;
      v_from_member_id    uuid;
      v_to_member_id      uuid;
      v_from_team_name    text;
      v_to_team_name      text;
    BEGIN
      IF v_pp.direction = 'send' THEN
        v_new_imported_id := v_receiver_imported_id;
        v_new_member_id   := v_receiver_member_id;
        v_new_user_id     := v_receiver_user_id;
        v_from_member_id  := v_proposer_member_id;
        v_to_member_id    := v_receiver_member_id;
        v_from_team_name  := v_proposer_team_name;
        v_to_team_name    := v_receiver_team_name;
      ELSE
        v_new_imported_id := v_proposer_imported_id;
        v_new_member_id   := v_proposer_member_id;
        v_new_user_id     := v_proposer_user_id;
        v_from_member_id  := v_receiver_member_id;
        v_to_member_id    := v_proposer_member_id;
        v_from_team_name  := v_receiver_team_name;
        v_to_team_name    := v_proposer_team_name;
      END IF;

      -- Next sort_order for the receiving active roster
      SELECT COALESCE(MAX(sort_order), 0) + 1 INTO v_next_sort
      FROM league_roster_players
      WHERE imported_member_id = v_new_imported_id
        AND roster_status = 'active';

      -- Insert new active row on receiving team
      INSERT INTO league_roster_players (
        league_id, imported_member_id, league_member_id, user_id,
        external_roster_player_id,
        sports_player_id, external_player_name, external_position,
        roster_status, acquisition_source, sort_order, acquired_at
      ) VALUES (
        v_lrp.league_id,
        v_new_imported_id,
        v_new_member_id,
        v_new_user_id,
        NULL,
        v_lrp.sports_player_id,
        v_lrp.external_player_name,
        v_lrp.external_position,
        'active',
        'traded',
        v_next_sort,
        now()
      )
      RETURNING id INTO v_new_lrp_id;

      -- Insert transaction row for this player
      INSERT INTO league_roster_transactions (
        league_id,
        transaction_type,
        actor_user_id,
        from_league_member_id,
        to_league_member_id,
        imported_member_id,
        league_roster_player_id,
        sports_player_id,
        external_player_name,
        external_position,
        trade_proposal_id,
        metadata
      ) VALUES (
        v_lrp.league_id,
        'trade_accept',
        v_caller_id,
        v_from_member_id,
        v_to_member_id,
        v_lrp.imported_member_id,
        v_pp.league_roster_player_id,
        v_lrp.sports_player_id,
        v_lrp.external_player_name,
        v_lrp.external_position,
        p_trade_proposal_id,
        jsonb_build_object(
          'commissioner_action', false,
          'from_team',           v_from_team_name,
          'to_team',             v_to_team_name,
          'player_name',         COALESCE(v_lrp.external_player_name, 'Unknown'),
          'position',            v_lrp.external_position
        )
      )
      RETURNING id INTO v_tx_id;

      v_tx_ids := v_tx_ids || v_tx_id;

      -- Safety-net: ensure traded player has exclusion rows in any active drafts
      IF v_lrp.sports_player_id IS NOT NULL THEN
        FOR v_draft IN
          SELECT id FROM drafts
          WHERE league_id = v_lrp.league_id
            AND status IN ('pending', 'in_progress', 'paused')
        LOOP
          INSERT INTO draft_player_exclusions (draft_id, sports_player_id)
          VALUES (v_draft.id, v_lrp.sports_player_id)
          ON CONFLICT (draft_id, sports_player_id) DO NOTHING;
        END LOOP;
      END IF;
    END;
  END LOOP;

  -- 9. Mark proposal as accepted
  UPDATE league_trade_proposals
  SET status              = 'accepted',
      resolved_by_user_id = v_caller_id,
      commissioner_action = false,
      updated_at          = now()
  WHERE id = p_trade_proposal_id;

  RETURN jsonb_build_object(
    'success',         true,
    'transaction_ids', v_tx_ids
  );
END;
$$;

GRANT EXECUTE ON FUNCTION accept_player_trade_proposal(uuid) TO authenticated;
