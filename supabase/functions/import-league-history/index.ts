import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import type { HistoricalImportRequest } from "./shared/historical-types.ts";
import { fetchEspnHistoricalSeason } from "./providers/espn-history.ts";
import { saveHistoricalSeason } from "./shared/save-history.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  try {
    // ── Auth: verify caller has a valid JWT ─────────────────────────────────
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) {
      return jsonResponse({ error: "Authorization header is required." }, 401);
    }

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } }
    );

    const { data: { user }, error: userErr } = await adminClient.auth.getUser(token);
    if (userErr || !user) {
      return jsonResponse({ error: "Invalid or expired token." }, 401);
    }

    // ── Parse request body ───────────────────────────────────────────────────
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "Request body must be valid JSON." }, 400);
    }

    const leagueId = body.leagueId as string | undefined;
    const seasonYear = body.seasonYear as number | undefined;
    const provider = (body.provider as string | undefined) ?? "espn";
    const externalLeagueId = body.externalLeagueId as string | undefined;
    const isPrivate = Boolean(body.isPrivate);
    const swid = body.swid as string | undefined;
    const espnS2 = body.espnS2 as string | undefined;

    if (!leagueId || !seasonYear || !externalLeagueId) {
      return jsonResponse({ error: "leagueId, seasonYear, and externalLeagueId are required." }, 400);
    }

    // ── Verify league ownership ───────────────────────────────────────────────
    const { data: league, error: leagueErr } = await adminClient
      .from("leagues")
      .select("id, owner_id")
      .eq("id", leagueId)
      .maybeSingle();

    if (leagueErr || !league) {
      return jsonResponse({ error: "League not found." }, 404);
    }
    if (league.owner_id !== user.id) {
      return jsonResponse({ error: "Only the league owner can import historical data." }, 403);
    }

    // ── Find external_league_links entry for this league ─────────────────────
    const { data: link } = await adminClient
      .from("external_league_links")
      .select("id, provider, external_league_id")
      .eq("league_id", leagueId)
      .eq("provider", provider)
      .is("draft_id", null)
      .maybeSingle();

    const externalLinkId = link?.id ?? null;

    console.log(JSON.stringify({
      event: "history_import_start",
      leagueId,
      seasonYear,
      provider,
      externalLeagueId,
      externalLinkId,
      isPrivate,
    }));

    // ── Fetch from provider ──────────────────────────────────────────────────
    const normalized = await fetchEspnHistoricalSeason({
      leagueId: externalLeagueId,
      season: seasonYear,
      isPrivate,
      swid,
      espnS2,
    });

    console.log(JSON.stringify({
      event: "history_import_normalized",
      leagueId,
      seasonYear,
      teams: normalized.teams.length,
      matchups: normalized.matchups.length,
      draftPicks: normalized.draft?.picks.length ?? 0,
    }));

    // ── Persist to database ──────────────────────────────────────────────────
    const summary = await saveHistoricalSeason({
      leagueId,
      externalLinkId,
      normalized,
      callerUserId: user.id,
      adminClient,
    });

    console.log(JSON.stringify({
      event: "history_import_complete",
      leagueId,
      seasonYear,
      seasonId: summary.seasonId,
      teamsImported: summary.teamsImported,
      matchupsImported: summary.matchupsImported,
      draftPicksImported: summary.draftPicksImported,
    }));

    return jsonResponse(summary);

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(JSON.stringify({ event: "history_import_error", message }));
    return jsonResponse({ error: message }, 500);
  }
});
