/*
  # Fix leagues RLS and league_invites accept policy

  ## Changes

  1. leagues SELECT policy
     - Drop the open "Anonymous users can view all leagues" policy (USING true)
     - Add a restricted policy: user can see leagues they own OR are a member of

  2. league_invites UPDATE policy
     - The existing "Authenticated user can accept invite" policy uses WITH CHECK
       but the USING clause blocks non-owners from touching the row at all.
     - Drop and recreate it so any authenticated user can update a pending,
       non-expired invite row to set accepted_at.
*/

-- 1. Fix leagues SELECT: drop permissive policy, add restricted one
DROP POLICY IF EXISTS "Anonymous users can view all leagues" ON leagues;

CREATE POLICY "Users can view owned or member leagues"
  ON leagues FOR SELECT
  TO authenticated
  USING (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM league_members
      WHERE league_members.league_id = leagues.id
      AND league_members.user_id = auth.uid()
    )
  );

-- 2. Fix league_invites accept: drop old policy, add one that works for non-owners
DROP POLICY IF EXISTS "Authenticated user can accept invite" ON league_invites;

CREATE POLICY "Authenticated user can accept invite"
  ON league_invites FOR UPDATE
  TO authenticated
  USING (
    accepted_at IS NULL
    AND expires_at > now()
  )
  WITH CHECK (
    accepted_at IS NOT NULL
  );
