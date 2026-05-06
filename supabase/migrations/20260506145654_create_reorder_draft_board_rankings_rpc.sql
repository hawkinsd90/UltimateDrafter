/*
  # Create reorder_draft_board_rankings RPC

  ## Summary
  Replaces the unsafe client-side row-by-row rank update with a single atomic
  server-side function that cannot violate the UNIQUE (draft_id, user_id, rank)
  constraint during intermediate states.

  ## Problem being solved
  The unique constraint on (draft_id, user_id, rank) is NOT DEFERRABLE.
  When the client updates ranks one row at a time, intermediate states can
  produce temporary rank collisions, causing the update to fail.

  ## Solution: two-pass update
  1. First pass: shift all affected rows to large negative temp ranks
     (-(rank * 1,000,000)) which cannot collide with any valid positive rank
     and cannot collide with each other because each multiplied value is distinct.
  2. Second pass: update each row to its new positive rank.
  Both passes happen inside the same transaction so only the final state is
  ever visible outside the function.

  ## Security
  - Uses auth.uid() — callers can only reorder their own board for the given draft.
  - Every id is verified to belong to auth.uid() + p_draft_id before mutation.
  - SECURITY INVOKER so RLS policies on draft_board_rankings remain active.

  ## Parameters
  - p_draft_id  uuid   — the draft whose board is being reordered
  - p_rankings  jsonb  — array of {"id": "<uuid>", "rank": <int>} objects

  ## Returns
  Integer count of rows actually updated in pass 2.
*/

CREATE OR REPLACE FUNCTION public.reorder_draft_board_rankings(
  p_draft_id  uuid,
  p_rankings  jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id   uuid := auth.uid();
  v_item      jsonb;
  v_id        uuid;
  v_rank      integer;
  v_rows      integer;
  v_updated   integer := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Pass 1: move affected rows to temporary negative ranks.
  -- Multiplying by 1,000,000 guarantees no two temp values collide as long as
  -- the caller supplies distinct positive ranks (which a valid reorder always does).
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_rankings)
  LOOP
    v_id   := (v_item->>'id')::uuid;
    v_rank := (v_item->>'rank')::integer;

    IF v_rank < 1 THEN
      RAISE EXCEPTION 'Invalid rank %; rank must be >= 1', v_rank;
    END IF;

    UPDATE draft_board_rankings
    SET    rank = -(v_rank * 1000000)
    WHERE  id       = v_id
      AND  draft_id = p_draft_id
      AND  user_id  = v_user_id;
  END LOOP;

  -- Pass 2: write final positive ranks.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_rankings)
  LOOP
    v_id   := (v_item->>'id')::uuid;
    v_rank := (v_item->>'rank')::integer;

    UPDATE draft_board_rankings
    SET    rank       = v_rank,
           updated_at = now()
    WHERE  id       = v_id
      AND  draft_id = p_draft_id
      AND  user_id  = v_user_id;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_updated := v_updated + v_rows;
  END LOOP;

  RETURN v_updated;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reorder_draft_board_rankings(uuid, jsonb) TO authenticated;
