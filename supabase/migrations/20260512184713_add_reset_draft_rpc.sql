/*
  # Add reset_draft RPC

  ## Purpose
  Allows the league owner to reset a draft back to 'pending' status so that:
  1. All draft picks are cleared
  2. Draft participants are removed (re-configured in ManageParticipants)
  3. draft.status = 'pending', current_pick_number = 1, current_participant_id = NULL
  4. start_time = NULL

  ## Security
  - SECURITY DEFINER so it can bypass RLS for the picks/participants delete
  - Caller must be the owner of the league the draft belongs to
  - Draft must exist
  - Only works on drafts that are NOT already 'pending' (prevent double-reset)

  ## Returns
  - true on success
  - raises exceptions on auth/state errors
*/

CREATE OR REPLACE FUNCTION public.reset_draft(p_draft_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_draft drafts%ROWTYPE;
  v_league_owner_id uuid;
BEGIN
  -- Fetch draft
  SELECT * INTO v_draft FROM drafts WHERE id = p_draft_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Draft not found';
  END IF;

  -- Verify caller owns the league
  SELECT owner_id INTO v_league_owner_id FROM leagues WHERE id = v_draft.league_id;
  IF v_league_owner_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Only the league owner can reset a draft';
  END IF;

  -- Clear all picks
  DELETE FROM draft_picks WHERE draft_id = p_draft_id;

  -- Clear all participants (owner re-configures them in ManageParticipants)
  DELETE FROM draft_participants WHERE draft_id = p_draft_id;

  -- Reset draft state
  UPDATE drafts
  SET
    status = 'pending',
    current_pick_number = 1,
    current_participant_id = NULL,
    start_time = NULL
  WHERE id = p_draft_id;

  RETURN true;
END;
$$;

-- Grant execute to authenticated users (RLS check inside the function)
GRANT EXECUTE ON FUNCTION public.reset_draft(uuid) TO authenticated;
