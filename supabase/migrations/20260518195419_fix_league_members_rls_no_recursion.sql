/*
  # Fix league_members SELECT RLS — eliminate infinite recursion

  ## Problem
  The "Members can view all members in their leagues" policy queries league_members
  from within a league_members policy, causing infinite recursion (error 42P17).

  ## Solution
  Use a SECURITY DEFINER helper function that bypasses RLS to check membership,
  avoiding the self-referential policy loop. The function is marked STABLE and
  uses SET search_path for security.

  We also keep the league owner access via the leagues table (no recursion risk).
*/

-- Drop the recursive policy
DROP POLICY IF EXISTS "Members can view all members in their leagues" ON league_members;
DROP POLICY IF EXISTS "League owner can read members" ON league_members;

-- Helper: returns true if the given user is a member of the given league
-- SECURITY DEFINER bypasses RLS so it won't recurse
CREATE OR REPLACE FUNCTION is_league_member(p_league_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM league_members
    WHERE league_id = p_league_id
      AND user_id = p_user_id
  );
$$;

-- Members (and owners) can see all rows in leagues they belong to
-- Uses the helper function — no recursion
CREATE POLICY "Members and owners can view all members in their league"
  ON league_members FOR SELECT
  TO authenticated
  USING (
    is_league_member(league_id, auth.uid())
    OR EXISTS (
      SELECT 1 FROM leagues
      WHERE leagues.id = league_members.league_id
        AND leagues.owner_id = auth.uid()
    )
  );
