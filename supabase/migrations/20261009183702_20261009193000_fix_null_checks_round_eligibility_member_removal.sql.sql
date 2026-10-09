/*
# Phase 3D Critical SQL Corrections

## Overview
This migration fixes three issues identified in the Phase 3D correction pass:

1. **Null-ID checks in create_trade_proposal**: The four `unnest` checks used
   `WHERE id IS NULL` but the unnested column has no name — PostgreSQL throws
   "column id does not exist" on every call. Fixed with explicit `AS u(asset_id)`.

2. **Missing server-side round eligibility**: create_trade_proposal and
   accept_trade_proposal validated season-year window but not round-number
   against `league_settings.default_rounds`. A client could bypass frontend
   filtering and trade a pick in round 20 when the league only allows 15.
   Added `v_max_rounds` check to both RPCs.

3. **safe_remove_league_member incomplete history check**: The function checked
   `original_member_id` in transactions but not `from_member_id`/`to_member_id`.
   A member who received a pick from another team and then traded it away would
   have transaction rows where they appear as `from_member_id` but not as
   `original_member_id`. The FK on `league_draft_pick_transactions.from_member_id`
   could fail on member deletion. Added explicit check for
   `from_member_id = p_member_id OR to_member_id = p_member_id`.

## Security
- All three functions remain SECURITY DEFINER, search_path = public
- Same authorization model preserved
- Same signatures preserved
*/

-- ============================================================================
-- 1. Fix create_trade_proposal: null-ID alias + round eligibility
-- ============================================================================

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
  v_max_rounds           integer;
  v_has_players          boolean;
  v_has_picks            boolean;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  v_send_lrp_count       := COALESCE(array_length(p_send_lrp_ids, 1), 0);
  v_receive_lrp_count    := COALESCE(array_length(p_receive_lrp_ids, 1), 0);
  v_send_pick_count      := COALESCE(array_length(p_send_pick_asset_ids, 1), 0);
  v_receive_pick_count   := COALESCE(array_length(p_receive_pick_asset_ids, 1), 0);

  v_has_players := (v_send_lrp_count + v_receive_lrp_count) > 0;
  v_has_picks   := (v_send_pick_count + v_receive_pick_count) > 0;

  IF v_send_lrp_count + v_send_pick_count = 0 THEN
    RAISE EXCEPTION 'You must offer at least one player or pick';
  END IF;
  IF v_receive_lrp_count + v_receive_pick_count = 0 THEN
    RAISE EXCEPTION 'You must request at least one player or pick';
  END IF;

  -- Null-ID checks with explicit column alias (unnest has no implicit 'id' column)
  IF v_send_lrp_count > 0 AND EXISTS (SELECT 1 FROM unnest(p_send_lrp_ids) AS u(asset_id) WHERE u.asset_id IS NULL) THEN
    RAISE EXCEPTION 'Null player ID in send list';
  END IF;
  IF v_receive_lrp_count > 0 AND EXISTS (SELECT 1 FROM unnest(p_receive_lrp_ids) AS u(asset_id) WHERE u.asset_id IS NULL) THEN
    RAISE EXCEPTION 'Null player ID in receive list';
  END IF;
  IF v_send_pick_count > 0 AND EXISTS (SELECT 1 FROM unnest(p_send_pick_asset_ids) AS u(asset_id) WHERE u.asset_id IS NULL) THEN
    RAISE EXCEPTION 'Null pick ID in send list';
  END IF;
  IF v_receive_pick_count > 0 AND EXISTS (SELECT 1 FROM unnest(p_receive_pick_asset_ids) AS u(asset_id) WHERE u.asset_id IS NULL) THEN
    RAISE EXCEPTION 'Null pick ID in receive list';
  END IF;

  v_all_lrp_ids  := p_send_lrp_ids || p_receive_lrp_ids;
  v_all_pick_ids := p_send_pick_asset_ids || p_receive_pick_asset_ids;

  -- Duplicate checks within each side
  IF v_send_lrp_count > 0 AND (SELECT count(*) FROM (SELECT unnest(p_send_lrp_ids)) AS u(asset_id)) !=
     (SELECT count(DISTINCT asset_id) FROM (SELECT unnest(p_send_lrp_ids)) AS u(asset_id)) THEN
    RAISE EXCEPTION 'Duplicate player IDs on the send side';
  END IF;
  IF v_send_pick_count > 0 AND (SELECT count(*) FROM (SELECT unnest(p_send_pick_asset_ids)) AS u(asset_id)) !=
     (SELECT count(DISTINCT asset_id) FROM (SELECT unnest(p_send_pick_asset_ids)) AS u(asset_id)) THEN
    RAISE EXCEPTION 'Duplicate pick asset IDs on the send side';
  END IF;
  IF v_receive_lrp_count > 0 AND (SELECT count(*) FROM (SELECT unnest(p_receive_lrp_ids)) AS u(asset_id)) !=
     (SELECT count(DISTINCT asset_id) FROM (SELECT unnest(p_receive_lrp_ids)) AS u(asset_id)) THEN
    RAISE EXCEPTION 'Duplicate player IDs on the receive side';
  END IF;
  IF v_receive_pick_count > 0 AND (SELECT count(*) FROM (SELECT unnest(p_receive_pick_asset_ids)) AS u(asset_id)) !=
     (SELECT count(DISTINCT asset_id) FROM (SELECT unnest(p_receive_pick_asset_ids)) AS u(asset_id)) THEN
    RAISE EXCEPTION 'Duplicate pick asset IDs on the receive side';
  END IF;
  IF v_send_lrp_count > 0 AND v_receive_lrp_count > 0 THEN
    IF (SELECT count(*) FROM (SELECT unnest(v_all_lrp_ids)) AS u(asset_id)) !=
       (SELECT count(DISTINCT asset_id) FROM (SELECT unnest(v_all_lrp_ids)) AS u(asset_id)) THEN
      RAISE EXCEPTION 'The same player cannot appear on both sides of a trade';
    END IF;
  END IF;
  IF v_send_pick_count > 0 AND v_receive_pick_count > 0 THEN
    IF (SELECT count(*) FROM (SELECT unnest(v_all_pick_ids)) AS u(asset_id)) !=
       (SELECT count(DISTINCT asset_id) FROM (SELECT unnest(v_all_pick_ids)) AS u(asset_id)) THEN
      RAISE EXCEPTION 'The same draft pick cannot appear on both sides of a trade';
    END IF;
  END IF;

  IF v_has_players THEN
    SELECT count(DISTINCT asset_id) INTO v_distinct_lrp_count FROM (SELECT unnest(v_all_lrp_ids)) AS u(asset_id);
  END IF;
  IF v_has_picks THEN
    SELECT count(DISTINCT asset_id) INTO v_distinct_pick_count FROM (SELECT unnest(v_all_pick_ids)) AS u(asset_id);
  END IF;

  SELECT id INTO v_proposer_member_id
  FROM league_members
  WHERE league_id = p_league_id AND user_id = v_caller_id;
  IF v_proposer_member_id IS NULL THEN
    RAISE EXCEPTION 'You are not a member of this league';
  END IF;

  SELECT * INTO v_receiver_member
  FROM league_members WHERE id = p_receiver_member_id AND league_id = p_league_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Receiver is not a member of this league';
  END IF;
  IF v_receiver_member.user_id IS NULL THEN
    RAISE EXCEPTION 'The trade partner has not claimed their team yet';
  END IF;
  IF v_receiver_member.id = v_proposer_member_id THEN
    RAISE EXCEPTION 'You cannot trade with yourself';
  END IF;

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
    v_max_rounds      := COALESCE(v_settings.default_rounds, 15);
  END IF;

  -- Combined locking: all unique player IDs in one ordered pass
  IF v_has_players THEN
    FOR v_lrp IN
      SELECT * FROM league_roster_players
      WHERE id = ANY(v_all_lrp_ids)
      ORDER BY id
      FOR UPDATE
    LOOP
      NULL;
    END LOOP;

    SELECT count(*) INTO v_locked_lrp_count
    FROM league_roster_players
    WHERE id = ANY(v_all_lrp_ids);

    IF v_locked_lrp_count != v_distinct_lrp_count THEN
      RAISE EXCEPTION 'One or more player IDs not found (% found, % expected)',
        v_locked_lrp_count, v_distinct_lrp_count;
    END IF;
  END IF;

  -- Combined locking: all unique pick IDs in one ordered pass
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

  -- Validate send players
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

  -- Validate receive players
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

  -- Validate send picks (with round eligibility)
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
      IF v_pick.round_number < 1 OR v_pick.round_number > v_max_rounds THEN
        RAISE EXCEPTION 'Draft pick % Round % is outside the allowed round range (1-%)', v_pick.season_year, v_pick.round_number, v_max_rounds;
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

  -- Validate receive picks (with round eligibility)
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
      IF v_pick.round_number < 1 OR v_pick.round_number > v_max_rounds THEN
        RAISE EXCEPTION 'Draft pick % Round % is outside the allowed round range (1-%)', v_pick.season_year, v_pick.round_number, v_max_rounds;
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

  -- Insert proposal
  INSERT INTO league_trade_proposals (
    league_id, proposer_member_id, proposer_user_id, receiver_member_id, message
  )
  VALUES (
    p_league_id, v_proposer_member_id, v_caller_id, p_receiver_member_id, p_message
  )
  RETURNING id, expires_at INTO v_proposal_id, v_expires_at;

  -- Insert proposal player rows (send side)
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

  -- Insert proposal player rows (receive side)
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

  -- Insert proposal pick rows (send side)
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

  -- Insert proposal pick rows (receive side)
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

-- ============================================================================
-- 2. Fix accept_trade_proposal: add round eligibility revalidation
-- ============================================================================

CREATE OR REPLACE FUNCTION accept_trade_proposal(
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

  v_pick_prop              league_trade_proposal_picks%ROWTYPE;
  v_pick                   league_draft_pick_assets%ROWTYPE;

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
  v_pick_tx_ids            uuid[] := '{}';
  v_pick_tx_id             uuid;
  v_draft                  RECORD;

  v_from_member_id         uuid;
  v_to_member_id           uuid;
  v_from_team_name         text;
  v_to_team_name           text;
  v_pick_label             text;
  v_pick_from_team         text;
  v_pick_to_team           text;
  v_pick_orig_team         text;

  v_settings               league_settings%ROWTYPE;
  v_season                 text;
  v_base_year              integer;
  v_max_future_year        integer;
  v_max_rounds             integer;
  v_has_players            boolean;
  v_has_picks              boolean;
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

  IF v_proposal.expires_at < now() THEN
    UPDATE league_trade_proposals
    SET status = 'expired', updated_at = now()
    WHERE id = p_trade_proposal_id;
    RETURN jsonb_build_object(
      'success', false,
      'error',   'This trade proposal has expired'
    );
  END IF;

  SELECT * INTO v_receiver_member
  FROM league_members WHERE id = v_proposal.receiver_member_id;

  IF v_receiver_member.user_id IS DISTINCT FROM v_caller_id THEN
    RAISE EXCEPTION 'Only the receiving team owner may accept this trade';
  END IF;

  SELECT * INTO v_proposer_member
  FROM league_members WHERE id = v_proposal.proposer_member_id;

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

  SELECT * INTO v_settings FROM league_settings WHERE league_id = v_proposal.league_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'League settings not found';
  END IF;

  v_has_players := EXISTS (
    SELECT 1 FROM league_trade_proposal_players WHERE trade_proposal_id = p_trade_proposal_id
  );
  v_has_picks := EXISTS (
    SELECT 1 FROM league_trade_proposal_picks WHERE trade_proposal_id = p_trade_proposal_id
  );

  IF v_has_players AND NOT COALESCE(v_settings.allow_trades, false) THEN
    RAISE EXCEPTION 'Player trades have been disabled since this proposal was created';
  END IF;

  IF v_has_picks THEN
    IF NOT COALESCE(v_settings.allow_pick_trades, false) THEN
      RAISE EXCEPTION 'Draft pick trading has been disabled since this proposal was created';
    END IF;
    IF NOT COALESCE(v_settings.allow_future_picks, false) THEN
      RAISE EXCEPTION 'Future draft pick trading has been disabled since this proposal was created';
    END IF;

    SELECT season INTO v_season FROM leagues WHERE id = v_proposal.league_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'League not found';
    END IF;
    v_base_year := substring(v_season from '\d{4}')::integer;
    IF v_base_year IS NULL THEN
      RAISE EXCEPTION 'Cannot parse league season "%". Expected format like "2026-27" or "2026".', v_season;
    END IF;
    v_max_future_year := v_base_year + COALESCE(v_settings.future_pick_years, 1);
    v_max_rounds      := COALESCE(v_settings.default_rounds, 15);
  END IF;

  -- Lock and validate all involved roster-player rows
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
    IF v_pp.direction = 'send' AND v_lrp.league_member_id IS DISTINCT FROM v_proposer_member_id THEN
      RAISE EXCEPTION '% has moved teams since this trade was proposed', v_pp.snapshot_player_name;
    END IF;
    IF v_pp.direction = 'receive' AND v_lrp.league_member_id IS DISTINCT FROM v_receiver_member_id THEN
      RAISE EXCEPTION '% has moved teams since this trade was proposed', v_pp.snapshot_player_name;
    END IF;
  END LOOP;

  -- Lock and validate all involved pick-asset rows
  FOR v_pick_prop IN
    SELECT * FROM league_trade_proposal_picks
    WHERE trade_proposal_id = p_trade_proposal_id
  LOOP
    SELECT * INTO v_pick
    FROM league_draft_pick_assets
    WHERE id = v_pick_prop.pick_asset_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Draft pick not found for % Round %',
        v_pick_prop.snapshot_season_year, v_pick_prop.snapshot_round_number;
    END IF;
    IF v_pick.status != 'available' THEN
      RAISE EXCEPTION 'Draft pick % Round % is no longer available',
        v_pick.season_year, v_pick.round_number;
    END IF;
    IF v_pick_prop.direction = 'send'
      AND v_pick.current_member_id IS DISTINCT FROM v_proposer_member_id THEN
      RAISE EXCEPTION 'A sent draft pick (% Round %) has changed owners',
        v_pick.season_year, v_pick.round_number;
    END IF;
    IF v_pick_prop.direction = 'receive'
      AND v_pick.current_member_id IS DISTINCT FROM v_receiver_member_id THEN
      RAISE EXCEPTION 'A requested draft pick (% Round %) has changed owners',
        v_pick.season_year, v_pick.round_number;
    END IF;
    -- Revalidate season-year eligibility
    IF v_pick.season_year <= v_base_year THEN
      RAISE EXCEPTION 'Draft pick % Round % is for the current season and can no longer be traded',
        v_pick.season_year, v_pick.round_number;
    END IF;
    IF v_pick.season_year > v_max_future_year THEN
      RAISE EXCEPTION 'Draft pick % Round % is now outside the allowed future-year window',
        v_pick.season_year, v_pick.round_number;
    END IF;
    -- Revalidate round-number eligibility
    IF v_pick.round_number < 1 OR v_pick.round_number > v_max_rounds THEN
      RAISE EXCEPTION 'Draft pick % Round % is now outside the allowed round range (1-%)',
        v_pick.season_year, v_pick.round_number, v_max_rounds;
    END IF;
  END LOOP;

  -- Execute player swaps
  FOR v_pp IN
    SELECT * FROM league_trade_proposal_players
    WHERE trade_proposal_id = p_trade_proposal_id
  LOOP
    IF v_pp.direction = 'send' THEN
      v_from_member_id := v_proposer_member_id;
      v_to_member_id   := v_receiver_member_id;
      v_from_team_name := v_proposer_team_name;
      v_to_team_name   := v_receiver_team_name;
    ELSE
      v_from_member_id := v_receiver_member_id;
      v_to_member_id   := v_proposer_member_id;
      v_from_team_name := v_receiver_team_name;
      v_to_team_name   := v_proposer_team_name;
    END IF;

    SELECT * INTO v_lrp
    FROM league_roster_players
    WHERE id = v_pp.league_roster_player_id
    FOR UPDATE;

    UPDATE league_roster_players
    SET league_member_id = v_to_member_id
    WHERE id = v_pp.league_roster_player_id;

    SELECT COALESCE(max(sort_order), 0) + 1 INTO v_next_sort
    FROM league_roster_transactions
    WHERE league_id = v_proposal.league_id;

    INSERT INTO league_roster_transactions (
      league_id, transaction_type, actor_user_id,
      from_league_member_id, to_league_member_id,
      imported_member_id,
      external_player_name, external_position,
      trade_proposal_id, sort_order,
      metadata
    ) VALUES (
      v_proposal.league_id, 'trade_accept', v_caller_id,
      v_from_member_id, v_to_member_id,
      v_receiver_imported_id,
      v_pp.snapshot_player_name, v_pp.snapshot_position,
      p_trade_proposal_id, v_next_sort,
      jsonb_build_object(
        'player_name', v_pp.snapshot_player_name,
        'position',    v_pp.snapshot_position,
        'from_team',   v_from_team_name,
        'to_team',     v_to_team_name
      )
    )
    RETURNING id INTO v_tx_id;

    v_tx_ids := array_append(v_tx_ids, v_tx_id);
  END LOOP;

  -- Execute pick ownership transfers
  FOR v_pick_prop IN
    SELECT * FROM league_trade_proposal_picks
    WHERE trade_proposal_id = p_trade_proposal_id
  LOOP
    IF v_pick_prop.direction = 'send' THEN
      v_from_member_id := v_proposer_member_id;
      v_to_member_id   := v_receiver_member_id;
      v_from_team_name := v_proposer_team_name;
      v_to_team_name   := v_receiver_team_name;
    ELSE
      v_from_member_id := v_receiver_member_id;
      v_to_member_id   := v_proposer_member_id;
      v_from_team_name := v_receiver_team_name;
      v_to_team_name   := v_proposer_team_name;
    END IF;

    SELECT * INTO v_pick
    FROM league_draft_pick_assets
    WHERE id = v_pick_prop.pick_asset_id
    FOR UPDATE;

    v_pick_orig_team := v_pick_prop.snapshot_original_team_name;
    v_pick_label     := CASE
      WHEN v_pick_orig_team IS NOT NULL
        THEN v_pick.season_year::text || ' Round ' || v_pick.round_number::text || ' — ' || v_pick_orig_team
      ELSE v_pick.season_year::text || ' Round ' || v_pick.round_number::text
    END;

    UPDATE league_draft_pick_assets
    SET current_member_id = v_to_member_id
    WHERE id = v_pick_prop.pick_asset_id;

    SELECT COALESCE(max(sort_order), 0) + 1 INTO v_next_sort
    FROM league_draft_pick_transactions
    WHERE league_id = v_proposal.league_id;

    INSERT INTO league_draft_pick_transactions (
      league_id, pick_asset_id, trade_proposal_id, actor_user_id,
      from_member_id, to_member_id,
      season_year, round_number,
      sort_order, metadata
    ) VALUES (
      v_proposal.league_id, v_pick_prop.pick_asset_id, p_trade_proposal_id, v_caller_id,
      v_from_member_id, v_to_member_id,
      v_pick.season_year, v_pick.round_number,
      v_next_sort,
      jsonb_build_object(
        'pick_label',     v_pick_label,
        'from_team',      v_from_team_name,
        'to_team',        v_to_team_name,
        'original_team',  v_pick_orig_team
      )
    )
    RETURNING id INTO v_pick_tx_id;

    v_pick_tx_ids := array_append(v_pick_tx_ids, v_pick_tx_id);
  END LOOP;

  -- Mark proposal as accepted
  UPDATE league_trade_proposals
  SET status = 'accepted', updated_at = now()
  WHERE id = p_trade_proposal_id;

  RETURN jsonb_build_object(
    'success',             true,
    'trade_proposal_id',   p_trade_proposal_id,
    'transaction_ids',     v_tx_ids,
    'pick_transaction_ids', v_pick_tx_ids
  );
END;
$$;

GRANT EXECUTE ON FUNCTION accept_trade_proposal(uuid) TO authenticated;

-- ============================================================================
-- 3. Fix safe_remove_league_member: check from_member_id / to_member_id
-- ============================================================================

CREATE OR REPLACE FUNCTION safe_remove_league_member(
  p_member_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id              uuid := auth.uid();
  v_member                 league_members%ROWTYPE;
  v_league_id              uuid;
  v_owner_id               uuid;
  v_pristine_count         integer;
  v_acquired_count         integer;
  v_traded_away_count      integer;
  v_tx_as_origin_count     integer;
  v_tx_as_party_count      integer;
  v_pending_proposal_count integer;
  v_deleted_assets         integer;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_member FROM league_members WHERE id = p_member_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'League member not found';
  END IF;

  v_league_id := v_member.league_id;

  SELECT owner_id INTO v_owner_id FROM leagues WHERE id = v_league_id;
  IF v_owner_id IS DISTINCT FROM v_caller_id THEN
    RAISE EXCEPTION 'Only the league owner can remove members';
  END IF;

  -- Pristine assets: originally owned by member, still owned, available
  SELECT count(*) INTO v_pristine_count
  FROM league_draft_pick_assets
  WHERE league_id = v_league_id
    AND original_member_id = p_member_id
    AND current_member_id  = p_member_id
    AND status = 'available';

  -- Acquired picks: currently owned by member but originally from another team
  SELECT count(*) INTO v_acquired_count
  FROM league_draft_pick_assets
  WHERE league_id = v_league_id
    AND current_member_id  = p_member_id
    AND original_member_id != p_member_id;

  -- Traded-away picks: originally owned by member, now owned by another team
  SELECT count(*) INTO v_traded_away_count
  FROM league_draft_pick_assets
  WHERE league_id = v_league_id
    AND original_member_id = p_member_id
    AND current_member_id != p_member_id;

  -- Transactions where this member is the original owner of the asset
  SELECT count(*) INTO v_tx_as_origin_count
  FROM league_draft_pick_transactions ldpt
  JOIN league_draft_pick_assets ldpa ON ldpa.id = ldpt.pick_asset_id
  WHERE ldpt.league_id = v_league_id
    AND ldpa.original_member_id = p_member_id;

  -- Transactions where this member appears as from or to party
  -- (covers acquired picks the member later traded away)
  SELECT count(*) INTO v_tx_as_party_count
  FROM league_draft_pick_transactions
  WHERE league_id = v_league_id
    AND (from_member_id = p_member_id OR to_member_id = p_member_id);

  -- Pending trade proposals involving this member that reference picks
  SELECT count(*) INTO v_pending_proposal_count
  FROM league_trade_proposals ltp
  JOIN league_trade_proposal_picks ltppk ON ltppk.trade_proposal_id = ltp.id
  WHERE ltp.league_id = v_league_id
    AND ltp.status = 'pending'
    AND ltp.expires_at > now()
    AND (ltp.proposer_member_id = p_member_id OR ltp.receiver_member_id = p_member_id);

  IF v_acquired_count > 0 THEN
    RAISE EXCEPTION 'This member currently owns % draft pick(s) acquired from other teams. '
      'Removing them would orphan those picks. Please transfer or resolve those picks first.',
      v_acquired_count;
  END IF;

  IF v_traded_away_count > 0 OR v_tx_as_origin_count > 0 OR v_tx_as_party_count > 0 THEN
    RAISE EXCEPTION 'This member has draft pick transaction history (as original owner, sender, or receiver). '
      'Removing them would break ownership records. Please resolve their pick history '
      'before removing them from the league.';
  END IF;

  IF v_pending_proposal_count > 0 THEN
    RAISE EXCEPTION 'This member is involved in % pending trade proposal(s) that include draft picks. '
      'Please wait for those proposals to be resolved before removing this member.',
      v_pending_proposal_count;
  END IF;

  IF v_pristine_count > 0 THEN
    DELETE FROM league_draft_pick_assets
    WHERE league_id = v_league_id
      AND original_member_id = p_member_id
      AND current_member_id  = p_member_id
      AND status = 'available';
    GET DIAGNOSTICS v_deleted_assets = ROW_COUNT;
  END IF;

  DELETE FROM league_members WHERE id = p_member_id;

  RETURN jsonb_build_object(
    'success',         true,
    'deleted_assets',  COALESCE(v_deleted_assets, 0)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION safe_remove_league_member(uuid) TO authenticated;
