import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// Sleeper bulk weekly stats endpoint — returns object keyed by player_id (or TEAM_xxx for DST)
// All stat values are floats; zero-value stats are omitted entirely.
const SLEEPER_STATS_URL = (season: number, week: number) =>
  `https://api.sleeper.app/v1/stats/nfl/regular/${season}/${week}`;

// Number of regular season weeks (18 since 2021)
const NFL_REGULAR_SEASON_WEEKS = 18;

// Sleeper stat key → canonical column name
// Keys not listed here are unknown and will be reported but not mapped.
const SLEEPER_KEY_MAP: Record<string, string> = {
  // Passing
  pass_yd:   "passing_yards",
  pass_td:   "passing_tds",
  pass_int:  "passing_ints",
  pass_2pt:  "passing_2pt",
  // Rushing
  rush_yd:   "rushing_yards",
  rush_td:   "rushing_tds",
  rush_2pt:  "rushing_2pt",
  // Receiving
  rec:       "receptions",
  rec_yd:    "receiving_yards",
  rec_td:    "receiving_tds",
  rec_2pt:   "receiving_2pt",
  // Misc offense
  fum_lost:  "fumbles_lost",
  st_td:     "return_tds",   // ST/return TD on individual players
  // Kicking — FG brackets: Sleeper uses 20_29, 30_39, 40_49, 50_59
  // We map 20_29 + 30_39 → fg_made_0_39 (closest match to our schema bucket)
  fgm_20_29: "fg_made_0_39",
  fgm_30_39: "fg_made_0_39",  // accumulated into same column via sum
  fgm_40_49: "fg_made_40_49",
  fgm_50_59: "fg_made_50_plus",
  fgm_50p:   "fg_made_50_plus",  // alternate 50+ bucket; accumulated
  fgmiss:    "fg_missed",
  xpm:       "xp_made",
  // DST
  sack:      "sacks",
  int:       "def_interceptions",  // interceptions caught by defense
  fum_rec:   "fumble_recoveries",
  def_td:    "def_tds",
  safe:      "safeties",
  blk_kick:  "blocks",
  // DST yards allowed — Sleeper uses opp_off_yd (opponent's offensive yards)
  opp_off_yd: "yards_allowed",
  // pts_allow is NOT available in Sleeper's weekly bulk endpoint.
  // It would need score data from matchup endpoints. Stored as NULL.
};

// Keys that appear in every entry but carry no fantasy scoring value.
// These are silently skipped (not reported as unknown).
const KNOWN_NON_SCORING_KEYS = new Set([
  "gp", "gs", "gms_active", "off_snp", "tm_off_snp", "tm_def_snp", "tm_st_snp",
  "pts_ppr", "pts_half_ppr", "pts_std",
  "pos_rank_ppr", "pos_rank_half_ppr", "pos_rank_std",
  "rank_ppr", "rank_half_ppr", "rank_std",
  "pass_att", "pass_cmp", "pass_inc", "pass_cmp_40p",
  "pass_air_yd", "pass_fd", "pass_lng", "pass_rtg", "pass_rush_yd",
  "pass_rz_att", "pass_sack", "pass_sack_yds", "pass_td_lng", "pass_td_40p", "pass_td_50p",
  "pass_ypa", "pass_ypc",
  "rush_att", "rush_fd", "rush_lng", "rush_rz_att", "rush_td_lng",
  "rush_tkl_loss", "rush_tkl_loss_yd", "rush_yac", "rush_ypa", "rush_btkl",
  "rush_rec_yd", "rush_ypc",
  "rec_tgt", "rec_fd", "rec_lng", "rec_yar", "rec_air_yd", "rec_ypr", "rec_ypt",
  "rec_drop", "rec_rz_tgt", "rec_0_4", "rec_5_9", "rec_10_19", "rec_30_39",
  "fga", "fgm", "fgm_lng", "fgm_pct", "fgm_yds", "fgm_yds_over_30",
  "fgmiss_40_49", "fgmiss_50_59", "fgmiss_50p", "kick_pts",
  "xpa",
  "cmp_pct", "anytime_tds", "bonus_fd_qb", "bonus_pass_cmp_25", "bonus_pass_yd_300",
  "bonus_rush_yd_100", "bonus_rush_yd_150", "bonus_rec_yd_100", "bonus_rec_yd_150",
  "passing_yards_300_bonus", "passing_yards_400_bonus",
  "rushing_yards_100_bonus", "rushing_yards_150_bonus",
  "pass_int_td", "idp_tkl", "idp_tkl_solo", "idp_int", "idp_int_ret_yd",
  "penalty", "penalty_yd",
  // DST / team-level non-scoring
  "td", "sack_yd", "tkl", "tkl_loss", "tkl_loss_yd", "tkl_solo", "tkl_ast",
  "qb_hit", "ff", "fum", "int_ret_yd", "st_tkl_solo", "kr", "kr_yd", "kr_lng",
  "kr_ypa", "pr", "pr_yd", "pr_lng", "pr_ypa",
  "opp_fd", "opp_pass_fd", "opp_rush_fd", "opp_off_yd_per_play",
  "off_yd", "off_yd_per_play", "fd", "rz_att", "rz_conv", "rz_pct",
  "g2g_att", "g2g_conv", "g2g_pct", "down_3_att", "down_3_conv", "down_3_pct",
  "down_4_att", "down_4_conv", "down_4_pct", "punts",
  "pass_td", "rec_td", "rush_td",  // team-level duplicates
  "pass_yd", "rec_yd", "rush_yd",  // team-level duplicates
  "rec", "pass_rz_att", "rush_yac",
]);

type CanonicalStats = {
  passing_yards: number;
  passing_tds: number;
  passing_ints: number;
  passing_2pt: number;
  rushing_yards: number;
  rushing_tds: number;
  rushing_2pt: number;
  receptions: number;
  receiving_yards: number;
  receiving_tds: number;
  receiving_2pt: number;
  fumbles_lost: number;
  return_tds: number;
  fg_made_0_39: number;
  fg_made_40_49: number;
  fg_made_50_plus: number;
  fg_missed: number;
  xp_made: number;
  xp_missed: number;
  sacks: number;
  def_interceptions: number;
  fumble_recoveries: number;
  def_tds: number;
  safeties: number;
  blocks: number;
  points_allowed: number | null;
  yards_allowed: number;
  games: number;
};

function emptyStats(): CanonicalStats {
  return {
    passing_yards: 0, passing_tds: 0, passing_ints: 0, passing_2pt: 0,
    rushing_yards: 0, rushing_tds: 0, rushing_2pt: 0,
    receptions: 0, receiving_yards: 0, receiving_tds: 0, receiving_2pt: 0,
    fumbles_lost: 0, return_tds: 0,
    fg_made_0_39: 0, fg_made_40_49: 0, fg_made_50_plus: 0, fg_missed: 0,
    xp_made: 0, xp_missed: 0,
    sacks: 0, def_interceptions: 0, fumble_recoveries: 0, def_tds: 0,
    safeties: 0, blocks: 0, points_allowed: null, yards_allowed: 0,
    games: 0,
  };
}

// Accumulate one week of raw Sleeper stats onto the running season totals.
// Returns the set of unknown keys encountered (for reporting).
function accumulateWeek(
  totals: CanonicalStats,
  rawStats: Record<string, number>,
  unknownKeys: Set<string>
): void {
  // Count games played (gp = 1 if player appeared this week)
  if ((rawStats.gp ?? 0) > 0) totals.games += 1;

  for (const [key, value] of Object.entries(rawStats)) {
    const canonical = SLEEPER_KEY_MAP[key];
    if (canonical) {
      // Accumulate into the matching column
      (totals as unknown as Record<string, number>)[canonical] =
        ((totals as unknown as Record<string, number>)[canonical] ?? 0) + value;
    } else if (!KNOWN_NON_SCORING_KEYS.has(key)) {
      unknownKeys.add(key);
    }
  }
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

    // ── Auth: require admin user ────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");
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
    const season: number = Number(body.season ?? 2025);
    const statType: string = body.stat_type ?? "regular_season";
    const provider: string = body.provider ?? "sleeper";

    if (provider !== "sleeper") {
      return new Response(
        JSON.stringify({ error: `Provider "${provider}" is not supported yet. Use "sleeper".` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const startedAt = new Date().toISOString();

    // ── Load sports_players indexed by provider_player_id ───────────────────
    // Fetch all sports_players with provider='sleeper' for ID matching.
    // DST players have provider_player_id like "dst_BUF" but Sleeper uses "TEAM_BUF".
    const { data: dbPlayers, error: playerLoadErr } = await supabaseAdmin
      .from("sports_players")
      .select("id, provider_player_id, position")
      .eq("provider", "sleeper");

    if (playerLoadErr) {
      throw new Error("Failed to load sports_players: " + playerLoadErr.message);
    }

    // Build lookup: sleeper_player_id → sports_player uuid
    // Individual players: provider_player_id = numeric string (e.g. "4984")
    // DST players: provider_player_id = "dst_BUF", Sleeper key = "TEAM_BUF"
    const playerMap: Record<string, string> = {};
    for (const p of dbPlayers ?? []) {
      playerMap[p.provider_player_id] = p.id;
      // Also register DST alias: "dst_BUF" → map under "TEAM_BUF"
      if (p.provider_player_id.startsWith("dst_")) {
        const abbr = p.provider_player_id.slice(4); // "dst_BUF" → "BUF"
        playerMap[`TEAM_${abbr}`] = p.id;
      }
    }

    // ── Fetch all 18 weeks from Sleeper and aggregate ───────────────────────
    // Accumulate per-player season totals across all weeks.
    const seasonTotals: Record<string, CanonicalStats> = {};   // sleeperPlayerId → totals
    const rawDataByPlayer: Record<string, Record<string, number>> = {}; // for raw_data column
    const unknownKeys = new Set<string>();
    const unmatchedIds = new Set<string>();
    let recordsFetched = 0;

    for (let week = 1; week <= NFL_REGULAR_SEASON_WEEKS; week++) {
      const url = SLEEPER_STATS_URL(season, week);
      const resp = await fetch(url);
      if (!resp.ok) {
        // Some weeks may not exist if season is incomplete — log and continue
        console.warn(`Week ${week} returned ${resp.status}, skipping`);
        continue;
      }
      const weekData: Record<string, Record<string, number>> = await resp.json();
      recordsFetched += Object.keys(weekData).length;

      for (const [sleeperPlayerId, rawStats] of Object.entries(weekData)) {
        if (!seasonTotals[sleeperPlayerId]) {
          seasonTotals[sleeperPlayerId] = emptyStats();
          rawDataByPlayer[sleeperPlayerId] = {};
        }
        accumulateWeek(seasonTotals[sleeperPlayerId], rawStats, unknownKeys);
        // Merge raw stats into per-player raw accumulator (last-week values overwrite,
        // but for raw_data we just want a sample of the keys that appeared)
        Object.assign(rawDataByPlayer[sleeperPlayerId], rawStats);
      }
    }

    // ── Upsert player_season_stats ──────────────────────────────────────────
    const upsertRows: Record<string, unknown>[] = [];

    for (const [sleeperPlayerId, totals] of Object.entries(seasonTotals)) {
      const sportsPlayerId = playerMap[sleeperPlayerId];
      if (!sportsPlayerId) {
        unmatchedIds.add(sleeperPlayerId);
        continue;
      }

      // xp_missed = xpa - xpm (Sleeper doesn't have a direct xp_missed stat)
      // We approximated: missed = total attempts - made. But since we only
      // accumulate mapped keys, xp_missed stays 0 unless we derive it.
      // Derive from raw: xpa (attempts) - xpm (made) across all weeks.
      // We'll leave xp_missed as 0 for now — raw_data preserves xpa for future use.

      upsertRows.push({
        sports_player_id: sportsPlayerId,
        provider: "sleeper",
        provider_player_id: sleeperPlayerId,
        season,
        stat_type: statType,
        games:            totals.games || null,
        passing_yards:    totals.passing_yards || null,
        passing_tds:      totals.passing_tds || null,
        passing_ints:     totals.passing_ints || null,
        passing_2pt:      totals.passing_2pt || null,
        rushing_yards:    totals.rushing_yards || null,
        rushing_tds:      totals.rushing_tds || null,
        rushing_2pt:      totals.rushing_2pt || null,
        receptions:       totals.receptions || null,
        receiving_yards:  totals.receiving_yards || null,
        receiving_tds:    totals.receiving_tds || null,
        receiving_2pt:    totals.receiving_2pt || null,
        fumbles_lost:     totals.fumbles_lost || null,
        return_tds:       totals.return_tds || null,
        fg_made_0_39:     totals.fg_made_0_39 || null,
        fg_made_40_49:    totals.fg_made_40_49 || null,
        fg_made_50_plus:  totals.fg_made_50_plus || null,
        fg_missed:        totals.fg_missed || null,
        xp_made:          totals.xp_made || null,
        xp_missed:        null,   // not directly available; derivable from raw_data.xpa - xpa_made
        sacks:            totals.sacks || null,
        def_interceptions: totals.def_interceptions || null,
        fumble_recoveries: totals.fumble_recoveries || null,
        def_tds:          totals.def_tds || null,
        safeties:         totals.safeties || null,
        blocks:           totals.blocks || null,
        points_allowed:   null,   // not available in Sleeper weekly bulk endpoint
        yards_allowed:    totals.yards_allowed || null,
        raw_data:         rawDataByPlayer[sleeperPlayerId],
        synced_at:        new Date().toISOString(),
        updated_at:       new Date().toISOString(),
      });
    }

    // Upsert in batches of 500
    const BATCH = 500;
    let recordsUpserted = 0;
    const upsertErrors: string[] = [];

    for (let i = 0; i < upsertRows.length; i += BATCH) {
      const batch = upsertRows.slice(i, i + BATCH);
      const { error: upsertErr } = await supabaseAdmin
        .from("player_season_stats")
        .upsert(batch, { onConflict: "sports_player_id,provider,season,stat_type" });
      if (upsertErr) {
        upsertErrors.push(`Batch ${i}-${i + batch.length}: ${upsertErr.message}`);
      } else {
        recordsUpserted += batch.length;
      }
    }

    const completedAt = new Date().toISOString();

    // Sample of unmatched IDs for reporting (cap at 50 to keep response small)
    const unmatchedSample = [...unmatchedIds]
      .filter((id) => !id.startsWith("TEAM_"))  // DST non-matches expected if no DST player in DB
      .slice(0, 50);

    return new Response(
      JSON.stringify({
        success: upsertErrors.length === 0,
        season,
        provider,
        stat_type: statType,
        records_fetched: recordsFetched,
        players_with_stats: Object.keys(seasonTotals).length,
        records_matched: upsertRows.length,
        records_upserted: recordsUpserted,
        unmatched_player_ids_count: unmatchedIds.size,
        unmatched_player_ids_sample: unmatchedSample,
        unknown_stat_keys: [...unknownKeys].sort(),
        upsert_errors: upsertErrors.length > 0 ? upsertErrors : null,
        started_at: startedAt,
        completed_at: completedAt,
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
