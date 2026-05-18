/*
  # Fix league_members SELECT RLS — members can see all members in their league

  ## Problem
  The current SELECT policy only lets:
  - League owner see all members
  - Each member see only their own row

  This means non-owner members see an incomplete roster (missing the owner and other members).

  ## Change
  Replace "Member can read own row" with a policy that lets any authenticated user
  see all members of leagues they themselves belong to.
*/

DROP POLICY IF EXISTS "Member can read own row" ON league_members;

CREATE POLICY "Members can view all members in their leagues"
  ON league_members FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM league_members lm2
      WHERE lm2.league_id = league_members.league_id
        AND lm2.user_id = auth.uid()
    )
  );
