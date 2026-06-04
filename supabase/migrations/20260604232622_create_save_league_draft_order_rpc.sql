/*
  # save_league_draft_order RPC + drop broad league_members UPDATE policy

  ## Problem
  The broad "League owner can update member draft_order" policy on league_members
  grants the owner UPDATE access to ALL columns of any member row, because RLS cannot
  restrict which columns are updated. This is wider than intended.

  ## Fix
  1. Drop the overly-broad UPDATE policy.
  2. Add a SECURITY DEFINER RPC save_league_draft_order that:
     - Verifies the caller is the league owner.
     - Accepts an ordered array of member UUIDs.
     - Assigns draft_order = position in array (1-based).
     - Only updates rows that belong to the league (safe: guards against cross-league edits).
  3. Update the frontend (LeagueMembersTab.tsx) to call this RPC instead of direct UPDATE.

  This matches the existing pattern used by reorder_draft_board_rankings.
*/

-- ── 1. Drop the broad UPDATE policy ─────────────────────────────────────────

DROP POLICY IF EXISTS "League owner can update member draft_order" ON league_members;

-- ── 2. Save draft order RPC ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.save_league_draft_order(
  p_league_id         uuid,
  p_ordered_member_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner_id uuid;
  i          int;
BEGIN
  -- Verify caller is league owner
  SELECT owner_id INTO v_owner_id
  FROM leagues WHERE id = p_league_id;

  IF v_owner_id IS NULL OR v_owner_id <> auth.uid() THEN
    RAISE EXCEPTION 'Only the league owner can save draft order';
  END IF;

  -- Assign 1-based draft_order for each member ID in the supplied order
  FOR i IN 1..array_length(p_ordered_member_ids, 1) LOOP
    UPDATE league_members
    SET draft_order = i
    WHERE id        = p_ordered_member_ids[i]
      AND league_id = p_league_id;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_league_draft_order(uuid, uuid[]) TO authenticated;
