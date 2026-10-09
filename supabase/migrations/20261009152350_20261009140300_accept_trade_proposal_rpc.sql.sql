/*
# Phase 3D: Unified accept_trade_proposal RPC

## Overview
Replaces the player-only `accept_player_trade_proposal` with a new function
that atomically transfers both players and draft picks in a single database
operation.

## Function: accept_trade_proposal(p_trade_proposal_id uuid) → jsonb

### Atomic operation (all or nothing)
1. Lock the proposal row (FOR UPDATE).
2. Verify status is 'pending' and not expired.
3. Verify caller is the receiving team owner.
4. Lock all involved roster-player rows (FOR UPDATE).
5. Lock all involved pick-asset rows (FOR UPDATE).
6. Revalidate all players are still active and on the expected team.
7. Revalidate all picks are still available and owned by the expected team.
8. Execute player swaps (mark old rows 'traded', insert new active rows).
9. Transfer pick ownership (update current_member_id).
10. Insert player transaction rows.
11. Insert pick transaction rows.
12. Mark proposal as 'accepted'.

If any step fails, the entire operation rolls back — no partial transfers.

### Row locks
- `league_trade_proposals` FOR UPDATE prevents concurrent acceptances.
- `league_roster_players` FOR UPDATE prevents concurrent player mutations.
- `league_draft_pick_assets` FOR UPDATE prevents concurrent pick trades.

### Pick transaction metadata
Each pick transaction row stores:
```json
{
  "asset_kind": "pick",
  "pick_label": "2027 Round 1",
  "from_team": "SLIM",
  "to_team": "CHEF"
}
```

### Backward compatibility
The old `accept_player_trade_proposal` function delegates to this new one.
*/

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

  -- Resolve imported member IDs and team names
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

  -- 7. Lock and validate all involved roster-player rows
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

  -- 8. Lock and validate all involved pick-asset rows
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
  END LOOP;

  -- 9. Execute player swaps
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
    DECLARE
      v_new_imported_id   uuid;
      v_new_member_id     uuid;
      v_new_user_id       uuid;
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

  -- 10. Transfer pick ownership and log transactions
  FOR v_pick_prop IN
    SELECT * FROM league_trade_proposal_picks
    WHERE trade_proposal_id = p_trade_proposal_id
  LOOP
    SELECT * INTO v_pick
    FROM league_draft_pick_assets
    WHERE id = v_pick_prop.pick_asset_id;

    v_pick_label := v_pick.season_year::text || ' Round ' || v_pick.round_number::text;

    IF v_pick_prop.direction = 'send' THEN
      v_from_member_id  := v_proposer_member_id;
      v_to_member_id    := v_receiver_member_id;
      v_pick_from_team  := v_proposer_team_name;
      v_pick_to_team    := v_receiver_team_name;
    ELSE
      v_from_member_id  := v_receiver_member_id;
      v_to_member_id    := v_proposer_member_id;
      v_pick_from_team  := v_receiver_team_name;
      v_pick_to_team    := v_proposer_team_name;
    END IF;

    -- Transfer ownership
    UPDATE league_draft_pick_assets
    SET current_member_id = v_to_member_id,
        updated_at        = now()
    WHERE id = v_pick_prop.pick_asset_id;

    -- Insert pick transaction row
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
      v_from_member_id,
      v_to_member_id,
      v_pick.season_year,
      v_pick.round_number,
      jsonb_build_object(
        'asset_kind',  'pick',
        'pick_label',  v_pick_label,
        'from_team',   v_pick_from_team,
        'to_team',     v_pick_to_team
      )
    )
    RETURNING id INTO v_pick_tx_id;

    v_pick_tx_ids := v_pick_tx_ids || v_pick_tx_id;
  END LOOP;

  -- 11. Mark proposal as accepted
  UPDATE league_trade_proposals
  SET status              = 'accepted',
      resolved_by_user_id = v_caller_id,
      commissioner_action = false,
      updated_at          = now()
  WHERE id = p_trade_proposal_id;

  RETURN jsonb_build_object(
    'success',             true,
    'transaction_ids',     v_tx_ids,
    'pick_transaction_ids', v_pick_tx_ids
  );
END;
$$;

GRANT EXECUTE ON FUNCTION accept_trade_proposal(uuid) TO authenticated;

-- Make old function delegate to new one
CREATE OR REPLACE FUNCTION accept_player_trade_proposal(
  p_trade_proposal_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN accept_trade_proposal(p_trade_proposal_id);
END;
$$;

GRANT EXECUTE ON FUNCTION accept_player_trade_proposal(uuid) TO authenticated;
