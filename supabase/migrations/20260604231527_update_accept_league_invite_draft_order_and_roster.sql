/*
  # Update accept_league_invite — draft_order auto-assign + roster row backfill

  When a user accepts an invite:
  1. The INSERT trigger (trg_assign_draft_order) automatically assigns draft_order.
  2. If an imported team is claimed (p_imported_member_id provided):
     a. Update league_imported_members.invited_user_id (already guarded against double-claim).
     b. Update any existing league_roster_players rows for that imported_member_id
        with the now-known league_member_id and user_id.

  No change to the public API signature — fully backwards compatible.
*/

CREATE OR REPLACE FUNCTION public.accept_league_invite(
  p_invite_id          uuid,
  p_display_name       text,
  p_imported_member_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invite           league_invites%ROWTYPE;
  v_league_id        uuid;
  v_member_id        uuid;
  v_rows_updated     integer;
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
  UPDATE league_invites SET accepted_at = now() WHERE id = p_invite_id;

  v_league_id := v_invite.league_id;

  -- Insert member if not already one.
  -- The trg_assign_draft_order trigger fires here and auto-assigns draft_order.
  INSERT INTO league_members (league_id, user_id, display_name, phone_e164, role)
  VALUES (v_league_id, auth.uid(), p_display_name, v_invite.phone_e164, 'member')
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_member_id;

  -- If already a member, look up their existing id
  IF v_member_id IS NULL THEN
    SELECT id INTO v_member_id
    FROM league_members
    WHERE league_id = v_league_id AND user_id = auth.uid();
  END IF;

  -- Claim imported team if provided
  IF p_imported_member_id IS NOT NULL AND v_member_id IS NOT NULL THEN
    -- Guard: slot must not already be claimed
    UPDATE league_imported_members
    SET invited_user_id = auth.uid()
    WHERE id           = p_imported_member_id
      AND league_id    = v_league_id
      AND invited_user_id IS NULL;

    GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
    IF v_rows_updated = 0 THEN
      RAISE EXCEPTION 'Imported team already claimed or unavailable';
    END IF;

    -- Backfill league_member_id and user_id onto any existing roster rows
    -- for this imported team (seeded during import before the claim).
    UPDATE league_roster_players
    SET league_member_id = v_member_id,
        user_id          = auth.uid()
    WHERE imported_member_id = p_imported_member_id
      AND league_id          = v_league_id
      AND league_member_id IS NULL;
  END IF;

  RETURN v_league_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_league_invite(uuid, text, uuid) TO authenticated;
