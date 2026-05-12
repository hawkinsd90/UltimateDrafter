/*
  # Revoke anon execute on get_join_invite_imported_teams

  JoinLeague requires sign-in before a user can join a league.
  The imported team picker is only shown to authenticated users.
  Granting anon EXECUTE is unnecessary and expands the attack surface.
*/

REVOKE EXECUTE ON FUNCTION public.get_join_invite_imported_teams(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_join_invite_imported_teams(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_join_invite_imported_teams(uuid) TO authenticated;
