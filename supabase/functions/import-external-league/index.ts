import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import { validateRequest, isValidationError } from "./shared/validation.ts";
import { saveImport } from "./shared/save-import.ts";
import { mapRosterPlayers } from "./shared/player-mapping.ts";
import { fetchEspnLeague } from "./providers/espn.ts";
import { fetchSleeperLeague } from "./providers/sleeper.ts";

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

    // Service role client — used for all DB operations after ownership is confirmed.
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } }
    );

    // Resolve caller identity from JWT
    const { data: { user }, error: userErr } = await adminClient.auth.getUser(token);
    if (userErr || !user) {
      return jsonResponse({ error: "Invalid or expired token." }, 401);
    }

    // ── Parse + validate request body ───────────────────────────────────────
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "Request body must be valid JSON." }, 400);
    }

    const validated = validateRequest(body);
    if (isValidationError(validated)) {
      return jsonResponse({ error: validated.message }, 400);
    }

    const { draftId, importMode, params } = validated;

    console.log(JSON.stringify({
      event: "import_start",
      draftId,
      provider: params.provider,
      importMode,
      // Safe: boolean presence only for ESPN credentials
      isPrivate: params.provider === "espn" ? params.isPrivate : undefined,
      hasSwid: params.provider === "espn" && params.isPrivate ? (params.swid.length > 0) : undefined,
      hasEspnS2: params.provider === "espn" && params.isPrivate ? (params.espnS2.length > 0) : undefined,
    }));

    // ── Fetch + normalize from provider ─────────────────────────────────────
    let normalized;

    if (params.provider === "espn") {
      normalized = await fetchEspnLeague(params);
    } else {
      normalized = await fetchSleeperLeague(params.leagueId, params.season, adminClient);
    }

    console.log(JSON.stringify({
      event: "import_normalized",
      provider: params.provider,
      draftId,
      teamCount: normalized.teams.length,
      rosterPlayerCount: normalized.rosters.length,
      scoringType: normalized.league.scoringType,
      warningCount: normalized.warnings.length,
    }));

    // ── Map roster players to sports_players ────────────────────────────────
    const mappedPlayers = await mapRosterPlayers(
      normalized.rosters,
      params.provider,
      user.id,
      adminClient
    );

    const matchedCount = mappedPlayers.filter((p) => p.resolutionStatus === "matched").length;
    const unresolvedCount = mappedPlayers.filter((p) => p.resolutionStatus === "unresolved").length;

    console.log(JSON.stringify({
      event: "import_mapping_complete",
      draftId,
      provider: params.provider,
      totalRosterPlayers: mappedPlayers.length,
      matched: matchedCount,
      unresolved: unresolvedCount,
    }));

    // ── Persist to database ─────────────────────────────────────────────────
    // saveImport re-verifies ownership and draft status server-side.
    // Credentials are never passed to saveImport.
    const summary = await saveImport({
      draftId,
      provider: params.provider,
      importMode,
      normalized,
      mappedPlayers,
      callerUserId: user.id,
      adminClient,
    });

    console.log(JSON.stringify({
      event: "import_complete",
      draftId,
      linkId: summary.linkId,
      provider: params.provider,
      teamsImported: summary.teamsImported,
      rosterPlayersImported: summary.rosterPlayersImported,
      matchedPlayers: summary.matchedPlayers,
      unresolvedPlayers: summary.unresolvedPlayers,
    }));

    return jsonResponse(summary);

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(JSON.stringify({ event: "import_error", message }));
    return jsonResponse({ error: message }, 500);
  }
});
