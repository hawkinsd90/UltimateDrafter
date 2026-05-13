// preview-external-league: fetch league metadata + team owner names without requiring a draft.
// Used by the Create League flow to pre-fill settings and capture member names.
// Never stores credentials. Never logs credential values.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface SleeperRosterSettings {
  qb: number; rb: number; wr: number; te: number;
  flex: number; op: number; k: number; dst: number; bench: number;
}

interface PreviewTeam {
  externalTeamId: string;
  externalOwnerId?: string;
  externalOwnerName?: string;
  teamName: string;
}

// Canonical stat key → points value map returned to client
type ScoringRules = Record<string, number>;

interface PreviewResult {
  provider: string;
  externalLeagueId: string;
  displayName: string;
  numTeams: number;
  scoringType: string;
  rosterSettings: SleeperRosterSettings;
  scoringRules: ScoringRules;
  teams: PreviewTeam[];
  warnings: string[];
}

// ── Sleeper helpers ──────────────────────────────────────────────────────────

function sleeperRosterSettings(rosterPositions: unknown): SleeperRosterSettings {
  const positions = Array.isArray(rosterPositions) ? rosterPositions as string[] : [];
  const count = (pos: string | string[]) => {
    const targets = Array.isArray(pos) ? pos : [pos];
    return positions.filter(p => targets.includes(p)).length;
  };
  return {
    qb: count('QB'),
    rb: count('RB'),
    wr: count('WR'),
    te: count('TE'),
    flex: count(['FLEX', 'RB/WR/TE', 'WR/RB', 'WR/TE', 'RB/WR']),
    op: count('SUPER_FLEX'),
    k: count('K'),
    dst: count(['DEF', 'DST']),
    bench: count('BN'),
  };
}

function sleeperScoringType(scoringSettings: unknown): string {
  if (typeof scoringSettings !== 'object' || scoringSettings === null) return 'standard';
  const s = scoringSettings as Record<string, unknown>;
  const rec = Number(s['rec'] ?? 0);
  if (rec >= 1) return 'ppr';
  if (rec >= 0.5) return 'half_ppr';
  return 'standard';
}

// Sleeper scoring_settings key → canonical stat_key map
const SLEEPER_STAT_MAP: Record<string, string> = {
  pass_yd: 'pass_yd', pass_td: 'pass_td', pass_int: 'pass_int',
  pass_2pt: 'pass_2pt', pass_cmp: 'pass_cmp', pass_inc: 'pass_inc',
  pass_sack: 'pass_sack', pass_fd: 'pass_fd',
  pass_300_yds: 'pass_300_yds', pass_400_yds: 'pass_400_yds',
  rush_yd: 'rush_yd', rush_td: 'rush_td', rush_2pt: 'rush_2pt',
  rush_fd: 'rush_fd', rush_100_yds: 'rush_100_yds', rush_200_yds: 'rush_200_yds',
  rec: 'rec', rec_yd: 'rec_yd', rec_td: 'rec_td', rec_2pt: 'rec_2pt',
  rec_fd: 'rec_fd', rec_100_yds: 'rec_100_yds', rec_200_yds: 'rec_200_yds',
  rec_tgt: 'rec_tgt',
  fum: 'fum', fum_lost: 'fum_lost',
  xpm: 'xpm', xpmiss: 'xpmiss',
  fg_0_19: 'fg_0_19', fg_20_29: 'fg_20_29', fg_30_39: 'fg_30_39',
  fg_40_49: 'fg_40_49', fg_50_59: 'fg_50_59', fg_60p: 'fg_60p',
  fgmiss: 'fgmiss', fgmiss_40_49: 'fgmiss_40_49', fgmiss_50p: 'fgmiss_50p',
  def_st_td: 'def_st_td', def_int: 'def_int', def_fum_rec: 'def_fum_rec',
  def_sack: 'def_sack', def_safe: 'def_safe', def_blk_kick: 'def_blk_kick',
  def_td: 'def_td', def_st_ff: 'def_st_ff', def_st_fum_rec: 'def_st_fum_rec',
  def_pr_td: 'def_pr_td', def_kr_td: 'def_kr_td',
  pts_allow_0: 'dst_pa0', pts_allow_1_6: 'dst_pa1', pts_allow_7_13: 'dst_pa7',
  pts_allow_14_20: 'dst_pa14', pts_allow_21_27: 'dst_pa21',
  pts_allow_28_34: 'dst_pa28', pts_allow_35p: 'dst_pa35',
  yds_allow_0_100: 'dst_ya100', yds_allow_100_199: 'dst_ya199',
  yds_allow_200_299: 'dst_ya299', yds_allow_300_349: 'dst_ya349',
  yds_allow_350_399: 'dst_ya399', yds_allow_400_449: 'dst_ya449',
  yds_allow_450_499: 'dst_ya499', yds_allow_500_549: 'dst_ya549',
  yds_allow_550p: 'dst_ya550',
};

function sleeperScoringRules(scoringSettings: unknown): ScoringRules {
  if (typeof scoringSettings !== 'object' || scoringSettings === null) return {};
  const s = scoringSettings as Record<string, unknown>;
  const rules: ScoringRules = {};
  for (const [key, val] of Object.entries(s)) {
    const pts = typeof val === 'number' ? val : Number(val);
    if (!isNaN(pts) && pts !== 0) {
      const canonical = SLEEPER_STAT_MAP[key] ?? key;
      rules[canonical] = pts;
    }
  }
  return rules;
}

// ESPN statId → canonical stat_key. Source: cwendt94/espn-api SETTINGS_SCORING_FORMAT_MAP + PLAYER_STATS_MAP.
// statId 3=passingYards, 4=passingTD, 19=2ptPassConv, 20=INT, etc.
// statId 53 is "Each reception" (the one ESPN counts for PPR scoring).
const ESPN_STAT_ID_MAP: Record<number, string> = {
  // Passing
  0: 'pass_att', 1: 'pass_cmp', 2: 'pass_inc',
  3: 'pass_yd', 4: 'pass_td', 15: 'pass_td40', 16: 'pass_td50',
  17: 'pass_300_yds', 18: 'pass_400_yds', 19: 'pass_2pt', 20: 'pass_int',
  64: 'pass_sack', 211: 'pass_fd',
  // Rushing
  23: 'rush_att', 24: 'rush_yd', 25: 'rush_td', 26: 'rush_2pt',
  35: 'rush_td40', 36: 'rush_td50',
  37: 'rush_100_yds', 38: 'rush_200_yds', 212: 'rush_fd',
  // Receiving
  41: 'rec_legacy', 42: 'rec_yd', 43: 'rec_td', 44: 'rec_2pt',
  45: 'rec_td40', 46: 'rec_td50',
  53: 'rec', 56: 'rec_100_yds', 57: 'rec_200_yds', 58: 'rec_tgt',
  213: 'rec_fd',
  // Fumbles
  63: 'fum_td', 68: 'fum', 72: 'fum_lost',
  // Kicking
  74: 'fg_50_59', 76: 'fgmiss_50p',       // 50-59 yd range (statId 74 = FG50)
  77: 'fg_40_49', 79: 'fgmiss_40_49',
  80: 'fg_0_39', 82: 'fgmiss_0_39',
  83: 'fg_total', 84: 'fga_total', 85: 'fgmiss',
  86: 'xpm', 87: 'xpa', 88: 'xpmiss',
  198: 'fg_50_59', 199: 'fga_50_59', 200: 'fgmiss_50_59',  // ESPN also uses 198 for FG50
  201: 'fg_60p', 202: 'fga_60p', 203: 'fgmiss_60p',
  // Defensive / ST
  89: 'dst_pa0', 90: 'dst_pa1', 91: 'dst_pa7', 92: 'dst_pa14',
  93: 'def_blk_kick_td', 94: 'def_td', 95: 'def_int', 96: 'def_fum_rec',
  97: 'def_blk_kick', 98: 'def_safe', 99: 'def_sack',
  101: 'def_kr_td', 102: 'def_pr_td', 103: 'def_int_td', 104: 'def_fum_td',
  106: 'def_ff', 113: 'def_pd',
  121: 'dst_pa18', 122: 'dst_pa22', 123: 'dst_pa28', 124: 'dst_pa35', 125: 'dst_pa46',
  128: 'dst_ya100', 129: 'dst_ya199', 130: 'dst_ya299', 131: 'dst_ya349',
  132: 'dst_ya399', 133: 'dst_ya449', 134: 'dst_ya499', 135: 'dst_ya549', 136: 'dst_ya550',
  205: 'two_pt_ret', 206: 'two_pt_ret',
  209: 'one_pt_sf',
};

function espnScoringRules(scoringSettings: unknown): ScoringRules {
  const rules: ScoringRules = {};
  if (typeof scoringSettings !== 'object' || scoringSettings === null) return rules;

  const s = scoringSettings as Record<string, unknown>;
  const items = Array.isArray(s.scoringItems) ? s.scoringItems as unknown[] : [];

  for (const item of items) {
    if (typeof item !== 'object' || item === null) continue;
    const si = item as Record<string, unknown>;
    const statId = Number(si.statId);
    if (isNaN(statId)) continue;

    // ESPN stores per-position overrides in pointsOverrides keyed by slot id (string).
    // Slot "16" means "all positions" (the global override). Fall back to base `points`.
    const overrides = typeof si.pointsOverrides === 'object' && si.pointsOverrides !== null
      ? si.pointsOverrides as Record<string, unknown>
      : {};
    const overrideVal = overrides['16'];
    const pts = overrideVal !== undefined
      ? Number(overrideVal)
      : Number(si.points ?? 0);

    if (isNaN(pts) || pts === 0) continue;

    const key = ESPN_STAT_ID_MAP[statId];
    if (key) rules[key] = pts;
  }
  return rules;
}

async function previewSleeper(leagueId: string): Promise<PreviewResult> {
  const SLEEPER = 'https://api.sleeper.app/v1';
  const [leagueResp, rostersResp, usersResp] = await Promise.all([
    fetch(`${SLEEPER}/league/${leagueId}`),
    fetch(`${SLEEPER}/league/${leagueId}/rosters`),
    fetch(`${SLEEPER}/league/${leagueId}/users`),
  ]);

  if (!leagueResp.ok) {
    if (leagueResp.status === 404) throw new Error(`Sleeper league "${leagueId}" not found.`);
    throw new Error(`Sleeper API returned HTTP ${leagueResp.status}.`);
  }

  const [leagueData, rostersData, usersData] = await Promise.all([
    leagueResp.json(),
    rostersResp.ok ? rostersResp.json() : Promise.resolve([]),
    usersResp.ok ? usersResp.json() : Promise.resolve([]),
  ]) as [Record<string, unknown>, unknown[], unknown[]];

  const displayName = (leagueData?.name as string | undefined) ?? `Sleeper League ${leagueId}`;
  const rosterSettings = sleeperRosterSettings(leagueData?.roster_positions);
  const scoringType = sleeperScoringType(leagueData?.scoring_settings);
  const scoringRules = sleeperScoringRules(leagueData?.scoring_settings);

  // Build user map
  const userMap = new Map<string, { displayName: string; teamName?: string }>();
  for (const u of (Array.isArray(usersData) ? usersData : [])) {
    if (typeof u !== 'object' || u === null) continue;
    const user = u as Record<string, unknown>;
    const uid = user?.user_id as string | undefined;
    if (!uid) continue;
    const dn = (user?.display_name as string | undefined) ?? (user?.username as string | undefined) ?? uid;
    const meta = user?.metadata as Record<string, unknown> | undefined;
    const teamName = meta?.team_name as string | undefined;
    userMap.set(uid, { displayName: dn, teamName });
  }

  const teams: PreviewTeam[] = [];
  for (const r of (Array.isArray(rostersData) ? rostersData : [])) {
    if (typeof r !== 'object' || r === null) continue;
    const roster = r as Record<string, unknown>;
    const rosterId = roster?.roster_id != null ? String(roster.roster_id) : undefined;
    if (!rosterId) continue;
    const ownerId = roster?.owner_id as string | undefined;
    const ownerInfo = ownerId ? userMap.get(ownerId) : undefined;
    const teamName = ownerInfo?.teamName || ownerInfo?.displayName || `Team ${rosterId}`;
    teams.push({
      externalTeamId: rosterId,
      externalOwnerId: ownerId,
      externalOwnerName: ownerInfo?.displayName,
      teamName,
    });
  }

  return {
    provider: 'sleeper',
    externalLeagueId: leagueId,
    displayName,
    numTeams: teams.length,
    scoringType,
    rosterSettings,
    scoringRules,
    teams,
    warnings: [],
  };
}

// ── ESPN helpers ─────────────────────────────────────────────────────────────

function espnPositionMap(): Record<number, string> {
  return { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DST' };
}

function espnRosterSettings(lineupSlotCounts: unknown): SleeperRosterSettings {
  if (typeof lineupSlotCounts !== 'object' || lineupSlotCounts === null) {
    return { qb: 1, rb: 2, wr: 2, te: 1, flex: 1, op: 0, k: 1, dst: 1, bench: 6 };
  }
  const s = lineupSlotCounts as Record<string, unknown>;
  const n = (key: string) => Math.max(0, parseInt(String(s[key] ?? '0'), 10) || 0);
  return {
    qb: n('0'),
    rb: n('2'),
    wr: n('4'),
    te: n('6'),
    flex: n('23'),
    op: n('7'),
    k: n('17'),
    dst: n('16'),
    bench: n('20'),
  };
}

function espnScoringType(scoringSettings: unknown): string {
  const items = Array.isArray(scoringSettings)
    ? scoringSettings
    : (typeof scoringSettings === 'object' && scoringSettings !== null
        ? ((scoringSettings as Record<string, unknown>).scoringItems as unknown[] | undefined ?? [])
        : []);
  for (const item of items) {
    if (typeof item !== 'object' || item === null) continue;
    const si = item as Record<string, unknown>;
    const statId = si?.statId ?? si?.stat_id;
    const ppm = Number(si?.pointsPerUnit ?? si?.points_per_unit ?? 0);
    if (statId === 53 || statId === '53') { // receptions
      if (ppm >= 1) return 'ppr';
      if (ppm >= 0.5) return 'half_ppr';
    }
  }
  return 'standard';
}

async function previewEspn(
  leagueId: string, season: number,
  isPrivate: boolean, swid?: string, espnS2?: string
): Promise<PreviewResult> {
  const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${leagueId}?view=mTeam&view=mSettings`;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': 'UltimateDrafter/1.0',
  };
  if (isPrivate && swid && espnS2) {
    headers['Cookie'] = `SWID=${swid}; espn_s2=${espnS2}`;
  }

  const resp = await fetch(url, { headers });
  const ct = resp.headers.get('content-type') ?? '';
  if (!ct.includes('application/json')) {
    if (resp.status === 404) {
      throw new Error(`ESPN league ${leagueId} not found for season ${season}. Check the league ID and season year.`);
    }
    if (isPrivate) {
      throw new Error('ESPN returned a non-JSON response. Your SWID/espn_s2 credentials may be expired or incorrect.');
    }
    throw new Error(`ESPN returned a non-JSON response for league ${leagueId} (season ${season}). The league may be private, or this season may not exist yet.`);
  }
  if (resp.status === 401 || resp.status === 403) {
    throw new Error(`ESPN denied access to league ${leagueId} (HTTP ${resp.status}). The league may be private — try enabling the private league option with your SWID and espn_s2 cookies.`);
  }
  if (!resp.ok) {
    throw new Error(`ESPN API returned HTTP ${resp.status} for league ${leagueId} season ${season}.`);
  }

  const data = await resp.json() as Record<string, unknown>;
  const settings = data?.settings as Record<string, unknown> | undefined;
  const displayName = (settings?.name as string | undefined) ?? `ESPN League ${leagueId}`;

  const rosterSettingsRaw = (settings?.rosterSettings as Record<string, unknown> | undefined);
  const lineupSlotCounts = rosterSettingsRaw?.lineupSlotCounts;
  const rosterSettings = espnRosterSettings(lineupSlotCounts);

  const scoringSettings = (settings?.scoringSettings as unknown) ?? undefined;
  const scoringType = espnScoringType(scoringSettings);
  const scoringRules = espnScoringRules(scoringSettings);

  // Member map
  const membersRaw = Array.isArray(data?.members) ? data.members as unknown[] : [];
  const memberMap = new Map<string, string>();
  for (const m of membersRaw) {
    if (typeof m !== 'object' || m === null) continue;
    const member = m as Record<string, unknown>;
    const mid = member?.id as string | undefined;
    const dn = (member?.displayName as string | undefined)
      ?? (member?.firstName && member?.lastName ? `${member.firstName} ${member.lastName}` : undefined)
      ?? (member?.firstName as string | undefined);
    if (mid && dn) memberMap.set(mid, dn);
  }

  const teamsRaw = Array.isArray(data?.teams) ? data.teams as unknown[] : [];
  const teams: PreviewTeam[] = [];
  for (const t of teamsRaw) {
    if (typeof t !== 'object' || t === null) continue;
    const team = t as Record<string, unknown>;
    const teamId = team?.id != null ? String(team.id) : undefined;
    if (!teamId) continue;
    const loc = (team?.location as string | undefined)?.trim() ?? '';
    const nick = (team?.nickname as string | undefined)?.trim() ?? '';
    const abbrev = (team?.abbrev as string | undefined)?.trim() ?? '';
    const teamName = loc && nick ? `${loc} ${nick}` : loc || nick || abbrev || `Team ${teamId}`;
    const ownersArr = Array.isArray(team?.owners) ? team.owners as unknown[] : [];
    const primaryOwnerId = ownersArr.length > 0 && typeof ownersArr[0] === 'string' ? ownersArr[0] as string : undefined;
    const ownerName = primaryOwnerId ? memberMap.get(primaryOwnerId) : undefined;
    teams.push({
      externalTeamId: teamId,
      externalOwnerId: primaryOwnerId,
      externalOwnerName: ownerName,
      teamName,
    });
  }

  return {
    provider: 'espn',
    externalLeagueId: leagueId,
    displayName,
    numTeams: teams.length,
    scoringType,
    rosterSettings,
    scoringRules,
    teams,
    warnings: [],
  };
}

// ── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const body = await req.json() as Record<string, unknown>;
    const provider = body?.provider as string | undefined;
    const leagueId = (body?.leagueId as string | undefined)?.trim();
    const season = Number(body?.season ?? new Date().getFullYear());

    if (!provider || !leagueId) {
      return new Response(JSON.stringify({ error: 'provider and leagueId are required.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let result: PreviewResult;

    if (provider === 'sleeper') {
      result = await previewSleeper(leagueId);
    } else if (provider === 'espn') {
      const isPrivate = body?.isPrivate === true;
      // Credentials used only for outbound fetch — never logged, never stored
      const swid = isPrivate ? (body?.swid as string | undefined) : undefined;
      const espnS2 = isPrivate ? (body?.espnS2 as string | undefined) : undefined;
      result = await previewEspn(leagueId, season, isPrivate, swid, espnS2);
    } else {
      return new Response(JSON.stringify({ error: `Unknown provider: ${provider}` }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true, ...result }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Preview failed.';
    return new Response(JSON.stringify({ error: msg }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
