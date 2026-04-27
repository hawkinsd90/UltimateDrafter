/*
  # Add accept_league_invite RPC function

  The client-side approach of UPDATE + SELECT on league_invites fails because:
  - After marking accepted_at, the row no longer matches the SELECT policy
    (which requires accepted_at IS NULL), so .select() after .update() returns
    a 403/RLS violation.

  Fix: a SECURITY DEFINER function that accepts the invite and inserts the
  league_members row atomically, bypassing the RLS catch-22.

  Returns the league_id on success so the client can redirect.
  Raises exceptions on invalid/expired/already-used invites.
*/

CREATE OR REPLACE FUNCTION public.accept_league_invite(
  p_invite_id uuid,
  p_display_name text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_invite league_invites%ROWTYPE;
  v_league_id uuid;
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

  -- Add member if not already one
  INSERT INTO league_members (league_id, user_id, display_name, phone_e164, role)
  VALUES (v_league_id, auth.uid(), p_display_name, v_invite.phone_e164, 'member')
  ON CONFLICT DO NOTHING;

  RETURN v_league_id;
END;
$$;
