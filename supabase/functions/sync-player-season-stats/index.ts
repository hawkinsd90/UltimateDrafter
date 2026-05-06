import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// Sleeper bulk weekly stats — returns {player_id: {stat_key: float}}
// DST teams keyed as "TEAM_BUF" etc. Zero-value stats are omitted.
const SLEEPER_STATS_URL = (season: number, week: number) =>
  `https://api.sleeper.app/v1/stats/nfl/regular/${season}/${week}`;

const NFL_REGULAR_SEASON_WEEKS = 18;

// Sleeper stat key → canonical column name.
// All keys present here are removed from KNOWN_NON_SCORING_KEYS to keep the
// two sets mutually exclusive.
const SLEEPER_KEY_MAP: Record<string, string> = {
  // Passing
  pass_yd:       "passing_yards",
  pass_td:       "passing_tds",
  pass_int:      "passing_ints",
  pass_2pt:      "passing_2pt",
  // Rushing
  rush_yd:       "rushing_yards",
  rush_td:       "rushing_tds",
  rush_2pt:      "rushing_2pt",
  // Receiving
  rec:           "receptions",
  rec_yd:        "receiving_yards",
  rec_td:        "receiving_tds",
  rec_2pt:       "receiving_2pt",
  // Misc offense
  fum_lost:      "fumbles_lost",
  st_td:         "return_tds",      // individual ST/return TD
  kr_td:         "return_tds",      // kick return TD (individual)
  pr_td:         "return_tds",      // punt return TD (individual)
  misc_td:       "return_tds",      // other return TD
  // Kicking — Sleeper brackets: 0_19, 20_29, 30_39, 40_49, 50_59, 60p
  // Schema bucket fg_made_0_39 = 0–39 yards made
  fgm_0_19:      "fg_made_0_39",
  fgm_20_29:     "fg_made_0_39",
  fgm_30_39:     "fg_made_0_39",
  fgm_40_49:     "fg_made_40_49",
  fgm_50_59:     "fg_made_50_plus",
  fgm_60p:       "fg_made_50_plus",
  fgm_50p:       "fg_made_50_plus",  // alternate 50+ combined bucket
  fgmiss:        "fg_missed",
  xpm:           "xp_made",
  xpmiss:        "xp_missed",        // Sleeper key is "xpmiss" (not "xp_missed")
  // DST
  sack:          "sacks",
  int:           "def_interceptions",
  fum_rec:       "fumble_recoveries",
  def_td:        "def_tds",
  def_st_td:     "def_tds",          // DST special teams TD
  fum_rec_td:    "def_tds",          // fumble recovery TD
  safe:          "safeties",
  blk_kick:      "blocks",
  // DST points allowed — Sleeper provides the total directly as "pts_allow"
  // and also as tiered keys. Accumulate "pts_allow" into points_allowed.
  // The tiered keys (pts_allow_0 etc.) are already summed into pts_allow,
  // so we map only the aggregate to avoid double-counting.
  pts_allow:     "points_allowed",
  // DST yards allowed — same pattern: "yds_allow" is the aggregate total
  yds_allow:     "yards_allowed",
  // Remove opp_off_yd — was a fallback; Sleeper has the real keys above
};

// Keys present in every entry that carry no direct fantasy scoring value.
// Must NOT overlap with SLEEPER_KEY_MAP keys.
const KNOWN_NON_SCORING_KEYS = new Set([
  "gp", "gs", "gms_active", "off_snp", "tm_off_snp", "tm_def_snp", "tm_st_snp",
  "pts_ppr", "pts_half_ppr", "pts_std",
  "pos_rank_ppr", "pos_rank_half_ppr", "pos_rank_std",
  "rank_ppr", "rank_half_ppr", "rank_std",
  // Passing volume / efficiency (not scoring)
  "pass_att", "pass_cmp", "pass_inc", "pass_cmp_40p",
  "pass_air_yd", "pass_fd", "pass_lng", "pass_rtg", "pass_rush_yd",
  "pass_rz_att", "pass_sack", "pass_sack_yds", "pass_td_lng", "pass_td_40p", "pass_td_50p",
  "pass_ypa", "pass_ypc",
  // Rushing volume / efficiency
  "rush_att", "rush_fd", "rush_lng", "rush_rz_att", "rush_td_lng",
  "rush_tkl_loss", "rush_tkl_loss_yd", "rush_yac", "rush_ypa", "rush_btkl",
  "rush_rec_yd", "rush_ypc", "rush_40p", "rush_td_40p", "rush_td_50p",
  // Receiving volume / efficiency
  "rec_tgt", "rec_fd", "rec_lng", "rec_yar", "rec_air_yd", "rec_ypr", "rec_ypt",
  "rec_drop", "rec_rz_tgt", "rec_0_4", "rec_5_9", "rec_10_19", "rec_20_29",
  "rec_30_39", "rec_40p", "rec_td_40p", "rec_td_50p", "rec_td_lng",
  // Kicker volume / efficiency
  "fga", "fgm", "fgm_lng", "fgm_pct", "fgm_yds", "fgm_yds_over_30",
  "fgmiss_20_29", "fgmiss_30_39", "fgmiss_40_49", "fgmiss_50_59", "fgmiss_60p", "fgmiss_50p",
  "kick_pts", "xpa", "xp_blkd", "fg_blkd", "fg_ret_yd",
  // Bonus / milestone stats (threshold-based; not per-unit scoring columns)
  "cmp_pct", "anytime_tds", "first_td",
  "bonus_fd_qb", "bonus_fd_rb", "bonus_fd_te", "bonus_fd_wr",
  "bonus_pass_cmp_25", "bonus_pass_yd_300", "bonus_pass_yd_400",
  "bonus_rush_att_20", "bonus_rush_yd_100", "bonus_rush_yd_150", "bonus_rush_yd_200",
  "bonus_rec_rb", "bonus_rec_te", "bonus_rec_wr",
  "bonus_rec_yd_100", "bonus_rec_yd_200",
  "bonus_rush_rec_yd_100", "bonus_rush_rec_yd_200",
  "bonus_sack_2p", "bonus_tkl_10p",
  "bonus_def_fum_td_50p", "bonus_def_int_td_50p",
  // IDP (individual defensive player — not DST fantasy)
  "idp_tkl", "idp_tkl_solo", "idp_tkl_ast", "idp_tkl_loss",
  "idp_int", "idp_int_ret_yd", "idp_sack", "idp_sack_yd",
  "idp_ff", "idp_fum_rec", "idp_fum_ret_yd",
  "idp_pass_def", "idp_pass_def_3p", "idp_qb_hit",
  "idp_blk_kick", "idp_def_td", "idp_safe",
  "pts_idp",
  // Penalties
  "penalty", "penalty_yd",
  // DST / team-level non-scoring counts and efficiency
  "td", "sack_yd", "tkl", "tkl_loss", "tkl_loss_yd", "tkl_solo", "tkl_ast",
  "tkl_solo_misc", "tkl_ast_misc",
  "qb_hit", "ff", "ff_misc", "fum", "int_ret_yd",
  "st_tkl_solo", "st_ff", "st_fum_rec", "st_snp",
  "def_st_ff", "def_st_fum_rec", "def_st_tkl_solo",
  "def_snp", "def_pass_def", "def_2pt",
  "def_3_and_out", "def_4_and_stop", "def_forced_punts",
  "def_kr", "def_kr_lng", "def_kr_yd", "def_kr_ypa",
  "def_pr", "def_pr_lng", "def_pr_yd", "def_pr_ypa",
  "kr", "kr_yd", "kr_lng", "kr_ypa",
  "pr", "pr_yd", "pr_lng", "pr_ypa",
  "misc_ret_yd", "fum_ret_yd",
  // DST returns and blocked kicks (non-TD outcomes)
  "blk_kick_ret_td", "blk_kick_ret_yd",  // blocked kick returned for TD — covered by def_tds
  "blk_pr_td",                            // blocked punt returned for TD — covered by def_tds
  "punt_blkd", "fg_blkd",                // blocked counts (not yardage/TD)
  // Punter stats
  "punt_in_20", "punt_net_yd", "punt_tb", "punt_yds",
  // DST tiered pts_allow brackets — we use "pts_allow" aggregate instead
  "pts_allow_0", "pts_allow_1_6", "pts_allow_7_13",
  "pts_allow_14_20", "pts_allow_21_27", "pts_allow_28_34", "pts_allow_35p",
  // DST tiered yds_allow brackets — we use "yds_allow" aggregate instead
  "yds_allow_0_100", "yds_allow_100_199", "yds_allow_200_299",
  "yds_allow_300_349", "yds_allow_350_399", "yds_allow_400_449",
  "yds_allow_450_499", "yds_allow_500_549", "yds_allow_550p",
  // opp_off_yd was our previous fallback for yards_allowed — no longer needed
  "opp_off_yd",
  // Team-level offensive duplicates (appear on TEAM_ entries, already mapped individually)
  "opp_fd", "opp_pass_fd", "opp_rush_fd", "opp_off_yd_per_play",
  "off_yd", "off_yd_per_play", "fd", "rz_att", "rz_conv", "rz_pct",
  "g2g_att", "g2g_conv", "g2g_pct", "down_3_att", "down_3_conv", "down_3_pct",
  "down_4_att", "down_4_conv", "down_4_pct", "punts",
  // Pre-calculated fantasy DST points by position — not raw stats
  "fan_pts_allow", "fan_pts_allow_def", "fan_pts_allow_k",
  "fan_pts_allow_qb", "fan_pts_allow_rb", "fan_pts_allow_te", "fan_pts_allow_wr",
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
  points_allowed: number;
  yards_allowed: number;
  games: number;
};

function emptyStats(): CanonicalStats {
  return {
    passing_yards: 0, passing_tds: 0, passing_ints: 0, passing_2pt: 0,
    rushing_yards: 0, rushing_tds: 0, rushing_2pt: 0,
    receptions: 0, receiving_yards: 0, receiving_tds: 0, receiving_2pt: 0,
    fumbles_lost: 0, return_tds: 0,
    fg_made_0_39: 0, fg_made_40_49: 0, fg_made_50_plus: 0,
    fg_missed: 0, xp_made: 0, xp_missed: 0,
    sacks: 0, def_interceptions: 0, fumble_recoveries: 0, def_tds: 0,
    safeties: 0, blocks: 0, points_allowed: 0, yards_allowed: 0,
    games: 0,
  };
}

function accumulateWeek(
  totals: CanonicalStats,
  rawStats: Record<string, number>,
  unknownKeys: Set<string>
): void {
  if ((rawStats.gp ?? 0) > 0) totals.games += 1;

  for (const [key, value] of Object.entries(rawStats)) {
    const canonical = SLEEPER_KEY_MAP[key];
    if (canonical) {
      (totals as unknown as Record<string, number>)[canonical] =
        ((totals as unknown as Record<string, number>)[canonical] ?? 0) + value;
    } else if (!KNOWN_NON_SCORING_KEYS.has(key)) {
      unknownKeys.add(key);
    }
  }
}

// Load all sports_players for provider in pages to avoid the default 1000-row limit.
async function loadAllPlayers(
  supabaseAdmin: ReturnType<typeof createClient>,
  provider: string
): Promise<{ id: string; provider_player_id: string }[]> {
  const PAGE = 1000;
  const all: { id: string; provider_player_id: string }[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabaseAdmin
      .from("sports_players")
      .select("id, provider_player_id")
      .eq("provider", provider)
      .range(offset, offset + PAGE - 1);

    if (error) throw new Error("Failed to load sports_players page: " + error.message);
    if (!data || data.length === 0) break;

    all.push(...data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }

  return all;
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

    // ── Load ALL sports_players (paginated — avoids 1000-row default limit) ─
    const dbPlayers = await loadAllPlayers(supabaseAdmin, "sleeper");

    // Build lookup: sleeper_player_id → sports_player uuid
    // Individual: provider_player_id = numeric string (e.g. "4984")
    // DST: provider_player_id = "dst_BUF" → also register under "TEAM_BUF"
    const playerMap: Record<string, string> = {};
    for (const p of dbPlayers) {
      playerMap[p.provider_player_id] = p.id;
      if (p.provider_player_id.startsWith("dst_")) {
        const abbr = p.provider_player_id.slice(4);
        playerMap[`TEAM_${abbr}`] = p.id;
      }
    }

    // ── Fetch all 18 weeks and accumulate season totals ─────────────────────
    const seasonTotals: Record<string, CanonicalStats> = {};
    const rawDataByPlayer: Record<string, Record<string, number>> = {};
    const unknownKeys = new Set<string>();
    const unmatchedIds = new Set<string>();
    let recordsFetched = 0;

    for (let week = 1; week <= NFL_REGULAR_SEASON_WEEKS; week++) {
      const url = SLEEPER_STATS_URL(season, week);
      const resp = await fetch(url);
      if (!resp.ok) {
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

      upsertRows.push({
        sports_player_id:  sportsPlayerId,
        provider:          "sleeper",
        provider_player_id: sleeperPlayerId,
        season,
        stat_type:         statType,
        games:             totals.games || null,
        passing_yards:     totals.passing_yards || null,
        passing_tds:       totals.passing_tds || null,
        passing_ints:      totals.passing_ints || null,
        passing_2pt:       totals.passing_2pt || null,
        rushing_yards:     totals.rushing_yards || null,
        rushing_tds:       totals.rushing_tds || null,
        rushing_2pt:       totals.rushing_2pt || null,
        receptions:        totals.receptions || null,
        receiving_yards:   totals.receiving_yards || null,
        receiving_tds:     totals.receiving_tds || null,
        receiving_2pt:     totals.receiving_2pt || null,
        fumbles_lost:      totals.fumbles_lost || null,
        return_tds:        totals.return_tds || null,
        fg_made_0_39:      totals.fg_made_0_39 || null,
        fg_made_40_49:     totals.fg_made_40_49 || null,
        fg_made_50_plus:   totals.fg_made_50_plus || null,
        fg_missed:         totals.fg_missed || null,
        xp_made:           totals.xp_made || null,
        xp_missed:         totals.xp_missed || null,   // now derived from xpmiss key
        sacks:             totals.sacks || null,
        def_interceptions: totals.def_interceptions || null,
        fumble_recoveries: totals.fumble_recoveries || null,
        def_tds:           totals.def_tds || null,
        safeties:          totals.safeties || null,
        blocks:            totals.blocks || null,
        points_allowed:    totals.points_allowed || null,
        yards_allowed:     totals.yards_allowed || null,
        raw_data:          rawDataByPlayer[sleeperPlayerId],
        synced_at:         new Date().toISOString(),
        updated_at:        new Date().toISOString(),
      });
    }

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

    // Exclude TEAM_ unmatched (expected if Sleeper returns teams not in our DB)
    const unmatchedNonTeam = [...unmatchedIds].filter((id) => !id.startsWith("TEAM_"));

    return new Response(
      JSON.stringify({
        success:                     upsertErrors.length === 0,
        season,
        provider,
        stat_type:                   statType,
        players_loaded_from_db:      dbPlayers.length,
        records_fetched:             recordsFetched,
        players_with_stats:          Object.keys(seasonTotals).length,
        records_matched:             upsertRows.length,
        records_upserted:            recordsUpserted,
        unmatched_player_ids_count:  unmatchedIds.size,
        unmatched_non_team_count:    unmatchedNonTeam.length,
        unmatched_player_ids_sample: unmatchedNonTeam.slice(0, 20),
        unknown_stat_keys:           [...unknownKeys].sort(),
        upsert_errors:               upsertErrors.length > 0 ? upsertErrors : null,
        started_at:                  startedAt,
        completed_at:                completedAt,
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
