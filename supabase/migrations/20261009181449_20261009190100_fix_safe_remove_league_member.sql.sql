/*
# Phase 3D Correction: Fix safe_remove_league_member

## Overview
Replaces safe_remove_league_member with a corrected version that:
1. Checks for picks the member CURRENTLY owns that were originally from another
   team (acquired picks). These must not be orphaned.
2. Checks for picks originally belonging to the member that are now owned by
   another team (traded away picks). These must preserve transaction history.
3. Checks for any pending trade proposals involving this member (as proposer
   or receiver) that reference pick assets.
4. Only deletes genuinely pristine, untraded assets (original_member_id =
   current_member_id, status = 'available', no transactions, no pending proposals).
5. Returns a clear, actionable error for blocked removals.

## Security
- SECURITY DEFINER, search_path = public, granted to authenticated
*/

CREATE OR REPLACE FUNCTION safe_remove_league_member(
  p_member_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id           uuid := auth.uid();
  v_member              league_members%ROWTYPE;
  v_league_id           uuid;
  v_owner_id            uuid;
  v_pristine_count      integer;
  v_acquired_count      integer;
  v_traded_away_count   integer;
  v_tx_count            integer;
  v_pending_proposal_count integer;
  v_deleted_assets      integer;
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

  -- Pristine assets: originally owned by member, still owned by member, available
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

  -- Any pick transactions involving this member's original assets
  SELECT count(*) INTO v_tx_count
  FROM league_draft_pick_transactions ldpt
  JOIN league_draft_pick_assets ldpa ON ldpa.id = ldpt.pick_asset_id
  WHERE ldpt.league_id = v_league_id
    AND ldpa.original_member_id = p_member_id;

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

  IF v_traded_away_count > 0 OR v_tx_count > 0 THEN
    RAISE EXCEPTION 'This member has traded draft picks or has pick transaction history. '
      'Removing them would break ownership records. Please resolve their pick history '
      'before removing them from the league.';
  END IF;

  IF v_pending_proposal_count > 0 THEN
    RAISE EXCEPTION 'This member is involved in % pending trade proposal(s) that include draft picks. '
      'Please wait for those proposals to be resolved before removing this member.',
      v_pending_proposal_count;
  END IF;

  -- Delete pristine assets only
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
