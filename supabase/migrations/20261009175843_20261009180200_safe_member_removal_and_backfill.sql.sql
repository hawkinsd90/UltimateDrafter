/*
# Phase 3D Hardening: Safe member removal RPC + backfill existing leagues

## Overview
1. Creates safe_remove_league_member RPC that checks for pick-asset references
   before allowing member deletion. Prevents FK RESTRICT failures from showing
   raw database errors to users.
2. Backfills pick assets for existing eligible leagues that have future picks
   enabled but no assets yet. Does not reset existing ownership.

## safe_remove_league_member(p_member_id uuid) → jsonb
- Verifies caller is league owner.
- Checks if the member has any pick assets (as original or current owner) or
  pick transactions involving their assets.
- If pristine (no pick assets, no transactions), allows deletion.
- If assets exist but are untraded (original_member_id = current_member_id,
  status = 'available', no transactions), allows deletion after cascading
  the pick assets (they are pristine — no ownership history).
- If assets have been traded or have transaction history, rejects with an
  understandable error requiring commissioner resolution.
- Preserves historical ownership and transaction integrity.

## Backfill
Runs ensure_league_future_pick_assets for every league that has
allow_future_picks = true but zero pick assets. Idempotent.
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
  v_caller_id       uuid := auth.uid();
  v_member          league_members%ROWTYPE;
  v_league_id       uuid;
  v_owner_id        uuid;
  v_asset_count     integer;
  v_traded_count    integer;
  v_tx_count        integer;
  v_deleted_assets  integer;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Load member
  SELECT * INTO v_member FROM league_members WHERE id = p_member_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'League member not found';
  END IF;

  v_league_id := v_member.league_id;

  -- Verify caller is league owner
  SELECT owner_id INTO v_owner_id FROM leagues WHERE id = v_league_id;
  IF v_owner_id IS DISTINCT FROM v_caller_id THEN
    RAISE EXCEPTION 'Only the league owner can remove members';
  END IF;

  -- Check for pick assets where this member is original or current owner
  SELECT count(*) INTO v_asset_count
  FROM league_draft_pick_assets
  WHERE league_id = v_league_id
    AND (original_member_id = p_member_id OR current_member_id = p_member_id);

  -- Check for traded assets (where ownership has changed)
  SELECT count(*) INTO v_traded_count
  FROM league_draft_pick_assets
  WHERE league_id = v_league_id
    AND original_member_id = p_member_id
    AND current_member_id != p_member_id;

  -- Check for pick transactions involving this member's original assets
  SELECT count(*) INTO v_tx_count
  FROM league_draft_pick_transactions ldpt
  JOIN league_draft_pick_assets ldpa ON ldpa.id = ldpt.pick_asset_id
  WHERE ldpt.league_id = v_league_id
    AND ldpa.original_member_id = p_member_id;

  IF v_traded_count > 0 OR v_tx_count > 0 THEN
    RAISE EXCEPTION 'This member has traded draft picks or pick transaction history. '
      'Removing them would break ownership records. Please resolve their pick assets '
      'before removing them from the league.';
  END IF;

  -- If member has pristine assets (untraded, no transactions), delete them first
  IF v_asset_count > 0 THEN
    DELETE FROM league_draft_pick_assets
    WHERE league_id = v_league_id
      AND original_member_id = p_member_id
      AND current_member_id = p_member_id
      AND status = 'available';
    GET DIAGNOSTICS v_deleted_assets = ROW_COUNT;
  END IF;

  -- Now safe to delete the member
  DELETE FROM league_members WHERE id = p_member_id;

  RETURN jsonb_build_object(
    'success',         true,
    'deleted_assets',  COALESCE(v_deleted_assets, 0)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION safe_remove_league_member(uuid) TO authenticated;

-- ============================================================================
-- Backfill: Generate pick assets for existing eligible leagues
-- ============================================================================
DO $$
DECLARE
  v_league RECORD;
BEGIN
  FOR v_league IN
    SELECT ls.league_id
    FROM league_settings ls
    WHERE COALESCE(ls.allow_future_picks, false) = true
      AND NOT EXISTS (
        SELECT 1 FROM league_draft_pick_assets ldpa
        WHERE ldpa.league_id = ls.league_id
      )
  LOOP
    BEGIN
      PERFORM ensure_league_future_pick_assets(v_league.league_id);
    EXCEPTION WHEN OTHERS THEN
      -- Skip leagues with unparseable seasons or missing settings
      NULL;
    END;
  END LOOP;
END $$;
