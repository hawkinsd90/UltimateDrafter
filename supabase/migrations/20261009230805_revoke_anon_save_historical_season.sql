/*
# Revoke anon execute on save_historical_season

## Purpose
The save_historical_season SECURITY DEFINER function was granted EXECUTE to authenticated
but Postgres also granted it to anon by default (via PUBLIC). This allows unauthenticated
users to call the function via the REST API and write data.

## Changes
- Revoke EXECUTE on save_historical_season from anon and PUBLIC
- Keep EXECUTE on authenticated (the edge function uses service role which bypasses this)
*/
REVOKE EXECUTE ON FUNCTION public.save_historical_season(uuid, int, jsonb, uuid, uuid, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.save_historical_season(uuid, int, jsonb, uuid, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_historical_season(uuid, int, jsonb, uuid, uuid, text, text) TO authenticated;