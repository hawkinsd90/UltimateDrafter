/*
  # Fix reorder_draft_board_rankings RPC — use positive-offset strategy

  ## Problem
  The previous version of this RPC used negative temporary ranks in pass 1:
    SET rank = -(v_rank * 1,000,000)
  This violates the live CHECK (rank >= 1) constraint on draft_board_rankings,
  causing every reorder call to fail with a check-constraint violation.

  ## Fix: positive high-offset strategy
  Before either update pass, compute:
    v_offset = COALESCE(MAX(rank), 0) + 1,000,000
  for the calling user's board in this draft.

  Pass 1: SET rank = v_offset + v_rank
    - Always positive (satisfies CHECK rank >= 1)
    - v_offset + v_rank is distinct for each row because v_rank values are
      distinct positive integers supplied by the caller
    - These temp values are all >= 1,000,001, which is guaranteed to be above
      any real rank (real boards top out well below 1,000,000)
    - No collision with the UNIQUE (draft_id, user_id, rank) constraint because
      the temp space (>= 1,000,001) does not overlap with real ranks (<= ~pool size)

  Pass 2: SET rank = v_rank
    - Writes the final target ranks, which are now collision-free because every
      row that will receive one of these ranks was moved to the temp space in pass 1

  ## Security
  - SECURITY INVOKER: RLS policies on draft_board_rankings remain active
  - auth.uid() used as user_id throughout; callers can only affect their own rows
  - Unknown/foreign ids match 0 rows and are silently skipped

  ## Additional validation added
  - Duplicate rank detection: raises an exception if p_rankings contains two
    entries with the same rank value (would create a unique constraint violation
    even after both passes)
  - Empty input guard: returns 0 immediately if p_rankings is empty

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
  v_user_id   uuid    := auth.uid();
  v_item      jsonb;
  v_id        uuid;
  v_rank      integer;
  v_offset    bigint;
  v_rows      integer;
  v_updated   integer := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Nothing to do
  IF jsonb_array_length(p_rankings) = 0 THEN
    RETURN 0;
  END IF;

  -- Guard: reject duplicate ranks in the input payload
  IF (
    SELECT COUNT(*) FROM (
      SELECT (elem->>'rank')::integer AS r
      FROM jsonb_array_elements(p_rankings) AS elem
    ) ranked
  ) != (
    SELECT COUNT(DISTINCT r) FROM (
      SELECT (elem->>'rank')::integer AS r
      FROM jsonb_array_elements(p_rankings) AS elem
    ) ranked
  ) THEN
    RAISE EXCEPTION 'p_rankings contains duplicate rank values; all ranks must be distinct';
  END IF;

  -- Compute a safe positive offset above all existing ranks for this user/draft.
  -- Any real board tops out well below 1,000,000 players, so adding 1,000,000
  -- guarantees temp ranks cannot collide with current real ranks.
  SELECT COALESCE(MAX(rank), 0) + 1000000
  INTO   v_offset
  FROM   draft_board_rankings
  WHERE  draft_id = p_draft_id
    AND  user_id  = v_user_id;

  -- Pass 1: move affected rows into the safe high-positive temp range.
  -- v_offset + v_rank is distinct for each row (distinct inputs → distinct sums)
  -- and always > any real rank, so no UNIQUE collision occurs.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_rankings)
  LOOP
    v_id   := (v_item->>'id')::uuid;
    v_rank := (v_item->>'rank')::integer;

    IF v_rank < 1 THEN
      RAISE EXCEPTION 'Invalid rank %; rank must be >= 1', v_rank;
    END IF;

    UPDATE draft_board_rankings
    SET    rank = v_offset + v_rank
    WHERE  id       = v_id
      AND  draft_id = p_draft_id
      AND  user_id  = v_user_id;
  END LOOP;

  -- Pass 2: write final target ranks (all in normal range, no collisions remain).
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
