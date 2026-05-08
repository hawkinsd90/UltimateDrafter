import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const ESPN_API_BASE = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons";

// ESPN defaultPositionId → fantasy position string
const ESPN_POSITION_MAP: Record<number, string> = {
  1: "QB",
  2: "RB",
  3: "WR",
  4: "TE",
  5: "K",
  16: "DST",
};

type EspnPlayerEntry = {
  id: number;
  onTeamId?: number;
  player: {
    id: number;
    fullName: string;
    defaultPositionId: number;
    proTeamId?: number;
    draftRanksByRankType?: Record<string, {
      rank?: number;
      auctionValue?: number;
      rankType?: string;
    }>;
    ownership?: {
      averageDraftPosition?: number;
      averageDraftPositionPercentChange?: number;
      percentOwned?: number;
      percentStarted?: number;
    };
    stats?: Array<{
      statSourceId: number;
      scoringPeriodId: number;
      seasonId: number;
      appliedTotal?: number;
      appliedAverage?: number;
    }>;
  };
};

type RankedPlayer = {
  espnId: string;
  name: string;
  position: string;
  standardRank: number | null;
  standardAuction: number | null;
  pprRank: number | null;
  pprAuction: number | null;
  adp: number | null;
  percentOwned: number | null;
  adpChange: number | null;
  projectedPoints: number | null;
  rawData: unknown;
};

async function fetchEspnPage(
  leagueId: string,
  season: number,
  offset: number,
  limit: number,
  cookieHeader: string | null
): Promise<{ players: EspnPlayerEntry[]; status: number }> {
  const url = `${ESPN_API_BASE}/${season}/segments/0/leagues/${leagueId}?view=kona_player_info&scoringPeriodId=0`;

  const xffFilter = {
    players: {
      filterStatus: { value: ["FREEAGENT", "WAIVERS", "ONTEAM"] },
      filterSlotIds: { value: [0, 2, 4, 6, 16, 17, 23] },
      limit,
      offset,
      sortDraftRanks: { sortPriority: 1, sortAsc: true, value: "STANDARD" },
    },
  };

  const headers: Record<string, string> = {
    "X-Fantasy-Filter": JSON.stringify(xffFilter),
    "Accept": "application/json",
  };
  if (cookieHeader) {
    headers["Cookie"] = cookieHeader;
  }

  const resp = await fetch(url, { headers });
  if (!resp.ok) {
    return { players: [], status: resp.status };
  }

  const json = await resp.json();
  return { players: json.players ?? [], status: resp.status };
}

function parsePlayer(entry: EspnPlayerEntry, season: number): RankedPlayer {
  const p = entry.player;
  const position = ESPN_POSITION_MAP[p.defaultPositionId] ?? "UNKNOWN";

  const ranks = p.draftRanksByRankType ?? {};
  const stdRank = ranks["STANDARD"];
  const pprRank = ranks["PPR"];

  const own = p.ownership ?? {};

  // Season-long projection: statSourceId=1 (projected), scoringPeriodId=0 (season total).
  // ESPN returns two entries: externalId matching prior season (actuals context) and current
  // season (true projection). Use the entry whose externalId matches the target season year.
  // Both have identical appliedTotal when scoring format doesn't affect projection display,
  // so one value is stored on both standard and ppr rows.
  const allProjStats = (p.stats ?? []).filter(
    (s) => s.statSourceId === 1 && s.scoringPeriodId === 0
  );
  const projStat =
    allProjStats.find((s) => String((s as Record<string, unknown>).externalId) === String(season)) ??
    allProjStats[allProjStats.length - 1] ??
    null;

  return {
    espnId: String(p.id),
    name: p.fullName,
    position,
    standardRank: stdRank?.rank ?? null,
    standardAuction: stdRank?.auctionValue ?? null,
    pprRank: pprRank?.rank ?? null,
    pprAuction: pprRank?.auctionValue ?? null,
    adp: own.averageDraftPosition ?? null,
    percentOwned: own.percentOwned ?? null,
    adpChange: own.averageDraftPositionPercentChange ?? null,
    projectedPoints: projStat?.appliedTotal ?? null,
    rawData: p,
  };
}

function derivePositionRanks(
  players: RankedPlayer[],
  rankField: "standardRank" | "pprRank"
): Map<string, { positionRank: number; positionRankLabel: string }> {
  // Group by position, sort by overall rank ascending (nulls last)
  const byPosition: Record<string, RankedPlayer[]> = {};
  for (const p of players) {
    if (!byPosition[p.position]) byPosition[p.position] = [];
    byPosition[p.position].push(p);
  }

  const result = new Map<string, { positionRank: number; positionRankLabel: string }>();

  for (const [pos, group] of Object.entries(byPosition)) {
    const ranked = [...group]
      .filter((p) => p[rankField] !== null)
      .sort((a, b) => (a[rankField] as number) - (b[rankField] as number));

    ranked.forEach((p, i) => {
      result.set(`${p.espnId}:${rankField}`, {
        positionRank: i + 1,
        positionRankLabel: `${pos}${i + 1}`,
      });
    });
  }

  return result;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } }
    );

    // ── Auth: require admin ─────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "").trim();
    const { data: { user }, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: adminRow } = await supabaseAdmin
      .from("admin_users")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!adminRow) {
      return new Response(JSON.stringify({ error: "Forbidden: admin access required" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Parse inputs ────────────────────────────────────────────────────────
    const body = await req.json().catch(() => ({}));
    const season: number = Number(body.season ?? 2026);
    const swid: string | null = body.swid ?? null;
    const espnS2: string | null = body.espnS2 ?? null;

    // Resolve leagueId: use provided or fall back to first ESPN league link in DB
    let leagueId: string = body.leagueId ?? "";
    if (!leagueId) {
      const { data: link } = await supabaseAdmin
        .from("external_league_links")
        .select("external_league_id")
        .eq("provider", "espn")
        .limit(1)
        .maybeSingle();
      leagueId = link?.external_league_id ?? "";
    }

    if (!leagueId) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "No ESPN league ID available. Provide leagueId or import an ESPN league first.",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build cookie header only if credentials provided — never log them
    const cookieHeader = (swid && espnS2) ? `SWID=${swid}; espn_s2=${espnS2}` : null;

    // ── Fetch all ESPN players (paginated) ──────────────────────────────────
    const PAGE_SIZE = 500;
    const allPlayers: RankedPlayer[] = [];
    let offset = 0;
    let espnStatus = 200;

    while (true) {
      const { players: page, status } = await fetchEspnPage(
        leagueId, season, offset, PAGE_SIZE, cookieHeader
      );
      espnStatus = status;

      if (status === 401 || status === 403) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "This ESPN league appears private. Provide swid and espnS2 to sync ESPN rankings.",
            espn_status: status,
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (status !== 200 || page.length === 0) break;

      for (const entry of page) {
        if (entry.player) {
          allPlayers.push(parsePlayer(entry, season));
        }
      }

      if (page.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }

    if (allPlayers.length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `No players returned from ESPN (status ${espnStatus}). League: ${leagueId}, season: ${season}.`,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Load ESPN player ID → sports_player_id mappings ─────────────────────
    // Load in pages to avoid 1000-row cap
    const allMappings: { external_player_id: string; sports_player_id: string }[] = [];
    let mapOffset = 0;
    const MAP_PAGE = 1000;
    while (true) {
      const { data: mapPage, error: mapErr } = await supabaseAdmin
        .from("external_player_mappings")
        .select("external_player_id, sports_player_id")
        .eq("provider", "espn")
        .range(mapOffset, mapOffset + MAP_PAGE - 1);
      if (mapErr) throw new Error("Failed to load player mappings: " + mapErr.message);
      if (!mapPage || mapPage.length === 0) break;
      allMappings.push(...mapPage);
      if (mapPage.length < MAP_PAGE) break;
      mapOffset += MAP_PAGE;
    }

    const espnIdToSportsId = new Map<string, string>();
    for (const m of allMappings) {
      espnIdToSportsId.set(m.external_player_id, m.sports_player_id);
    }

    // ── Derive position ranks ────────────────────────────────────────────────
    const stdPositionRanks = derivePositionRanks(allPlayers, "standardRank");
    const pprPositionRanks = derivePositionRanks(allPlayers, "pprRank");

    // ── Build upsert rows ────────────────────────────────────────────────────
    const upsertRows: Record<string, unknown>[] = [];
    const unresolvedPlayers: { espnId: string; name: string; position: string }[] = [];
    let recordsMatched = 0;

    for (const player of allPlayers) {
      const sportsPlayerId = espnIdToSportsId.get(player.espnId);
      if (!sportsPlayerId) {
        unresolvedPlayers.push({
          espnId: player.espnId,
          name: player.name,
          position: player.position,
        });
        continue;
      }
      recordsMatched++;

      const now = new Date().toISOString();

      // Standard row
      if (player.standardRank !== null) {
        const stdPos = stdPositionRanks.get(`${player.espnId}:standardRank`);
        upsertRows.push({
          sports_player_id: sportsPlayerId,
          provider: "espn",
          scoring_format: "standard",
          season,
          ranking_type: "draft_rank",
          draft_scoring_rule_id: null,
          overall_rank: player.standardRank,
          position_rank: stdPos?.positionRank ?? null,
          position_rank_label: stdPos?.positionRankLabel ?? null,
          fantasy_points: player.projectedPoints,
          adp: player.adp,
          auction_value: player.standardAuction,
          percent_owned: player.percentOwned,
          trend_count: player.adpChange !== null ? Math.round(player.adpChange) : null,
          position: player.position,
          source_label: "ESPN",
          raw_data: player.rawData,
          synced_at: now,
          updated_at: now,
        });
      }

      // PPR row
      if (player.pprRank !== null) {
        const pprPos = pprPositionRanks.get(`${player.espnId}:pprRank`);
        upsertRows.push({
          sports_player_id: sportsPlayerId,
          provider: "espn",
          scoring_format: "ppr",
          season,
          ranking_type: "draft_rank",
          draft_scoring_rule_id: null,
          overall_rank: player.pprRank,
          position_rank: pprPos?.positionRank ?? null,
          position_rank_label: pprPos?.positionRankLabel ?? null,
          fantasy_points: player.projectedPoints,
          adp: player.adp,
          auction_value: player.pprAuction,
          percent_owned: player.percentOwned,
          trend_count: player.adpChange !== null ? Math.round(player.adpChange) : null,
          position: player.position,
          source_label: "ESPN",
          raw_data: player.rawData,
          synced_at: now,
          updated_at: now,
        });
      }
    }

    // ── Upsert in batches ────────────────────────────────────────────────────
    // The unique constraint on player_rankings includes draft_scoring_rule_id,
    // but it is a nullable column. Postgres treats NULLs as distinct in unique
    // constraints, which would cause duplicate inserts on re-sync.
    // Use ON CONFLICT DO UPDATE with a WHERE clause via ignoreDuplicates=false
    // and onConflict specifying all columns. Because draft_scoring_rule_id is
    // nullable we rely on the partial index or upsert the id column instead.
    // The safest path: delete existing ESPN rows for this season/ranking_type
    // first, then insert fresh. This avoids the NULL-in-unique-key problem
    // entirely without schema changes.
    const { error: deleteErr } = await supabaseAdmin
      .from("player_rankings")
      .delete()
      .eq("provider", "espn")
      .eq("season", season)
      .eq("ranking_type", "draft_rank")
      .is("draft_scoring_rule_id", null);

    if (deleteErr) {
      throw new Error("Failed to clear existing ESPN rankings: " + deleteErr.message);
    }

    const BATCH = 500;
    let recordsUpserted = 0;
    const upsertErrors: string[] = [];

    for (let i = 0; i < upsertRows.length; i += BATCH) {
      const batch = upsertRows.slice(i, i + BATCH);
      const { error: insertErr } = await supabaseAdmin
        .from("player_rankings")
        .insert(batch);
      if (insertErr) {
        upsertErrors.push(`Batch ${i}–${i + batch.length}: ${insertErr.message}`);
      } else {
        recordsUpserted += batch.length;
      }
    }

    // ── Count by scoring_format ──────────────────────────────────────────────
    const formatCounts: Record<string, number> = {};
    for (const row of upsertRows) {
      const fmt = row.scoring_format as string;
      formatCounts[fmt] = (formatCounts[fmt] ?? 0) + 1;
    }

    return new Response(
      JSON.stringify({
        success: upsertErrors.length === 0,
        season,
        league_id: leagueId,
        endpoint: `${ESPN_API_BASE}/${season}/segments/0/leagues/${leagueId}?view=kona_player_info`,
        records_fetched: allPlayers.length,
        records_matched: recordsMatched,
        records_upserted: recordsUpserted,
        unresolved_count: unresolvedPlayers.length,
        unresolved_sample: unresolvedPlayers.slice(0, 20),
        counts_by_scoring_format: formatCounts,
        fields_detected: ["overall_rank", "position_rank", "fantasy_points", "adp", "auction_value", "percent_owned", "trend_count"],
        ranking_type: "draft_rank",
        upsert_errors: upsertErrors.length > 0 ? upsertErrors : null,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ success: false, error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
