/*
# Phase 3D: Unified create_trade_proposal RPC

## Overview
Replaces the player-only `create_player_trade_proposal` with a new function
that supports players, picks, or both in a single trade proposal.

## Function: create_trade_proposal(...) → jsonb

### Parameters
- p_league_id uuid
- p_receiver_member_id uuid
- p_send_lrp_ids uuid[] (player roster IDs to send; can be empty if picks are sent)
- p_receive_lrp_ids uuid[] (player roster IDs to receive; can be empty if picks are received)
- p_send_pick_asset_ids uuid[] (pick asset IDs to send; can be empty)
- p_receive_pick_asset_ids uuid[] (pick asset IDs to receive; can be empty)
- p_message text DEFAULT NULL

### Validation
1. Auth required.
2. At least one total asset on each side (player or pick).
3. No player on both sides. No pick on both sides.
4. Proposer must be a league member.
5. Receiver must be a different league member.
6. All sent players must be active and owned by the proposer.
7. All received players must be active and owned by the receiver.
8. No player already in another pending proposal.
9. If any picks are included, `allow_pick_trades` must be true.
10. All sent picks must be owned by the proposer, available, and not in another pending proposal.
11. All received picks must be owned by the receiver, available, and not in another pending proposal.
12. Pick snapshots are frozen at proposal creation time.

### Backward compatibility
The old `create_player_trade_proposal` function is kept but delegates to this
new function so existing callers continue to work.
*/

CREATE OR REPLACE FUNCTION create_trade_proposal(
  p_league_id             uuid,
  p_receiver_member_id    uuid,
  p_send_lrp_ids          uuid[]  DEFAULT '{}',
  p_receive_lrp_ids       uuid[]  DEFAULT '{}',
  p_send_pick_asset_ids   uuid[]  DEFAULT '{}',
  p_receive_pick_asset_ids uuid[] DEFAULT '{}',
  p_message               text    DEFAULT NULL
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

  v_send_lrp_count       integer;
  v_receive_lrp_count    integer;
  v_send_pick_count      integer;
  v_receive_pick_count   integer;

  v_combined_lrp_ids     uuid[];
  v_lrp_id               uuid;
  v_lrp                  league_roster_players%ROWTYPE;
  v_snapshot_team        text;

  v_combined_pick_ids    uuid[];
  v_pick_asset_id        uuid;
  v_pick                 league_draft_pick_assets%ROWTYPE;
  v_pick_snapshot_name   text;
  v_pick_orig_team_name  text;
  v_pick_orig_member_id  uuid;

  v_settings             league_settings%ROWTYPE;
BEGIN
  -- 1. Auth required
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Normalize null arrays
  v_send_lrp_count       := COALESCE(array_length(p_send_lrp_ids, 1), 0);
  v_receive_lrp_count    := COALESCE(array_length(p_receive_lrp_ids, 1), 0);
  v_send_pick_count      := COALESCE(array_length(p_send_pick_asset_ids, 1), 0);
  v_receive_pick_count   := COALESCE(array_length(p_receive_pick_asset_ids, 1), 0);

  -- 2. Each side must have at least one total asset
  IF v_send_lrp_count + v_send_pick_count = 0 THEN
    RAISE EXCEPTION 'You must offer at least one player or pick';
  END IF;
  IF v_receive_lrp_count + v_receive_pick_count = 0 THEN
    RAISE EXCEPTION 'You must request at least one player or pick';
  END IF;

  -- 3a. No player on both sides
  IF v_send_lrp_count > 0 AND v_receive_lrp_count > 0 THEN
    v_combined_lrp_ids := p_send_lrp_ids || p_receive_lrp_ids;
    IF (SELECT count(*) FROM (SELECT unnest(v_combined_lrp_ids)) AS u(id)) !=
       (SELECT count(DISTINCT id) FROM (SELECT unnest(v_combined_lrp_ids)) AS u(id)) THEN
      RAISE EXCEPTION 'The same player cannot appear on both sides of a trade';
    END IF;
  END IF;

  -- 3b. No pick on both sides
  IF v_send_pick_count > 0 AND v_receive_pick_count > 0 THEN
    v_combined_pick_ids := p_send_pick_asset_ids || p_receive_pick_asset_ids;
    IF (SELECT count(*) FROM (SELECT unnest(v_combined_pick_ids)) AS u(id)) !=
       (SELECT count(DISTINCT id) FROM (SELECT unnest(v_combined_pick_ids)) AS u(id)) THEN
      RAISE EXCEPTION 'The same draft pick cannot appear on both sides of a trade';
    END IF;
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

  -- 6. Read league settings for pick-trade permission
  SELECT * INTO v_settings FROM league_settings WHERE league_id = p_league_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'League settings not found';
  END IF;

  -- 7. If picks are involved, verify pick trading is enabled
  IF v_send_pick_count + v_receive_pick_count > 0 THEN
    IF NOT v_settings.allow_pick_trades THEN
      RAISE EXCEPTION 'Draft pick trading is not enabled for this league';
    END IF;
  END IF;

  -- 8. Validate send players (proposer's players)
  IF v_send_lrp_count > 0 THEN
    FOREACH v_lrp_id IN ARRAY p_send_lrp_ids LOOP
      SELECT * INTO v_lrp FROM league_roster_players WHERE id = v_lrp_id;
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
  END IF;

  -- 9. Validate receive players (receiver's players)
  IF v_receive_lrp_count > 0 THEN
    FOREACH v_lrp_id IN ARRAY p_receive_lrp_ids LOOP
      SELECT * INTO v_lrp FROM league_roster_players WHERE id = v_lrp_id;
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
  END IF;

  -- 10. Validate send picks (proposer's picks)
  IF v_send_pick_count > 0 THEN
    FOREACH v_pick_asset_id IN ARRAY p_send_pick_asset_ids LOOP
      SELECT * INTO v_pick FROM league_draft_pick_assets WHERE id = v_pick_asset_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Draft pick not found: %', v_pick_asset_id;
      END IF;
      IF v_pick.league_id != p_league_id THEN
        RAISE EXCEPTION 'Draft pick does not belong to this league';
      END IF;
      IF v_pick.current_member_id IS DISTINCT FROM v_proposer_member_id THEN
        RAISE EXCEPTION 'You do not own this draft pick (% Round %)', v_pick.season_year, v_pick.round_number;
      END IF;
      IF v_pick.status != 'available' THEN
        RAISE EXCEPTION 'Draft pick % Round % is no longer available', v_pick.season_year, v_pick.round_number;
      END IF;
      IF EXISTS (
        SELECT 1 FROM league_trade_proposal_picks ltppk
        JOIN league_trade_proposals ltp ON ltp.id = ltppk.trade_proposal_id
        WHERE ltppk.pick_asset_id = v_pick_asset_id
          AND ltp.status = 'pending'
      ) THEN
        RAISE EXCEPTION 'Draft pick % Round % is already part of a pending trade proposal', v_pick.season_year, v_pick.round_number;
      END IF;
    END LOOP;
  END IF;

  -- 11. Validate receive picks (receiver's picks)
  IF v_receive_pick_count > 0 THEN
    FOREACH v_pick_asset_id IN ARRAY p_receive_pick_asset_ids LOOP
      SELECT * INTO v_pick FROM league_draft_pick_assets WHERE id = v_pick_asset_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Draft pick not found: %', v_pick_asset_id;
      END IF;
      IF v_pick.league_id != p_league_id THEN
        RAISE EXCEPTION 'Draft pick does not belong to this league';
      END IF;
      IF v_pick.current_member_id IS DISTINCT FROM p_receiver_member_id THEN
        RAISE EXCEPTION 'The trade partner does not own this draft pick (% Round %)', v_pick.season_year, v_pick.round_number;
      END IF;
      IF v_pick.status != 'available' THEN
        RAISE EXCEPTION 'Draft pick % Round % is no longer available', v_pick.season_year, v_pick.round_number;
      END IF;
      IF EXISTS (
        SELECT 1 FROM league_trade_proposal_picks ltppk
        JOIN league_trade_proposals ltp ON ltp.id = ltppk.trade_proposal_id
        WHERE ltppk.pick_asset_id = v_pick_asset_id
          AND ltp.status = 'pending'
      ) THEN
        RAISE EXCEPTION 'Draft pick % Round % is already part of a pending trade proposal', v_pick.season_year, v_pick.round_number;
      END IF;
    END LOOP;
  END IF;

  -- 12. Insert proposal
  INSERT INTO league_trade_proposals (
    league_id, proposer_member_id, proposer_user_id, receiver_member_id, message
  )
  VALUES (
    p_league_id, v_proposer_member_id, v_caller_id, p_receiver_member_id, p_message
  )
  RETURNING id, expires_at INTO v_proposal_id, v_expires_at;

  -- 13. Insert proposal player rows (send side)
  IF v_send_lrp_count > 0 THEN
    FOREACH v_lrp_id IN ARRAY p_send_lrp_ids LOOP
      SELECT * INTO v_lrp FROM league_roster_players WHERE id = v_lrp_id;
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
  END IF;

  -- 14. Insert proposal player rows (receive side)
  IF v_receive_lrp_count > 0 THEN
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
  END IF;

  -- 15. Insert proposal pick rows (send side)
  IF v_send_pick_count > 0 THEN
    FOREACH v_pick_asset_id IN ARRAY p_send_pick_asset_ids LOOP
      SELECT * INTO v_pick FROM league_draft_pick_assets WHERE id = v_pick_asset_id;
      SELECT team_name INTO v_pick_orig_team_name
      FROM league_imported_members lim
      JOIN league_members lm ON lm.user_id = lim.invited_user_id AND lim.league_id = lm.league_id
      WHERE lm.id = v_pick.original_member_id
        AND lim.league_id = p_league_id
      LIMIT 1;

      INSERT INTO league_trade_proposal_picks (
        trade_proposal_id, direction, pick_asset_id,
        snapshot_season_year, snapshot_round_number,
        snapshot_original_member_id, snapshot_original_team_name
      ) VALUES (
        v_proposal_id, 'send', v_pick_asset_id,
        v_pick.season_year, v_pick.round_number,
        v_pick.original_member_id, v_pick_orig_team_name
      );
    END LOOP;
  END IF;

  -- 16. Insert proposal pick rows (receive side)
  IF v_receive_pick_count > 0 THEN
    FOREACH v_pick_asset_id IN ARRAY p_receive_pick_asset_ids LOOP
      SELECT * INTO v_pick FROM league_draft_pick_assets WHERE id = v_pick_asset_id;
      SELECT team_name INTO v_pick_orig_team_name
      FROM league_imported_members lim
      JOIN league_members lm ON lm.user_id = lim.invited_user_id AND lim.league_id = lm.league_id
      WHERE lm.id = v_pick.original_member_id
        AND lim.league_id = p_league_id
      LIMIT 1;

      INSERT INTO league_trade_proposal_picks (
        trade_proposal_id, direction, pick_asset_id,
        snapshot_season_year, snapshot_round_number,
        snapshot_original_member_id, snapshot_original_team_name
      ) VALUES (
        v_proposal_id, 'receive', v_pick_asset_id,
        v_pick.season_year, v_pick.round_number,
        v_pick.original_member_id, v_pick_orig_team_name
      );
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'success',           true,
    'trade_proposal_id', v_proposal_id,
    'expires_at',        v_expires_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION create_trade_proposal(uuid, uuid, uuid[], uuid[], uuid[], uuid[], text) TO authenticated;

-- Make old function delegate to new one for backward compatibility
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
BEGIN
  RETURN create_trade_proposal(
    p_league_id, p_receiver_member_id,
    p_send_lrp_ids, p_receive_lrp_ids,
    '{}', '{}',
    p_message
  );
END;
$$;

GRANT EXECUTE ON FUNCTION create_player_trade_proposal(uuid, uuid, uuid[], uuid[], text) TO authenticated;
