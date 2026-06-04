import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface RequestBody {
  provider: "espn" | "sleeper";
  leagueId: string;
  season: number;
  isPrivate?: boolean;
  swid?: string;
  espnS2?: string;
}

interface TeamStanding {
  externalTeamId: string;
  teamName: string;
  externalOwnerId: string | null;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  playoffSeed: number | null;  // null = did not make playoffs; 1 = champion
  madePlayoffs: boolean;
  finalStanding: number | null; // final rank (1=champion, 2=runner-up, etc.) if made playoffs
}

// ── ESPN ────────────────────────────────────────────────────────────────────

async function fetchEspnStandings(body: RequestBody): Promise<TeamStanding[]> {
  const { leagueId, season, isPrivate, swid, espnS2 } = body;

  const views = ["mTeam", "mSettings", "mStatus"];
  const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${leagueId}?${views.map(v => `view=${v}`).join("&")}`;

  const headers: Record<string, string> = {
    "Accept": "application/json",
    "User-Agent": "Mozilla/5.0",
  };
  if (isPrivate && swid && espnS2) {
    headers["Cookie"] = `SWID=${swid}; espn_s2=${espnS2}`;
  }

  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`ESPN API error: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();

  const teams: TeamStanding[] = [];

  const settings = data.settings ?? {};
  const scheduleSettings = settings.scheduleSettings ?? {};
  const playoffTeamCount: number = scheduleSettings.playoffTeamCount ?? 4;

  for (const team of (data.teams ?? [])) {
    const record = team.record?.overall ?? {};
    const wins   = record.wins   ?? 0;
    const losses = record.losses ?? 0;
    const ties   = record.ties   ?? 0;
    const pointsFor = record.pointsFor ?? 0;

    // ESPN uses playoffSeed (1-based) — teams with a seed made the playoffs
    // playoffSeed 0 or undefined = did not make playoffs
    const rawSeed: number = team.playoffSeed ?? 0;
    const madePlayoffs = rawSeed > 0 && rawSeed <= playoffTeamCount;

    // rankCalculatedFinal gives the final finish (1=champion)
    const finalStanding: number | null = team.rankCalculatedFinal ?? null;

    const teamName = `${team.location ?? ""} ${team.nickname ?? ""}`.trim() || team.abbrev || `Team ${team.id}`;
    const ownerId  = (team.owners ?? [])[0] ?? null;

    teams.push({
      externalTeamId: String(team.id),
      teamName,
      externalOwnerId: ownerId,
      wins,
      losses,
      ties,
      pointsFor,
      playoffSeed: rawSeed > 0 ? rawSeed : null,
      madePlayoffs,
      finalStanding,
    });
  }

  return teams;
}

// ── Sleeper ─────────────────────────────────────────────────────────────────

async function fetchSleeperStandings(body: RequestBody): Promise<TeamStanding[]> {
  const { leagueId } = body;

  const [rostersRes, usersRes, bracketRes] = await Promise.all([
    fetch(`https://api.sleeper.app/v1/league/${leagueId}/rosters`),
    fetch(`https://api.sleeper.app/v1/league/${leagueId}/users`),
    fetch(`https://api.sleeper.app/v1/league/${leagueId}/winners_bracket`),
  ]);

  if (!rostersRes.ok) throw new Error(`Sleeper roster API error: ${rostersRes.status}`);

  const rosters = await rostersRes.json();
  const users   = usersRes.ok ? await usersRes.json() : [];
  const bracket = bracketRes.ok ? await bracketRes.json() : [];

  // Build user map
  const userMap = new Map<string, { display_name: string }>();
  for (const u of (users ?? [])) {
    userMap.set(u.user_id, { display_name: u.display_name ?? u.username ?? `User ${u.user_id}` });
  }

  // Determine playoff participants from bracket
  // Each bracket match has t1, t2 (roster_ids) and w (winner roster_id)
  const playoffRosterIds = new Set<number>();
  const winnerById = new Map<number, number>(); // match_id -> winner roster_id
  for (const match of (bracket ?? [])) {
    if (match.t1) playoffRosterIds.add(match.t1);
    if (match.t2) playoffRosterIds.add(match.t2);
    if (match.w)  winnerById.set(match.m, match.w);
  }

  // Final standings from bracket — round 1 = championship round
  // We look for the highest round to find champion
  const maxRound = bracket.reduce((max: number, m: { r?: number }) => Math.max(max, m.r ?? 0), 0);
  const championshipMatches = bracket.filter((m: { r?: number }) => m.r === maxRound);
  const champion = championshipMatches.length > 0 ? winnerById.get(championshipMatches[0].m) : null;

  const teams: TeamStanding[] = [];

  for (const roster of (rosters ?? [])) {
    const rosterId: number = roster.roster_id;
    const userId: string   = roster.owner_id ?? null;
    const settings         = roster.settings ?? {};

    const wins      = settings.wins   ?? 0;
    const losses    = settings.losses ?? 0;
    const ties      = settings.ties   ?? 0;
    const pointsFor = (settings.fpts ?? 0) + (settings.fpts_decimal ? settings.fpts_decimal / 100 : 0);

    const madePlayoffs   = playoffRosterIds.has(rosterId);
    const isChampion     = champion === rosterId;
    // rank — Sleeper sets roster.settings.rank for final season standing
    const finalStanding: number | null = isChampion ? 1 : (madePlayoffs ? 2 : null);

    const teamName = roster.metadata?.team_name
      || userMap.get(userId)?.display_name
      || `Team ${rosterId}`;

    teams.push({
      externalTeamId: String(rosterId),
      teamName,
      externalOwnerId: userId ?? null,
      wins,
      losses,
      ties,
      pointsFor,
      playoffSeed: madePlayoffs ? (roster.settings?.rank ?? null) : null,
      madePlayoffs,
      finalStanding,
    });
  }

  return teams;
}

// ── Ordered draft position helper ────────────────────────────────────────────

function computeDraftOrder(standings: TeamStanding[]): TeamStanding[] {
  const playoffTeams    = standings.filter(t => t.madePlayoffs);
  const nonPlayoffTeams = standings.filter(t => !t.madePlayoffs);

  // Playoff teams: worst finish (highest number) picks first
  // finalStanding 1 = champion, picks last
  const sortedPlayoff = [...playoffTeams].sort((a, b) => {
    const af = a.finalStanding ?? 99;
    const bf = b.finalStanding ?? 99;
    if (af !== bf) return bf - af; // highest standing number (worst) picks first
    return b.pointsFor - a.pointsFor; // more points = later pick (reward better season)
  });

  // Non-playoff teams: worst record picks first, worst points as tiebreaker
  const sortedNonPlayoff = [...nonPlayoffTeams].sort((a, b) => {
    const aWins = a.wins + a.ties * 0.5;
    const bWins = b.wins + b.ties * 0.5;
    if (aWins !== bWins) return aWins - bWins; // fewer wins = earlier pick
    return a.pointsFor - b.pointsFor; // fewer points = earlier pick
  });

  return [...sortedNonPlayoff, ...sortedPlayoff];
}

// ── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const body: RequestBody = await req.json();

    if (!body.provider || !body.leagueId || !body.season) {
      return new Response(JSON.stringify({ error: "provider, leagueId, and season are required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let standings: TeamStanding[];
    if (body.provider === "espn") {
      standings = await fetchEspnStandings(body);
    } else if (body.provider === "sleeper") {
      standings = await fetchSleeperStandings(body);
    } else {
      return new Response(JSON.stringify({ error: "Unsupported provider" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const orderedByDraft = computeDraftOrder(standings);

    return new Response(JSON.stringify({ standings, draftOrder: orderedByDraft }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
