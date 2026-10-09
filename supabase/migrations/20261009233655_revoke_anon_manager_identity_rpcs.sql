/*
# Revoke anon/authenticated EXECUTE on manager identity management RPCs

## Security
These RPCs are called by the edge function using the service role key,
which bypasses all permission checks. Direct REST access by anon or
authenticated users would bypass the edge function's league ownership
verification. Revoke EXECUTE from both roles.

The service role (postgres) always has EXECUTE by default.
*/
REVOKE EXECUTE ON FUNCTION public.rename_historical_manager(uuid, uuid, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.rename_historical_manager(uuid, uuid, text) FROM anon;

REVOKE EXECUTE ON FUNCTION public.link_historical_manager(uuid, uuid, uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.link_historical_manager(uuid, uuid, uuid) FROM anon;

REVOKE EXECUTE ON FUNCTION public.merge_historical_managers(uuid, uuid, uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.merge_historical_managers(uuid, uuid, uuid) FROM anon;

REVOKE EXECUTE ON FUNCTION public.split_historical_manager(uuid, uuid, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.split_historical_manager(uuid, uuid, text) FROM anon;