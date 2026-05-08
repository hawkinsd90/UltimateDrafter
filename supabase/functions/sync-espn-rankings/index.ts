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

// ESPN proTeamId → Sleeper dst_XXX suffix (for DST team mapping)
// Derived from observed ESPN API responses: id=-16{proTeamId}, name="<Nickname> D/ST"
const ESPN_PRO_TEAM_TO_DST: Record<number, string> = {
  1:  "ATL", 2:  "BUF", 3:  "CHI", 4:  "CIN", 5:  "CLE",
  6:  "DAL", 7:  "DEN", 8:  "DET", 9:  "GB",  10: "TEN",
  11: "IND", 12: "KC",  13: "LV",  14: "LAR", 15: "MIA",
  16: "MIN", 17: "NE",  18: "NO",  19: "NYG", 20: "NYJ",
  21: "PHI", 22: "ARI", 23: "PIT", 24: "LAC", 25: "SF",
  26: "SEA", 27: "TB",  28: "WAS", 29: "CAR", 30: "JAX",
  33: "BAL", 34: "HOU",
};

// Normalize a player name for fuzzy matching:
// lowercase, strip punctuation, remove name suffixes (jr/sr/ii/iii/iv/v), collapse spaces
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/['.,-]/g, "")         // strip punctuation (apostrophes, periods, commas)
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "") // remove generational suffixes
    .replace(/\s+/g, " ")
    .trim();
}

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
  proTeamId: number | null;
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
  // ESPN returns two entries keyed by externalId: prior season (actuals context) and current
  // season (true projection). Prefer the entry whose externalId matches the target season.
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
    proTeamId: p.proTeamId ?? null,
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
        if (entry.player) allPlayers.push(parsePlayer(entry, season));
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

    // ── Load existing ESPN player ID → sports_player_id mappings ────────────
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

    // ── Load sports_players for normalized-name fallback matching ────────────
    // We need: id, display_name, fantasy_position for non-DST players
    // and id, provider_player_id for DST players (to match via dst_XXX)
    const allSportsPlayers: {
      id: string;
      display_name: string;
      fantasy_position: string;
      provider_player_id: string;
    }[] = [];
    let spOffset = 0;
    const SP_PAGE = 1000;
    while (true) {
      const { data: spPage, error: spErr } = await supabaseAdmin
        .from("sports_players")
        .select("id, display_name, fantasy_position, provider_player_id")
        .range(spOffset, spOffset + SP_PAGE - 1);
      if (spErr) throw new Error("Failed to load sports_players: " + spErr.message);
      if (!spPage || spPage.length === 0) break;
      allSportsPlayers.push(...spPage);
      if (spPage.length < SP_PAGE) break;
      spOffset += SP_PAGE;
    }

    // Build lookup: normalizedName|position → sports_player id
    // Only keep entries where the combination is unambiguous (one match)
    const namePositionIndex = new Map<string, string[]>();
    for (const sp of allSportsPlayers) {
      if (sp.fantasy_position === "DST") continue; // handled separately
      const key = `${normalizeName(sp.display_name)}|${sp.fantasy_position}`;
      const existing = namePositionIndex.get(key) ?? [];
      existing.push(sp.id);
      namePositionIndex.set(key, existing);
    }

    // Build DST lookup: dst_XXX → sports_player id
    const dstProviderIdToSportsId = new Map<string, string>();
    for (const sp of allSportsPlayers) {
      if (sp.fantasy_position === "DST" && sp.provider_player_id?.startsWith("dst_")) {
        dstProviderIdToSportsId.set(sp.provider_player_id, sp.id);
      }
    }

    // ── Resolve unmapped ESPN players via fallback matching ──────────────────
    const newMappingRows: Record<string, unknown>[] = [];

    for (const player of allPlayers) {
      if (espnIdToSportsId.has(player.espnId)) continue; // already mapped

      let resolvedId: string | null = null;
      let method = "auto_name";
      let confidence = 0.9;

      if (player.position === "DST") {
        // DST: use proTeamId → dst_XXX abbreviation
        const abbr = player.proTeamId !== null
          ? ESPN_PRO_TEAM_TO_DST[player.proTeamId] ?? null
          : null;
        if (abbr) {
          const dstKey = `dst_${abbr}`;
          resolvedId = dstProviderIdToSportsId.get(dstKey) ?? null;
          method = "auto_name";
          confidence = 1.0;
        }
      } else {
        // Non-DST: normalize name + match on position
        const normalizedEspn = normalizeName(player.name);
        const key = `${normalizedEspn}|${player.position}`;
        const candidates = namePositionIndex.get(key) ?? [];
        if (candidates.length === 1) {
          // Exactly one sports_player with this normalized name + position — high confidence
          resolvedId = candidates[0];
          method = "auto_name";
          confidence = 0.9;
        }
        // If 0 or >1 candidates, leave unresolved
      }

      if (resolvedId) {
        espnIdToSportsId.set(player.espnId, resolvedId);
        newMappingRows.push({
          provider: "espn",
          external_player_id: player.espnId,
          sports_player_id: resolvedId,
          external_player_name: player.name,
          external_position: player.position,
          mapping_method: method,
          confidence,
          created_by: user.id,
        });
      }
    }

    // Insert new mapping rows in batches (ignore conflicts from prior runs)
    let newMappingsInserted = 0;
    const MAPPING_BATCH = 500;
    for (let i = 0; i < newMappingRows.length; i += MAPPING_BATCH) {
      const batch = newMappingRows.slice(i, i + MAPPING_BATCH);
      const { error: mappingErr } = await supabaseAdmin
        .from("external_player_mappings")
        .upsert(batch, { onConflict: "provider,external_player_id", ignoreDuplicates: true });
      if (!mappingErr) newMappingsInserted += batch.length;
    }

    // ── Derive position ranks ────────────────────────────────────────────────
    const stdPositionRanks = derivePositionRanks(allPlayers, "standardRank");
    const pprPositionRanks = derivePositionRanks(allPlayers, "pprRank");

    // ── Build insert rows ────────────────────────────────────────────────────
    const upsertRows: Record<string, unknown>[] = [];
    const unresolvedPlayers: { espnId: string; name: string; position: string }[] = [];
    let recordsMatched = 0;

    for (const player of allPlayers) {
      const sportsPlayerId = espnIdToSportsId.get(player.espnId);
      if (!sportsPlayerId) {
        unresolvedPlayers.push({ espnId: player.espnId, name: player.name, position: player.position });
        continue;
      }
      recordsMatched++;

      const now = new Date().toISOString();

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

    // Delete existing ESPN rows then insert fresh (avoids NULL-in-unique-key problem)
    const { error: deleteErr } = await supabaseAdmin
      .from("player_rankings")
      .delete()
      .eq("provider", "espn")
      .eq("season", season)
      .eq("ranking_type", "draft_rank")
      .is("draft_scoring_rule_id", null);

    if (deleteErr) throw new Error("Failed to clear existing ESPN rankings: " + deleteErr.message);

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
        new_mappings_created: newMappingsInserted,
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
