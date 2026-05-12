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
  flex: number; k: number; dst: number; bench: number;
}

interface PreviewTeam {
  externalTeamId: string;
  externalOwnerId?: string;
  externalOwnerName?: string;
  teamName: string;
}

interface PreviewResult {
  provider: string;
  externalLeagueId: string;
  displayName: string;
  numTeams: number;
  scoringType: string;
  rosterSettings: SleeperRosterSettings;
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
    return { qb: 1, rb: 2, wr: 2, te: 1, flex: 1, k: 1, dst: 1, bench: 6 };
  }
  const s = lineupSlotCounts as Record<string, unknown>;
  const n = (key: string) => Math.max(0, parseInt(String(s[key] ?? '0'), 10) || 0);
  return {
    qb: n('0'),
    rb: n('2'),
    wr: n('4'),
    te: n('6'),
    flex: n('23'),
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
    throw new Error(isPrivate
      ? 'ESPN returned a non-JSON response. Credentials may be expired.'
      : 'ESPN returned a non-JSON response. The league may be private.');
  }
  if (resp.status === 401 || resp.status === 403) {
    throw new Error(`ESPN denied access (HTTP ${resp.status}).`);
  }
  if (!resp.ok) {
    throw new Error(`ESPN API returned HTTP ${resp.status}.`);
  }

  const data = await resp.json() as Record<string, unknown>;
  const settings = data?.settings as Record<string, unknown> | undefined;
  const displayName = (settings?.name as string | undefined) ?? `ESPN League ${leagueId}`;

  const rosterSettingsRaw = (settings?.rosterSettings as Record<string, unknown> | undefined);
  const lineupSlotCounts = rosterSettingsRaw?.lineupSlotCounts;
  const rosterSettings = espnRosterSettings(lineupSlotCounts);

  const scoringSettings = (settings?.scoringSettings as unknown) ?? undefined;
  const scoringType = espnScoringType(scoringSettings);

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
