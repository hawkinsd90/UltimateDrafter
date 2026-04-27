/*
  # Fix infinite recursion in leagues RLS policy

  The "Users can view owned or member leagues" policy on `leagues` references
  `league_members`, whose SELECT policies reference `leagues` back — causing
  infinite recursion.

  Fix: create a SECURITY DEFINER function that checks membership without
  triggering RLS on either table, then use it in the leagues policy.
*/

-- Helper function: returns true if the given user is a member of the given league.
-- SECURITY DEFINER bypasses RLS so there is no recursive policy evaluation.
CREATE OR REPLACE FUNCTION public.is_league_member(p_league_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM league_members
    WHERE league_id = p_league_id
      AND user_id = p_user_id
  );
$$;

-- Drop the recursive policy and replace it with one using the helper
DROP POLICY IF EXISTS "Users can view owned or member leagues" ON leagues;

CREATE POLICY "Users can view owned or member leagues"
  ON leagues FOR SELECT
  TO authenticated
  USING (
    owner_id = auth.uid()
    OR public.is_league_member(id, auth.uid())
  );
