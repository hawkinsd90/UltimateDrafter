/*
# Revoke PUBLIC EXECUTE on manager identity management RPCs

## Security
By default, SECURITY DEFINER functions grant EXECUTE to PUBLIC.
The previous revoke only targeted anon and authenticated roles, but
PUBLIC encompasses both. Revoke from PUBLIC to fully lock down direct
REST access. The edge function uses the service role key which bypasses
all permission checks.
*/
REVOKE EXECUTE ON FUNCTION public.rename_historical_manager(uuid, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.link_historical_manager(uuid, uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.merge_historical_managers(uuid, uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.split_historical_manager(uuid, uuid, text) FROM PUBLIC;