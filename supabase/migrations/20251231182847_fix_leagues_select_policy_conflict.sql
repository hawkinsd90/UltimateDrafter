/*
  # Fix Leagues SELECT Policy Conflict
  
  ## Problem
  Multiple SELECT policies for authenticated users are conflicting:
  - "Anonymous users can view all leagues" allows all leagues
  - "Users can view leagues they own or participate in" restricts to owned leagues
  
  When multiple SELECT policies exist, PostgreSQL requires ALL to pass (AND logic),
  so authenticated users can't see any leagues.
  
  ## Solution
  Drop the restrictive SELECT policy. Keep only the permissive one that allows
  all users (both anon and authenticated) to view all leagues.
  
  The INSERT and UPDATE policies will still enforce proper ownership.
*/

-- Remove the restrictive SELECT policy that conflicts with the permissive one
DROP POLICY IF EXISTS "Users can view leagues they own or participate in" ON leagues;