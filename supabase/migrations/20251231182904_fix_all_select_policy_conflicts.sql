/*
  # Fix All SELECT Policy Conflicts
  
  ## Problem
  Multiple SELECT policies for authenticated users exist on several tables,
  causing PostgreSQL to apply AND logic which blocks all queries.
  
  ## Solution
  Remove all restrictive SELECT policies. Keep only the permissive policies
  that allow both anon and authenticated users to view all data.
  
  Write operations (INSERT, UPDATE, DELETE) remain properly restricted.
  
  ## Tables Fixed
  - drafts
  - draft_participants
  - draft_picks
  - user_settings
*/

-- Remove restrictive SELECT policies
DROP POLICY IF EXISTS "Users can view drafts in their leagues" ON drafts;
DROP POLICY IF EXISTS "Users can view participants in accessible drafts" ON draft_participants;
DROP POLICY IF EXISTS "Users can view picks in accessible drafts" ON draft_picks;
DROP POLICY IF EXISTS "Users can view their own settings" ON user_settings;