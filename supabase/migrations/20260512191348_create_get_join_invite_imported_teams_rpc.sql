/*
  # Add get_join_invite_imported_teams RPC

  ## Summary
  Non-owner invited users cannot directly read league_imported_members because
  that table's RLS is owner-only. This SECURITY DEFINER function validates a
  join invite first, then returns unclaimed imported teams for that league —
  allowing invited users to self-link to their existing team.

  ## New Functions
  - `get_join_invite_imported_teams(p_invite_id uuid)`: Validates the invite
    (exists, not accepted, not expired) and returns unclaimed imported teams.

  ## Security
  - SECURITY DEFINER: bypasses RLS intentionally, gated behind invite validation
  - Returns empty array if invite is invalid/expired/accepted — no data leak
  - Only returns teams where invited_user_id IS NULL (unclaimed)
*/

CREATE OR REPLACE FUNCTION public.get_join_invite_imported_teams(
  p_invite_id uuid
)
RETURNS TABLE (
  id uuid,
  team_name text,
  external_owner_name text,
  provider text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_league_id uuid;
BEGIN
  -- Validate the invite: must exist, not accepted, not expired
  SELECT league_id INTO v_league_id
  FROM league_invites
  WHERE id = p_invite_id
    AND accepted_at IS NULL
    AND expires_at > now();

  -- If invalid, return empty result set
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Return unclaimed imported teams for this league
  RETURN QUERY
  SELECT
    lim.id,
    lim.team_name,
    lim.external_owner_name,
    lim.provider
  FROM league_imported_members lim
  WHERE lim.league_id = v_league_id
    AND lim.invited_user_id IS NULL
  ORDER BY lim.created_at ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_join_invite_imported_teams(uuid) TO authenticated, anon;
