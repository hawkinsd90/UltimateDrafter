/*
  # Fix get_league_member_contacts to allow league owner access

  The previous version only checked league_members for access, but the league owner
  may not have a row in league_members (they're tracked via leagues.owner_id).
  This caused the duplicate-invite check to fail silently for owners.
*/

CREATE OR REPLACE FUNCTION get_league_member_contacts(p_league_id uuid)
RETURNS TABLE(email text, phone_e164 text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Caller must be the owner OR a member of this league
  IF NOT (
    EXISTS (
      SELECT 1 FROM leagues
      WHERE id = p_league_id AND owner_id = auth.uid()
    )
    OR is_league_member(p_league_id, auth.uid())
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT
    au.email::text,
    COALESCE(up.phone_e164, lm.phone_e164)::text AS phone_e164
  FROM league_members lm
  LEFT JOIN auth.users au ON au.id = lm.user_id
  LEFT JOIN user_profile up ON up.user_id = lm.user_id
  WHERE lm.league_id = p_league_id
    AND lm.user_id IS NOT NULL;
END;
$$;
