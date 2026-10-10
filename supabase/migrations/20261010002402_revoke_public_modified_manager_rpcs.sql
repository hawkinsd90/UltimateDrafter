/*
# Revoke PUBLIC EXECUTE on modified manager identity RPCs

The split_historical_manager, merge_historical_managers, and
link_historical_manager functions were recreated. SECURITY DEFINER
functions default to EXECUTE for PUBLIC. Revoke from PUBLIC, anon,
and authenticated to ensure they can only be called via the edge
function's service role key.
*/
REVOKE EXECUTE ON FUNCTION public.split_historical_manager(uuid, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.split_historical_manager(uuid, uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.split_historical_manager(uuid, uuid, text) FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.merge_historical_managers(uuid, uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.merge_historical_managers(uuid, uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.merge_historical_managers(uuid, uuid, uuid) FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.link_historical_manager(uuid, uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.link_historical_manager(uuid, uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.link_historical_manager(uuid, uuid, uuid) FROM authenticated;
