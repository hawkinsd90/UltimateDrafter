/*
# Revoke anon access to save_historical_season RPC

## Context
The save_historical_season SECURITY DEFINER function was temporarily granted
EXECUTE to anon for data reconciliation purposes. Reconciliation is now complete.

## Security Change
- REVOKE EXECUTE FROM anon and PUBLIC
- Keep EXECUTE on authenticated only (used by the edge function via service role)
*/
REVOKE EXECUTE ON FUNCTION public.save_historical_season(uuid, int, jsonb, uuid, uuid, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.save_historical_season(uuid, int, jsonb, uuid, uuid, text, text) FROM PUBLIC;