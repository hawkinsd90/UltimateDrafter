/*
# Phase 3D Correction: Combined deterministic locking + exhaustive ID validation

## Overview
Replaces create_trade_proposal with a corrected version that:
1. Acquires locks over ALL unique player IDs (send + receive combined) in one
   consistently ordered pass, then ALL unique pick IDs in one ordered pass.
   This eliminates deadlock potential from inconsistent lock ordering.
2. After acquiring locks, validates every supplied ID resolves to exactly one
   eligible, correctly owned asset. Uses count-based verification: the number
   of locked rows must equal the number of distinct supplied IDs.
3. Rejects null IDs and missing IDs with a clear error — no partial proposal.
4. All ownership, status, league, permission, and conflict checks run after
   locks are held.

## Security
- SECURITY DEFINER, search_path = public, granted to authenticated
- Same authorization model as before
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

  v_all_lrp_ids          uuid[];
  v_all_pick_ids         uuid[];
  v_distinct_lrp_count   integer;
  v_distinct_pick_count  integer;
  v_locked_lrp_count     integer;
  v_locked_pick_count    integer;

  v_lrp                  league_roster_players%ROWTYPE;
  v_lrp_id               uuid;
  v_snapshot_team        text;

  v_pick                 league_draft_pick_assets%ROWTYPE;
  v_pick_asset_id        uuid;
  v_pick_orig_team_name  text;

  v_settings             league_settings%ROWTYPE;
  v_season               text;
  v_base_year            integer;
  v_max_future_year      integer;
  v_has_players          boolean;
  v_has_picks            boolean;
BEGIN
  -- 1. Auth required
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Normalize counts
  v_send_lrp_count       := COALESCE(array_length(p_send_lrp_ids, 1), 0);
  v_receive_lrp_count    := COALESCE(array_length(p_receive_lrp_ids, 1), 0);
  v_send_pick_count      := COALESCE(array_length(p_send_pick_asset_ids, 1), 0);
  v_receive_pick_count   := COALESCE(array_length(p_receive_pick_asset_ids, 1), 0);

  v_has_players := (v_send_lrp_count + v_receive_lrp_count) > 0;
  v_has_picks   := (v_send_pick_count + v_receive_pick_count) > 0;

  -- 2. Each side must have at least one total asset
  IF v_send_lrp_count + v_send_pick_count = 0 THEN
    RAISE EXCEPTION 'You must offer at least one player or pick';
  END IF;
  IF v_receive_lrp_count + v_receive_pick_count = 0 THEN
    RAISE EXCEPTION 'You must request at least one player or pick';
  END IF;

  -- 3. Reject null IDs in any array
  IF v_send_lrp_count > 0 AND EXISTS (SELECT 1 FROM unnest(p_send_lrp_ids) WHERE id IS NULL) THEN
    RAISE EXCEPTION 'Null player ID in send list';
  END IF;
  IF v_receive_lrp_count > 0 AND EXISTS (SELECT 1 FROM unnest(p_receive_lrp_ids) WHERE id IS NULL) THEN
    RAISE EXCEPTION 'Null player ID in receive list';
  END IF;
  IF v_send_pick_count > 0 AND EXISTS (SELECT 1 FROM unnest(p_send_pick_asset_ids) WHERE id IS NULL) THEN
    RAISE EXCEPTION 'Null pick ID in send list';
  END IF;
  IF v_receive_pick_count > 0 AND EXISTS (SELECT 1 FROM unnest(p_receive_pick_asset_ids) WHERE id IS NULL) THEN
    RAISE EXCEPTION 'Null pick ID in receive list';
  END IF;

  -- 4. Build combined arrays and check for cross-side duplicates
  v_all_lrp_ids  := p_send_lrp_ids || p_receive_lrp_ids;
  v_all_pick_ids := p_send_pick_asset_ids || p_receive_pick_asset_ids;

  -- No duplicate within send side
  IF v_send_lrp_count > 0 AND (SELECT count(*) FROM (SELECT unnest(p_send_lrp_ids)) AS u(id)) !=
     (SELECT count(DISTINCT id) FROM (SELECT unnest(p_send_lrp_ids)) AS u(id)) THEN
    RAISE EXCEPTION 'Duplicate player IDs on the send side';
  END IF;
  IF v_send_pick_count > 0 AND (SELECT count(*) FROM (SELECT unnest(p_send_pick_asset_ids)) AS u(id)) !=
     (SELECT count(DISTINCT id) FROM (SELECT unnest(p_send_pick_asset_ids)) AS u(id)) THEN
    RAISE EXCEPTION 'Duplicate pick asset IDs on the send side';
  END IF;
  IF v_receive_lrp_count > 0 AND (SELECT count(*) FROM (SELECT unnest(p_receive_lrp_ids)) AS u(id)) !=
     (SELECT count(DISTINCT id) FROM (SELECT unnest(p_receive_lrp_ids)) AS u(id)) THEN
    RAISE EXCEPTION 'Duplicate player IDs on the receive side';
  END IF;
  IF v_receive_pick_count > 0 AND (SELECT count(*) FROM (SELECT unnest(p_receive_pick_asset_ids)) AS u(id)) !=
     (SELECT count(DISTINCT id) FROM (SELECT unnest(p_receive_pick_asset_ids)) AS u(id)) THEN
    RAISE EXCEPTION 'Duplicate pick asset IDs on the receive side';
  END IF;
  -- No player or pick on both sides
  IF v_send_lrp_count > 0 AND v_receive_lrp_count > 0 THEN
    IF (SELECT count(*) FROM (SELECT unnest(v_all_lrp_ids)) AS u(id)) !=
       (SELECT count(DISTINCT id) FROM (SELECT unnest(v_all_lrp_ids)) AS u(id)) THEN
      RAISE EXCEPTION 'The same player cannot appear on both sides of a trade';
    END IF;
  END IF;
  IF v_send_pick_count > 0 AND v_receive_pick_count > 0 THEN
    IF (SELECT count(*) FROM (SELECT unnest(v_all_pick_ids)) AS u(id)) !=
       (SELECT count(DISTINCT id) FROM (SELECT unnest(v_all_pick_ids)) AS u(id)) THEN
      RAISE EXCEPTION 'The same draft pick cannot appear on both sides of a trade';
    END IF;
  END IF;

  -- Count distinct IDs for completeness verification
  IF v_has_players THEN
    SELECT count(DISTINCT id) INTO v_distinct_lrp_count FROM (SELECT unnest(v_all_lrp_ids)) AS u(id);
  END IF;
  IF v_has_picks THEN
    SELECT count(DISTINCT id) INTO v_distinct_pick_count FROM (SELECT unnest(v_all_pick_ids)) AS u(id);
  END IF;

  -- 5. Derive proposer league_member_id
  SELECT id INTO v_proposer_member_id
  FROM league_members
  WHERE league_id = p_league_id
    AND user_id   = v_caller_id;

  IF v_proposer_member_id IS NULL THEN
    RAISE EXCEPTION 'You are not a member of this league';
  END IF;

  -- 6. Validate receiver
  SELECT * INTO v_receiver_member
  FROM league_members
  WHERE id       = p_receiver_member_id
    AND league_id = p_league_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Receiver is not a member of this league';
  END IF;
  IF v_receiver_member.user_id IS NULL THEN
    RAISE EXCEPTION 'The trade partner has not claimed their team yet';
  END IF;
  IF v_receiver_member.id = v_proposer_member_id THEN
    RAISE EXCEPTION 'You cannot trade with yourself';
  END IF;

  -- 7. Read settings
  SELECT * INTO v_settings FROM league_settings WHERE league_id = p_league_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'League settings not found';
  END IF;

  IF v_has_players AND NOT COALESCE(v_settings.allow_trades, false) THEN
    RAISE EXCEPTION 'Player trades are not enabled for this league';
  END IF;

  IF v_has_picks THEN
    IF NOT COALESCE(v_settings.allow_pick_trades, false) THEN
      RAISE EXCEPTION 'Draft pick trading is not enabled for this league';
    END IF;
    IF NOT COALESCE(v_settings.allow_future_picks, false) THEN
      RAISE EXCEPTION 'Future draft pick trading is not enabled for this league';
    END IF;

    SELECT season INTO v_season FROM leagues WHERE id = p_league_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'League not found';
    END IF;
    v_base_year := substring(v_season from '\d{4}')::integer;
    IF v_base_year IS NULL THEN
      RAISE EXCEPTION 'Cannot parse league season "%". Expected format like "2026-27" or "2026".', v_season;
    END IF;
    v_max_future_year := v_base_year + COALESCE(v_settings.future_pick_years, 1);
  END IF;

  -- 8. COMBINED LOCKING: lock all unique player IDs in one ordered pass
  IF v_has_players THEN
    FOR v_lrp IN
      SELECT * FROM league_roster_players
      WHERE id = ANY(v_all_lrp_ids)
      ORDER BY id
      FOR UPDATE
    LOOP
      -- no-op: we just need the locks; validation is below
      NULL;
    END LOOP;

    -- Verify every distinct ID resolved to exactly one row
    SELECT count(*) INTO v_locked_lrp_count
    FROM league_roster_players
    WHERE id = ANY(v_all_lrp_ids);

    IF v_locked_lrp_count != v_distinct_lrp_count THEN
      RAISE EXCEPTION 'One or more player IDs not found (% found, % expected)',
        v_locked_lrp_count, v_distinct_lrp_count;
    END IF;
  END IF;

  -- 9. COMBINED LOCKING: lock all unique pick IDs in one ordered pass
  IF v_has_picks THEN
    FOR v_pick IN
      SELECT * FROM league_draft_pick_assets
      WHERE id = ANY(v_all_pick_ids)
      ORDER BY id
      FOR UPDATE
    LOOP
      NULL;
    END LOOP;

    SELECT count(*) INTO v_locked_pick_count
    FROM league_draft_pick_assets
    WHERE id = ANY(v_all_pick_ids);

    IF v_locked_pick_count != v_distinct_pick_count THEN
      RAISE EXCEPTION 'One or more pick asset IDs not found (% found, % expected)',
        v_locked_pick_count, v_distinct_pick_count;
    END IF;
  END IF;

  -- 10. Validate send players (proposer's players) — locks already held
  IF v_send_lrp_count > 0 THEN
    FOR v_lrp IN
      SELECT * FROM league_roster_players
      WHERE id = ANY(p_send_lrp_ids)
      ORDER BY id
    LOOP
      IF v_lrp.roster_status != 'active' THEN
        RAISE EXCEPTION 'Player % is not on an active roster', COALESCE(v_lrp.external_player_name, v_lrp.id::text);
      END IF;
      IF v_lrp.league_member_id IS DISTINCT FROM v_proposer_member_id THEN
        RAISE EXCEPTION 'You do not own %', COALESCE(v_lrp.external_player_name, 'this player');
      END IF;
      IF v_lrp.sports_player_id IS NULL THEN
        RAISE EXCEPTION '% is unresolved and cannot be traded. Resolve the player mapping first.', COALESCE(v_lrp.external_player_name, 'A player');
      END IF;
      IF EXISTS (
        SELECT 1 FROM league_trade_proposal_players ltpp
        JOIN league_trade_proposals ltp ON ltp.id = ltpp.trade_proposal_id
        WHERE ltpp.league_roster_player_id = v_lrp.id
          AND ltp.status = 'pending'
          AND ltp.expires_at > now()
      ) THEN
        RAISE EXCEPTION '% is already part of a pending trade proposal', COALESCE(v_lrp.external_player_name, 'A player');
      END IF;
    END LOOP;
  END IF;

  -- 11. Validate receive players (receiver's players)
  IF v_receive_lrp_count > 0 THEN
    FOR v_lrp IN
      SELECT * FROM league_roster_players
      WHERE id = ANY(p_receive_lrp_ids)
      ORDER BY id
    LOOP
      IF v_lrp.roster_status != 'active' THEN
        RAISE EXCEPTION 'Player % is not on an active roster', COALESCE(v_lrp.external_player_name, v_lrp.id::text);
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
        WHERE ltpp.league_roster_player_id = v_lrp.id
          AND ltp.status = 'pending'
          AND ltp.expires_at > now()
      ) THEN
        RAISE EXCEPTION '% is already part of a pending trade proposal', COALESCE(v_lrp.external_player_name, 'A player');
      END IF;
    END LOOP;
  END IF;

  -- 12. Validate send picks (proposer's picks)
  IF v_send_pick_count > 0 THEN
    FOR v_pick IN
      SELECT * FROM league_draft_pick_assets
      WHERE id = ANY(p_send_pick_asset_ids)
      ORDER BY id
    LOOP
      IF v_pick.league_id != p_league_id THEN
        RAISE EXCEPTION 'Draft pick does not belong to this league';
      END IF;
      IF v_pick.current_member_id IS DISTINCT FROM v_proposer_member_id THEN
        RAISE EXCEPTION 'You do not own this draft pick (% Round %)', v_pick.season_year, v_pick.round_number;
      END IF;
      IF v_pick.status != 'available' THEN
        RAISE EXCEPTION 'Draft pick % Round % is no longer available', v_pick.season_year, v_pick.round_number;
      END IF;
      IF v_pick.season_year <= v_base_year THEN
        RAISE EXCEPTION 'Draft pick % Round % is for the current season and cannot be traded yet', v_pick.season_year, v_pick.round_number;
      END IF;
      IF v_pick.season_year > v_max_future_year THEN
        RAISE EXCEPTION 'Draft pick % Round % is outside the allowed future-year window (max %)', v_pick.season_year, v_pick.round_number, v_max_future_year;
      END IF;
      IF EXISTS (
        SELECT 1 FROM league_trade_proposal_picks ltppk
        JOIN league_trade_proposals ltp ON ltp.id = ltppk.trade_proposal_id
        WHERE ltppk.pick_asset_id = v_pick.id
          AND ltp.status = 'pending'
          AND ltp.expires_at > now()
      ) THEN
        RAISE EXCEPTION 'Draft pick % Round % is already part of a pending trade proposal', v_pick.season_year, v_pick.round_number;
      END IF;
    END LOOP;
  END IF;

  -- 13. Validate receive picks (receiver's picks)
  IF v_receive_pick_count > 0 THEN
    FOR v_pick IN
      SELECT * FROM league_draft_pick_assets
      WHERE id = ANY(p_receive_pick_asset_ids)
      ORDER BY id
    LOOP
      IF v_pick.league_id != p_league_id THEN
        RAISE EXCEPTION 'Draft pick does not belong to this league';
      END IF;
      IF v_pick.current_member_id IS DISTINCT FROM p_receiver_member_id THEN
        RAISE EXCEPTION 'The trade partner does not own this draft pick (% Round %)', v_pick.season_year, v_pick.round_number;
      END IF;
      IF v_pick.status != 'available' THEN
        RAISE EXCEPTION 'Draft pick % Round % is no longer available', v_pick.season_year, v_pick.round_number;
      END IF;
      IF v_pick.season_year <= v_base_year THEN
        RAISE EXCEPTION 'Draft pick % Round % is for the current season and cannot be traded yet', v_pick.season_year, v_pick.round_number;
      END IF;
      IF v_pick.season_year > v_max_future_year THEN
        RAISE EXCEPTION 'Draft pick % Round % is outside the allowed future-year window (max %)', v_pick.season_year, v_pick.round_number, v_max_future_year;
      END IF;
      IF EXISTS (
        SELECT 1 FROM league_trade_proposal_picks ltppk
        JOIN league_trade_proposals ltp ON ltp.id = ltppk.trade_proposal_id
        WHERE ltppk.pick_asset_id = v_pick.id
          AND ltp.status = 'pending'
          AND ltp.expires_at > now()
      ) THEN
        RAISE EXCEPTION 'Draft pick % Round % is already part of a pending trade proposal', v_pick.season_year, v_pick.round_number;
      END IF;
    END LOOP;
  END IF;

  -- 14. Insert proposal
  INSERT INTO league_trade_proposals (
    league_id, proposer_member_id, proposer_user_id, receiver_member_id, message
  )
  VALUES (
    p_league_id, v_proposer_member_id, v_caller_id, p_receiver_member_id, p_message
  )
  RETURNING id, expires_at INTO v_proposal_id, v_expires_at;

  -- 15. Insert proposal player rows (send side)
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

  -- 16. Insert proposal player rows (receive side)
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

  -- 17. Insert proposal pick rows (send side) with original team name
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

  -- 18. Insert proposal pick rows (receive side)
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

-- Preserve backward-compatible delegate
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
