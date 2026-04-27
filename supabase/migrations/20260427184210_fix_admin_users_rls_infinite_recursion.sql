/*
  # Fix admin_users RLS infinite recursion

  The SELECT policy on admin_users was querying admin_users itself,
  causing infinite recursion and 500 errors on every page load.

  Fix: Drop the recursive SELECT policy and replace it with one that
  uses the existing is_admin() SECURITY DEFINER function, which bypasses
  RLS when checking admin status.
*/

DROP POLICY IF EXISTS "Admins can view admin_users" ON admin_users;
DROP POLICY IF EXISTS "Admins can insert admin_users" ON admin_users;

CREATE POLICY "Admins can view admin_users"
  ON admin_users FOR SELECT
  TO authenticated
  USING (is_admin());

CREATE POLICY "Admins can insert admin_users"
  ON admin_users FOR INSERT
  TO authenticated
  WITH CHECK (is_admin());
