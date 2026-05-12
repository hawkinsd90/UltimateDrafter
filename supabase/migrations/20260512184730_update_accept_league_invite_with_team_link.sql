/*
  # Update accept_league_invite RPC — auto-link member to imported team

  ## Changes
  Adds an optional p_imported_member_id parameter. When provided:
  - After inserting the league_member row, update league_imported_members
    to record which user claimed that imported team slot.
  - This lets the UI show the user's team name from their existing league.

  ## Backwards compatible
  - p_imported_member_id defaults to NULL — existing callers unaffected.
*/

CREATE OR REPLACE FUNCTION public.accept_league_invite(
  p_invite_id uuid,
  p_display_name text,
  p_imported_member_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_invite league_invites%ROWTYPE;
  v_league_id uuid;
  v_member_id uuid;
BEGIN
  -- Fetch and lock the invite row
  SELECT * INTO v_invite
  FROM league_invites
  WHERE id = p_invite_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invite not found';
  END IF;

  IF v_invite.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invite already used';
  END IF;

  IF v_invite.expires_at < now() THEN
    RAISE EXCEPTION 'Invite has expired';
  END IF;

  -- Mark accepted
  UPDATE league_invites
  SET accepted_at = now()
  WHERE id = p_invite_id;

  v_league_id := v_invite.league_id;

  -- Add member if not already one; capture the new member id
  INSERT INTO league_members (league_id, user_id, display_name, phone_e164, role)
  VALUES (v_league_id, auth.uid(), p_display_name, v_invite.phone_e164, 'member')
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_member_id;

  -- If the user was already a member, look up their existing id
  IF v_member_id IS NULL THEN
    SELECT id INTO v_member_id
    FROM league_members
    WHERE league_id = v_league_id AND user_id = auth.uid();
  END IF;

  -- Link to the imported member record if provided
  IF p_imported_member_id IS NOT NULL AND v_member_id IS NOT NULL THEN
    UPDATE league_imported_members
    SET invited_user_id = auth.uid()
    WHERE id = p_imported_member_id
      AND league_id = v_league_id;
  END IF;

  RETURN v_league_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_league_invite(uuid, text, uuid) TO authenticated;
