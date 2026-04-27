/*
  # Add advance_draft_turn RPC function

  ## Problem
  The drafts UPDATE RLS policy only allows league owners. When a non-owner participant
  makes a pick, the draft_picks INSERT succeeds but the subsequent UPDATE to advance
  current_pick_number and current_participant_id is silently blocked by RLS.

  ## Solution
  A SECURITY DEFINER function that:
  1. Verifies the caller is actually the current on-clock participant
  2. Inserts the pick
  3. Advances current_pick_number and current_participant_id atomically

  This keeps the drafts table locked down while allowing participants to advance
  their own turn correctly.
*/

CREATE OR REPLACE FUNCTION advance_draft_turn(
  p_draft_id        uuid,
  p_player_id       uuid,
  p_pick_number     int,
  p_round           int,
  p_pick_in_round   int,
  p_next_pick_number int,
  p_next_participant_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_participant_id uuid;
  v_current_participant_id uuid;
BEGIN
  -- Find the participant record for the calling user in this draft
  SELECT id INTO v_participant_id
  FROM draft_participants
  WHERE draft_id = p_draft_id
    AND user_id = auth.uid()
  LIMIT 1;

  IF v_participant_id IS NULL THEN
    RAISE EXCEPTION 'You are not a participant in this draft';
  END IF;

  -- Confirm it is actually this participant's turn
  SELECT current_participant_id INTO v_current_participant_id
  FROM drafts
  WHERE id = p_draft_id;

  IF v_current_participant_id IS DISTINCT FROM v_participant_id THEN
    RAISE EXCEPTION 'It is not your turn';
  END IF;

  -- Insert the pick
  INSERT INTO draft_picks (
    draft_id, participant_id, player_id,
    pick_number, round, pick_in_round,
    picked_at, time_taken_seconds, is_autopick
  ) VALUES (
    p_draft_id, v_participant_id, p_player_id,
    p_pick_number, p_round, p_pick_in_round,
    now(), 0, false
  );

  -- Advance the draft turn
  UPDATE drafts
  SET current_pick_number   = p_next_pick_number,
      current_participant_id = p_next_participant_id
  WHERE id = p_draft_id;
END;
$$;
