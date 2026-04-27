/*
  # Fix admin_users RLS — eliminate all recursion

  is_admin() queries admin_users, and admin_users policies call is_admin(),
  creating a cycle. Fix: rewrite is_admin() as SECURITY DEFINER so it runs
  as the function owner (bypassing RLS), then the SELECT policy can safely
  use it without looping.

  Also drop the INSERT policy that used is_admin() for the same reason —
  initial admin seeding must be done directly via service role / SQL editor.
*/

-- Drop recursive policies
DROP POLICY IF EXISTS "Admins can view admin_users" ON admin_users;
DROP POLICY IF EXISTS "Admins can insert admin_users" ON admin_users;

-- Rewrite is_admin() as SECURITY DEFINER so it reads admin_users
-- without triggering RLS on that table (runs as the definer, not the caller).
CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_users WHERE user_id = auth.uid()
  );
$$;

-- SELECT: use is_admin() which now bypasses RLS safely
CREATE POLICY "Admins can view admin_users"
  ON admin_users FOR SELECT
  TO authenticated
  USING (is_admin());

-- INSERT: only via service role (SQL editor / migration).
-- No policy means authenticated users cannot self-grant admin.
