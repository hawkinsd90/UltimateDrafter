/*
  # Create get_league_member_contacts RPC

  Returns the email addresses and verified phone numbers of all current members
  of a given league. Used client-side to block inviting people already in the league,
  even if they used a different email or phone to join.

  Security: SECURITY DEFINER so it can read auth.users emails. Only returns data
  for leagues where the calling user is a member or owner.
*/

CREATE OR REPLACE FUNCTION get_league_member_contacts(p_league_id uuid)
RETURNS TABLE(email text, phone_e164 text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Caller must be a member or owner of this league
  IF NOT EXISTS (
    SELECT 1 FROM league_members lm
    WHERE lm.league_id = p_league_id
      AND lm.user_id = auth.uid()
  ) AND NOT EXISTS (
    SELECT 1 FROM leagues l
    WHERE l.id = p_league_id
      AND l.owner_id = auth.uid()
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
