/*
# Revoke authenticated EXECUTE on save_historical_season

## Security
The edge function calls this RPC using the service role key, which bypasses
all permission checks — so the EXECUTE grant on authenticated is unnecessary.
Keeping it allows any authenticated user to call the RPC directly via REST,
bypassing the edge function's league ownership verification. Revoke it.

The service role (postgres) always has EXECUTE by default and is unaffected.
*/
REVOKE EXECUTE ON FUNCTION public.save_historical_season(uuid, int, jsonb, uuid, uuid, text, text) FROM authenticated;