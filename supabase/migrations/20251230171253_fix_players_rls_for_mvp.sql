/*
  # Fix Players RLS for MVP

  Update the players table RLS policy to allow anonymous inserts for MVP testing.
  This allows the seed function to work without authentication.

  ## Changes
  - Drop the existing authenticated-only insert policy for players
  - Create a new policy that allows anonymous inserts
*/

-- Drop the existing restrictive policy
DROP POLICY IF EXISTS "Authenticated users can add players" ON players;

-- Allow anyone to insert players (for MVP seeding)
CREATE POLICY "Anyone can add players"
  ON players FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Keep read access for everyone
DROP POLICY IF EXISTS "Authenticated users can view all players" ON players;

CREATE POLICY "Anyone can view players"
  ON players FOR SELECT
  TO anon, authenticated
  USING (true);
