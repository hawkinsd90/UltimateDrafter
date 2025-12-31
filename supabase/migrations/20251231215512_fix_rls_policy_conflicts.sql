/*
  # Fix RLS Policy Conflicts

  ## Problem
  Multiple SELECT policies exist on several tables, causing PostgreSQL to apply
  AND logic which blocks authenticated user queries. When you have:
  - Policy 1: "allow all" (qual: true)
  - Policy 2: "allow specific rows" (qual: restrictive condition)
  
  PostgreSQL requires BOTH to pass: true AND restrictive = restrictive never passes for "all"
  
  ## Solution
  Remove the restrictive SELECT policies for authenticated users since there are
  already permissive SELECT policies that allow viewing all data.
  
  The INSERT and UPDATE policies remain properly restricted by ownership.
  
  ## Tables Fixed
  - drafts: Remove "Users can view drafts they participate in"
  - draft_participants: Remove "Users can view participants in their drafts"
*/

-- Drop the restrictive SELECT policy on drafts (keep the permissive one)
DROP POLICY IF EXISTS "Users can view drafts they participate in" ON drafts;

-- Drop the restrictive SELECT policy on draft_participants (keep the permissive one)
DROP POLICY IF EXISTS "Users can view participants in their drafts" ON draft_participants;
