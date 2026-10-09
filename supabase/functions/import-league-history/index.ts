import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import type { HistoricalImportRequest } from "./shared/historical-types.ts";
import { fetchEspnHistoricalSeason } from "./providers/espn-history.ts";
import { saveHistoricalSeason } from "./shared/save-history.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
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

    const action = (body.action as string | undefined) ?? "import";
    const leagueId = body.leagueId as string | undefined;
    const provider = (body.provider as string | undefined) ?? "espn";
    const externalLeagueId = body.externalLeagueId as string | undefined;
    const isPrivate = Boolean(body.isPrivate);
    const swid = body.swid as string | undefined;
    const espnS2 = body.espnS2 as string | undefined;

    if (!leagueId) {
      return jsonResponse({ error: "leagueId is required." }, 400);
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
      return jsonResponse({ error: "Only the league owner can manage historical data." }, 403);
    }

    // ── Manager identity actions (don't need external league link) ────────────
    if (action === "rename_manager" || action === "link_manager" ||
        action === "merge_managers" || action === "split_manager") {
      return await handleManagerAction({ adminClient, action, body, leagueId });
    }

    // ── Import and discover actions require external league link ─────────────
    if (!externalLeagueId) {
      return jsonResponse({ error: "externalLeagueId is required for this action." }, 400);
    }

    const { data: link } = await adminClient
      .from("external_league_links")
      .select("id, provider, external_league_id")
      .eq("league_id", leagueId)
      .eq("provider", provider)
      .is("draft_id", null)
      .maybeSingle();

    if (!link) {
      return jsonResponse({ error: "No external league link found for this league." }, 404);
    }

    if (link.external_league_id !== externalLeagueId) {
      return jsonResponse({ error: "External league ID does not match this league's link." }, 403);
    }

    const externalLinkId = link.id;

    // ── Route by action ──────────────────────────────────────────────────────
    if (action === "discover") {
      return await handleDiscover({
        adminClient,
        leagueId,
        externalLeagueId,
        provider,
        isPrivate,
        swid,
        espnS2,
      });
    }

    // Default: import a single season
    const seasonYear = body.seasonYear as number | undefined;
    if (!seasonYear) {
      return jsonResponse({ error: "seasonYear is required for import action." }, 400);
    }

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

// ── Discovery action ──────────────────────────────────────────────────────────
// Fetches the current-season ESPN endpoint to get `status.previousSeasons`,
// which is the authoritative list of years this league existed. Also fetches
// which seasons are already imported from the database, so the frontend can
// show available / imported / unavailable status per year.

async function handleDiscover(params: {
  adminClient: ReturnType<typeof createClient>;
  leagueId: string;
  externalLeagueId: string;
  provider: string;
  isPrivate: boolean;
  swid?: string;
  espnS2?: string;
}): Promise<Response> {
  const { adminClient, leagueId, externalLeagueId, provider, isPrivate, swid, espnS2 } = params;

  // Use the current year as the ESPN season to query — ESPN returns
  // previousSeasons in the status object for the current season.
  const currentYear = new Date().getFullYear();

  const ESPN_API_BASE = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons";
  const views = ["mStatus"];
  const url =
    `${ESPN_API_BASE}/${currentYear}/segments/0/leagues/${externalLeagueId}` +
    `?${views.map((v) => `view=${v}`).join("&")}`;

  const headers: Record<string, string> = {
    "Accept": "application/json",
    "User-Agent": "UltimateDrafter/1.0",
  };

  if (isPrivate && swid && espnS2) {
    headers["Cookie"] = `SWID=${swid}; espn_s2=${espnS2}`;
  }

  let discoveredSeasons: number[] = [];
  let requiresAuth = false;
  let discoveryError: string | null = null;

  try {
    const resp = await fetch(url, { headers });

    const contentType = resp.headers.get("content-type") ?? "";

    if (resp.status === 401 || resp.status === 403) {
      requiresAuth = true;
      discoveryError = isPrivate
        ? "ESPN denied access. The credentials may be expired or incorrect."
        : "This league may be private. Enable private mode and provide credentials.";
    } else if (resp.status === 404) {
      discoveryError = `ESPN returned 404 for the current season. The league may not exist for ${currentYear}.`;
    } else if (!resp.ok || !contentType.includes("application/json")) {
      discoveryError = `ESPN API returned HTTP ${resp.status}. Unexpected response.`;
    } else {
      const raw: unknown = await resp.json();
      if (typeof raw === "object" && raw !== null) {
        const data = raw as Record<string, unknown>;
        const status = data?.status as Record<string, unknown> | undefined;
        const prevSeasonsRaw = status?.previousSeasons;
        if (Array.isArray(prevSeasonsRaw)) {
          discoveredSeasons = prevSeasonsRaw.filter(
            (n): n is number => typeof n === "number"
          ).sort((a, b) => b - a); // descending
        }
      }
    }
  } catch (err) {
    discoveryError = err instanceof Error ? err.message : "Network error contacting ESPN.";
  }

  // Fetch already-imported seasons from the database
  const { data: existingSeasons } = await adminClient
    .from("league_history_seasons")
    .select("season_year")
    .eq("league_id", leagueId);

  const importedYears = new Set(
    (existingSeasons ?? []).map((s) => (s as Record<string, unknown>).season_year as number)
  );

  // Build the result: for each discovered year, mark as imported or available
  const seasons = discoveredSeasons.map((year) => ({
    year,
    status: importedYears.has(year) ? "imported" : "available",
  }));

  return jsonResponse({
    discoveredSeasons: seasons,
    requiresAuth,
    error: discoveryError,
    currentYear,
  });
}

// ── Manager identity actions ──────────────────────────────────────────────────
// Routes rename/link/merge/split actions to the corresponding RPC functions.
// All actions require league ownership (already verified by the caller).

async function handleManagerAction(params: {
  adminClient: ReturnType<typeof createClient>;
  action: string;
  body: Record<string, unknown>;
  leagueId: string;
}): Promise<Response> {
  const { adminClient, action, body, leagueId } = params;

  if (action === "rename_manager") {
    const managerId = body.managerId as string | undefined;
    const displayName = body.displayName as string | undefined;
    if (!managerId || !displayName) {
      return jsonResponse({ error: "managerId and displayName are required." }, 400);
    }
    const { data, error } = await adminClient.rpc("rename_historical_manager", {
      p_manager_id: managerId,
      p_league_id: leagueId,
      p_display_name: displayName,
    });
    if (error) return jsonResponse({ error: error.message }, 500);
    return jsonResponse(data);
  }

  if (action === "link_manager") {
    const managerId = body.managerId as string | undefined;
    const linkedUserId = body.linkedUserId as string | undefined;
    if (!managerId || !linkedUserId) {
      return jsonResponse({ error: "managerId and linkedUserId are required." }, 400);
    }
    const { data, error } = await adminClient.rpc("link_historical_manager", {
      p_manager_id: managerId,
      p_league_id: leagueId,
      p_linked_user_id: linkedUserId,
    });
    if (error) return jsonResponse({ error: error.message }, 500);
    return jsonResponse(data);
  }

  if (action === "merge_managers") {
    const sourceId = body.sourceId as string | undefined;
    const targetId = body.targetId as string | undefined;
    if (!sourceId || !targetId) {
      return jsonResponse({ error: "sourceId and targetId are required." }, 400);
    }
    const { data, error } = await adminClient.rpc("merge_historical_managers", {
      p_source_id: sourceId,
      p_target_id: targetId,
      p_league_id: leagueId,
    });
    if (error) return jsonResponse({ error: error.message }, 500);
    return jsonResponse(data);
  }

  if (action === "split_manager") {
    const teamManagerId = body.teamManagerId as string | undefined;
    const newDisplayName = body.newDisplayName as string | undefined;
    if (!teamManagerId || !newDisplayName) {
      return jsonResponse({ error: "teamManagerId and newDisplayName are required." }, 400);
    }
    const { data, error } = await adminClient.rpc("split_historical_manager", {
      p_team_manager_id: teamManagerId,
      p_league_id: leagueId,
      p_new_display_name: newDisplayName,
    });
    if (error) return jsonResponse({ error: error.message }, 500);
    return jsonResponse(data);
  }

  return jsonResponse({ error: "Unknown manager action." }, 400);
}
