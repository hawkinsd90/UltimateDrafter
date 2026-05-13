/*
  # Update get_join_invite_imported_teams to expose pre-tied team info

  When an invite was created with imported_member_id set, we want the join flow
  to know which team is pre-selected. This migration:
  - Drops and recreates the RPC to include `pretied_member_id` in the result
    (the imported_member_id from the invite, if any)
  - Also returns `is_pretied` boolean so the UI can lock the selection
*/

DROP FUNCTION IF EXISTS get_join_invite_imported_teams(uuid);

CREATE OR REPLACE FUNCTION get_join_invite_imported_teams(p_invite_id uuid)
RETURNS TABLE (
  id uuid,
  team_name text,
  external_owner_name text,
  provider text,
  pretied_member_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_league_id uuid;
  v_pretied_id uuid;
BEGIN
  -- Validate invite exists and is unused/unexpired
  SELECT li.league_id, li.imported_member_id
  INTO v_league_id, v_pretied_id
  FROM league_invites li
  WHERE li.id = p_invite_id
    AND li.accepted_at IS NULL
    AND li.expires_at > now();

  IF v_league_id IS NULL THEN
    RETURN;
  END IF;

  -- If invite is pre-tied to a specific imported member, return only that one
  IF v_pretied_id IS NOT NULL THEN
    RETURN QUERY
      SELECT lim.id, lim.team_name, lim.external_owner_name, lim.provider, v_pretied_id
      FROM league_imported_members lim
      WHERE lim.id = v_pretied_id
        AND lim.invited_user_id IS NULL;
    RETURN;
  END IF;

  -- Otherwise return all unclaimed imported members for this league
  RETURN QUERY
    SELECT lim.id, lim.team_name, lim.external_owner_name, lim.provider, NULL::uuid
    FROM league_imported_members lim
    WHERE lim.league_id = v_league_id
      AND lim.invited_user_id IS NULL
    ORDER BY lim.created_at;
END;
$$;

GRANT EXECUTE ON FUNCTION get_join_invite_imported_teams(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION get_join_invite_imported_teams(uuid) FROM anon;
