import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// ============================================================
// Normalized shape that all providers must produce
// ============================================================
type NormalizedNFLPlayer = {
  provider: string;
  providerPlayerId: string;
  providerTeamId: string | null;
  firstName: string | null;
  lastName: string | null;
  displayName: string;
  position: string | null;
  fantasyPosition: string | null;
  jerseyNumber: string | null;
  status: string;
  injuryStatus: string | null;
  yearsExp: number | null;
  college: string | null;
  headshotUrl: string | null;
  rawData: Record<string, unknown>;
};

type NormalizedNFLTeam = {
  provider: string;
  providerTeamId: string;
  name: string;
  abbreviation: string | null;
  city: string | null;
  conference: string | null;
  division: string | null;
  logoUrl: string | null;
  rawData: Record<string, unknown>;
};

type ProviderResult = {
  teams: NormalizedNFLTeam[];
  players: NormalizedNFLPlayer[];
};

// Fantasy-relevant NFL positions
const NFL_FANTASY_POSITIONS = new Set(["QB", "RB", "WR", "TE", "K", "DST"]);

// ============================================================
// Canonical NFL 32-team map
// Used by any provider that does not supply team metadata.
// ============================================================
type CanonicalTeam = {
  abbr: string;
  name: string;
  city: string;
  conference: "AFC" | "NFC";
  division: string;
};

const CANONICAL_NFL_TEAMS: CanonicalTeam[] = [
  // AFC East
  { abbr: "BUF", name: "Buffalo Bills",           city: "Buffalo",        conference: "AFC", division: "AFC East" },
  { abbr: "MIA", name: "Miami Dolphins",           city: "Miami",          conference: "AFC", division: "AFC East" },
  { abbr: "NE",  name: "New England Patriots",     city: "New England",    conference: "AFC", division: "AFC East" },
  { abbr: "NYJ", name: "New York Jets",            city: "New York",       conference: "AFC", division: "AFC East" },
  // AFC North
  { abbr: "BAL", name: "Baltimore Ravens",         city: "Baltimore",      conference: "AFC", division: "AFC North" },
  { abbr: "CIN", name: "Cincinnati Bengals",       city: "Cincinnati",     conference: "AFC", division: "AFC North" },
  { abbr: "CLE", name: "Cleveland Browns",         city: "Cleveland",      conference: "AFC", division: "AFC North" },
  { abbr: "PIT", name: "Pittsburgh Steelers",      city: "Pittsburgh",     conference: "AFC", division: "AFC North" },
  // AFC South
  { abbr: "HOU", name: "Houston Texans",           city: "Houston",        conference: "AFC", division: "AFC South" },
  { abbr: "IND", name: "Indianapolis Colts",       city: "Indianapolis",   conference: "AFC", division: "AFC South" },
  { abbr: "JAX", name: "Jacksonville Jaguars",     city: "Jacksonville",   conference: "AFC", division: "AFC South" },
  { abbr: "TEN", name: "Tennessee Titans",         city: "Tennessee",      conference: "AFC", division: "AFC South" },
  // AFC West
  { abbr: "DEN", name: "Denver Broncos",           city: "Denver",         conference: "AFC", division: "AFC West" },
  { abbr: "KC",  name: "Kansas City Chiefs",       city: "Kansas City",    conference: "AFC", division: "AFC West" },
  { abbr: "LV",  name: "Las Vegas Raiders",        city: "Las Vegas",      conference: "AFC", division: "AFC West" },
  { abbr: "LAC", name: "Los Angeles Chargers",     city: "Los Angeles",    conference: "AFC", division: "AFC West" },
  // NFC East
  { abbr: "DAL", name: "Dallas Cowboys",           city: "Dallas",         conference: "NFC", division: "NFC East" },
  { abbr: "NYG", name: "New York Giants",          city: "New York",       conference: "NFC", division: "NFC East" },
  { abbr: "PHI", name: "Philadelphia Eagles",      city: "Philadelphia",   conference: "NFC", division: "NFC East" },
  { abbr: "WAS", name: "Washington Commanders",    city: "Washington",     conference: "NFC", division: "NFC East" },
  // NFC North
  { abbr: "CHI", name: "Chicago Bears",            city: "Chicago",        conference: "NFC", division: "NFC North" },
  { abbr: "DET", name: "Detroit Lions",            city: "Detroit",        conference: "NFC", division: "NFC North" },
  { abbr: "GB",  name: "Green Bay Packers",        city: "Green Bay",      conference: "NFC", division: "NFC North" },
  { abbr: "MIN", name: "Minnesota Vikings",        city: "Minnesota",      conference: "NFC", division: "NFC North" },
  // NFC South
  { abbr: "ATL", name: "Atlanta Falcons",          city: "Atlanta",        conference: "NFC", division: "NFC South" },
  { abbr: "CAR", name: "Carolina Panthers",        city: "Carolina",       conference: "NFC", division: "NFC South" },
  { abbr: "NO",  name: "New Orleans Saints",       city: "New Orleans",    conference: "NFC", division: "NFC South" },
  { abbr: "TB",  name: "Tampa Bay Buccaneers",     city: "Tampa Bay",      conference: "NFC", division: "NFC South" },
  // NFC West
  { abbr: "ARI", name: "Arizona Cardinals",        city: "Arizona",        conference: "NFC", division: "NFC West" },
  { abbr: "LAR", name: "Los Angeles Rams",         city: "Los Angeles",    conference: "NFC", division: "NFC West" },
  { abbr: "SF",  name: "San Francisco 49ers",      city: "San Francisco",  conference: "NFC", division: "NFC West" },
  { abbr: "SEA", name: "Seattle Seahawks",         city: "Seattle",        conference: "NFC", division: "NFC West" },
];

// Index for O(1) lookups by abbreviation
const CANONICAL_TEAM_BY_ABBR: Record<string, CanonicalTeam> = {};
for (const t of CANONICAL_NFL_TEAMS) {
  CANONICAL_TEAM_BY_ABBR[t.abbr] = t;
}

function canonicalTeamsAsNormalized(provider: string): NormalizedNFLTeam[] {
  return CANONICAL_NFL_TEAMS.map((t) => ({
    provider,
    providerTeamId: t.abbr,
    name: t.name,
    abbreviation: t.abbr,
    city: t.city,
    conference: t.conference,
    division: t.division,
    logoUrl: null,
    rawData: {},
  }));
}

// Build synthetic D/ST players (one per canonical team) for a given provider
function syntheticDSTPlayers(provider: string): NormalizedNFLPlayer[] {
  return CANONICAL_NFL_TEAMS.map((t) => ({
    provider,
    providerPlayerId: `dst_${t.abbr}`,
    providerTeamId: t.abbr,
    firstName: null,
    lastName: null,
    displayName: `${t.name} D/ST`,
    position: "DEF",
    fantasyPosition: "DST",
    jerseyNumber: null,
    status: "Active",
    injuryStatus: null,
    yearsExp: null,
    college: null,
    headshotUrl: null,
    rawData: { synthetic: true, source: "canonical_team_map" },
  }));
}

// ============================================================
// Mock provider
// ============================================================
function mockProvider(_season: string): ProviderResult {
  const teams: NormalizedNFLTeam[] = [
    { provider: "mock", providerTeamId: "KC",  name: "Kansas City Chiefs",     abbreviation: "KC",  city: "Kansas City",    conference: "AFC", division: "AFC West", logoUrl: null, rawData: {} },
    { provider: "mock", providerTeamId: "SF",  name: "San Francisco 49ers",    abbreviation: "SF",  city: "San Francisco",  conference: "NFC", division: "NFC West", logoUrl: null, rawData: {} },
    { provider: "mock", providerTeamId: "BUF", name: "Buffalo Bills",           abbreviation: "BUF", city: "Buffalo",        conference: "AFC", division: "AFC East", logoUrl: null, rawData: {} },
    { provider: "mock", providerTeamId: "PHI", name: "Philadelphia Eagles",     abbreviation: "PHI", city: "Philadelphia",   conference: "NFC", division: "NFC East", logoUrl: null, rawData: {} },
    { provider: "mock", providerTeamId: "DAL", name: "Dallas Cowboys",          abbreviation: "DAL", city: "Dallas",         conference: "NFC", division: "NFC East", logoUrl: null, rawData: {} },
  ];

  const players: NormalizedNFLPlayer[] = [
    { provider: "mock", providerPlayerId: "p1",     providerTeamId: "KC",  firstName: "Patrick",   lastName: "Mahomes",   displayName: "P. Mahomes",   position: "QB",  fantasyPosition: "QB",  jerseyNumber: "15", status: "Active", injuryStatus: null, yearsExp: 7, college: "Texas Tech",  headshotUrl: null, rawData: {} },
    { provider: "mock", providerPlayerId: "p2",     providerTeamId: "BUF", firstName: "Josh",      lastName: "Allen",     displayName: "J. Allen",     position: "QB",  fantasyPosition: "QB",  jerseyNumber: "17", status: "Active", injuryStatus: null, yearsExp: 6, college: "Wyoming",     headshotUrl: null, rawData: {} },
    { provider: "mock", providerPlayerId: "p3",     providerTeamId: "PHI", firstName: "Jalen",     lastName: "Hurts",     displayName: "J. Hurts",     position: "QB",  fantasyPosition: "QB",  jerseyNumber: "1",  status: "Active", injuryStatus: null, yearsExp: 4, college: "Alabama",     headshotUrl: null, rawData: {} },
    { provider: "mock", providerPlayerId: "p4",     providerTeamId: "SF",  firstName: "Christian", lastName: "McCaffrey", displayName: "C. McCaffrey", position: "RB",  fantasyPosition: "RB",  jerseyNumber: "23", status: "Active", injuryStatus: null, yearsExp: 7, college: "Stanford",    headshotUrl: null, rawData: {} },
    { provider: "mock", providerPlayerId: "p5",     providerTeamId: "DAL", firstName: "Tony",      lastName: "Pollard",   displayName: "T. Pollard",   position: "RB",  fantasyPosition: "RB",  jerseyNumber: "20", status: "Active", injuryStatus: null, yearsExp: 5, college: "Memphis",     headshotUrl: null, rawData: {} },
    { provider: "mock", providerPlayerId: "p6",     providerTeamId: "KC",  firstName: "Rashee",    lastName: "Rice",      displayName: "R. Rice",      position: "WR",  fantasyPosition: "WR",  jerseyNumber: "4",  status: "Active", injuryStatus: null, yearsExp: 2, college: "SMU",         headshotUrl: null, rawData: {} },
    { provider: "mock", providerPlayerId: "p7",     providerTeamId: "BUF", firstName: "Stefon",    lastName: "Diggs",     displayName: "S. Diggs",     position: "WR",  fantasyPosition: "WR",  jerseyNumber: "14", status: "Active", injuryStatus: null, yearsExp: 9, college: "Maryland",    headshotUrl: null, rawData: {} },
    { provider: "mock", providerPlayerId: "p8",     providerTeamId: "PHI", firstName: "DeVonta",   lastName: "Smith",     displayName: "D. Smith",     position: "WR",  fantasyPosition: "WR",  jerseyNumber: "6",  status: "Active", injuryStatus: null, yearsExp: 3, college: "Alabama",     headshotUrl: null, rawData: {} },
    { provider: "mock", providerPlayerId: "p9",     providerTeamId: "KC",  firstName: "Travis",    lastName: "Kelce",     displayName: "T. Kelce",     position: "TE",  fantasyPosition: "TE",  jerseyNumber: "87", status: "Active", injuryStatus: null, yearsExp: 11, college: "Cincinnati", headshotUrl: null, rawData: {} },
    { provider: "mock", providerPlayerId: "p10",    providerTeamId: "SF",  firstName: "George",    lastName: "Kittle",    displayName: "G. Kittle",    position: "TE",  fantasyPosition: "TE",  jerseyNumber: "85", status: "Active", injuryStatus: null, yearsExp: 7, college: "Iowa",        headshotUrl: null, rawData: {} },
    { provider: "mock", providerPlayerId: "p11",    providerTeamId: "KC",  firstName: "Harrison",  lastName: "Butker",    displayName: "H. Butker",    position: "K",   fantasyPosition: "K",   jerseyNumber: "7",  status: "Active", injuryStatus: null, yearsExp: 7, college: "Georgia Tech", headshotUrl: null, rawData: {} },
    { provider: "mock", providerPlayerId: "dst_KC", providerTeamId: "KC",  firstName: null, lastName: null, displayName: "Kansas City Chiefs D/ST",  position: "DEF", fantasyPosition: "DST", jerseyNumber: null, status: "Active", injuryStatus: null, yearsExp: null, college: null, headshotUrl: null, rawData: { synthetic: true, source: "canonical_team_map" } },
    { provider: "mock", providerPlayerId: "dst_SF", providerTeamId: "SF",  firstName: null, lastName: null, displayName: "San Francisco 49ers D/ST", position: "DEF", fantasyPosition: "DST", jerseyNumber: null, status: "Active", injuryStatus: null, yearsExp: null, college: null, headshotUrl: null, rawData: { synthetic: true, source: "canonical_team_map" } },
    // Non-fantasy individual defensive player
    { provider: "mock", providerPlayerId: "p12",    providerTeamId: "SF",  firstName: "Nick", lastName: "Bosa", displayName: "N. Bosa", position: "DE", fantasyPosition: null, jerseyNumber: "97", status: "Active", injuryStatus: null, yearsExp: 5, college: "Ohio State", headshotUrl: null, rawData: {} },
  ];

  return { teams, players };
}

// ============================================================
// Sleeper provider
// ============================================================
async function sleeperProvider(_season: string): Promise<ProviderResult> {
  const resp = await fetch("https://api.sleeper.app/v1/players/nfl");
  if (!resp.ok) {
    throw new Error(`Sleeper API returned ${resp.status}: ${await resp.text()}`);
  }
  const raw: Record<string, Record<string, unknown>> = await resp.json();

  const players: NormalizedNFLPlayer[] = [];

  for (const [pid, p] of Object.entries(raw)) {
    // Skip records with no active flag and non-Active status
    if (!p.active && p.status !== "Active") continue;
    const pos = (p.position as string | null) ?? null;
    const fantasyPos = pos && NFL_FANTASY_POSITIONS.has(pos) ? pos : null;
    const teamAbbr = (p.team as string | null) ?? null;

    players.push({
      provider: "sleeper",
      providerPlayerId: pid,
      providerTeamId: teamAbbr,
      firstName: (p.first_name as string | null) ?? null,
      lastName: (p.last_name as string | null) ?? null,
      displayName: (p.full_name as string | null) ?? (p.last_name as string) ?? pid,
      position: pos,
      fantasyPosition: fantasyPos,
      jerseyNumber: p.number != null ? String(p.number) : null,
      status: (p.status as string | null) ?? "Active",
      injuryStatus: (p.injury_status as string | null) ?? null,
      yearsExp: (p.years_exp as number | null) ?? null,
      college: (p.college as string | null) ?? null,
      headshotUrl: pid ? `https://sleepercdn.com/content/nfl/players/thumb/${pid}.jpg` : null,
      rawData: p,
    });
  }

  // Always use canonical 32 teams — do not infer from player data
  const teams = canonicalTeamsAsNormalized("sleeper");

  // Append synthetic D/ST for all 32 canonical teams
  const dstPlayers = syntheticDSTPlayers("sleeper");
  players.push(...dstPlayers);

  return { teams, players };
}

// ============================================================
// SportsDataIO provider skeleton
// ============================================================
async function sportsDataIOProvider(season: string): Promise<ProviderResult> {
  const apiKey = Deno.env.get("SPORTSDATAIO_NFL_API_KEY");
  if (!apiKey) {
    throw new Error(
      "SPORTSDATAIO_NFL_API_KEY secret is not set. " +
      "Set it via Supabase dashboard > Settings > Edge Functions > Secrets."
    );
  }
  throw new Error(
    `SportsDataIO provider is not yet implemented. Season: ${season}. ` +
    "Set SPORTSDATAIO_NFL_API_KEY and implement the fetch logic above."
  );
}

// ============================================================
// Provider dispatcher
// ============================================================
async function fetchFromProvider(provider: string, season: string): Promise<ProviderResult> {
  switch (provider) {
    case "mock":    return mockProvider(season);
    case "sleeper": return await sleeperProvider(season);
    case "sportsdataio": return await sportsDataIOProvider(season);
    default: throw new Error(`Unknown provider: "${provider}". Valid values: mock, sleeper, sportsdataio`);
  }
}

// ============================================================
// Main handler
// ============================================================
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

    // Verify caller is admin
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

    const body = await req.json().catch(() => ({}));
    const provider: string = body.provider ?? "mock";
    const season: string = body.season ?? new Date().getFullYear().toString();

    // Resolve NFL sports_league row
    const { data: nflLeague, error: leagueErr } = await supabaseAdmin
      .from("sports_leagues")
      .select("id")
      .eq("abbreviation", "NFL")
      .maybeSingle();

    if (leagueErr || !nflLeague) {
      throw new Error("NFL sports_league row not found. Was the migration applied?");
    }
    const leagueId = nflLeague.id;

    // Create import run record
    const { data: importRun, error: runErr } = await supabaseAdmin
      .from("roster_import_runs")
      .insert({ provider, season, triggered_by: user.id, status: "running" })
      .select("id")
      .single();

    if (runErr || !importRun) {
      throw new Error("Could not create import run: " + runErr?.message);
    }
    const runId = importRun.id;

    const errors: string[] = [];
    let teamsSeen = 0;
    let playersSeen = 0;
    let playersUpserted = 0;
    let fantasyRelevantCount = 0;

    try {
      const { teams, players } = await fetchFromProvider(provider, season);
      teamsSeen = teams.length;
      playersSeen = players.length;

      // --------------------------------------------------------
      // Upsert teams
      // --------------------------------------------------------
      const teamUpsertRows = teams.map((t) => ({
        league_id: leagueId,
        provider: t.provider,
        provider_team_id: t.providerTeamId,
        name: t.name,
        abbreviation: t.abbreviation,
        city: t.city,
        conference: t.conference,
        division: t.division,
        logo_url: t.logoUrl,
        is_active: true,
        raw_data: t.rawData,
        updated_at: new Date().toISOString(),
      }));

      if (teamUpsertRows.length > 0) {
        const { error: teamErr } = await supabaseAdmin
          .from("sports_teams")
          .upsert(teamUpsertRows, { onConflict: "league_id,provider,provider_team_id" });
        if (teamErr) errors.push("Team upsert error: " + teamErr.message);
      }

      // Build providerTeamId -> DB team id map
      const { data: dbTeams } = await supabaseAdmin
        .from("sports_teams")
        .select("id, provider_team_id")
        .eq("league_id", leagueId)
        .eq("provider", provider);

      const teamIdMap: Record<string, string> = {};
      for (const t of dbTeams ?? []) {
        teamIdMap[t.provider_team_id] = t.id;
      }

      // --------------------------------------------------------
      // Upsert players
      // --------------------------------------------------------
      const playerUpsertRows = players.map((p) => {
        const isFantasyRelevant =
          p.fantasyPosition != null && NFL_FANTASY_POSITIONS.has(p.fantasyPosition);
        return {
          league_id: leagueId,
          provider: p.provider,
          provider_player_id: p.providerPlayerId,
          team_id: p.providerTeamId ? (teamIdMap[p.providerTeamId] ?? null) : null,
          first_name: p.firstName,
          last_name: p.lastName,
          display_name: p.displayName,
          position: p.position,
          fantasy_position: p.fantasyPosition,
          jersey_number: p.jerseyNumber,
          status: p.status,
          injury_status: p.injuryStatus,
          years_exp: p.yearsExp,
          college: p.college,
          headshot_url: p.headshotUrl,
          is_fantasy_relevant: isFantasyRelevant,
          raw_data: p.rawData,
          updated_at: new Date().toISOString(),
        };
      });

      // Upsert in batches of 500 to avoid payload limits
      const BATCH = 500;
      for (let i = 0; i < playerUpsertRows.length; i += BATCH) {
        const batch = playerUpsertRows.slice(i, i + BATCH);
        const { error: playerErr } = await supabaseAdmin
          .from("sports_players")
          .upsert(batch, { onConflict: "league_id,provider,provider_player_id" });
        if (playerErr) {
          errors.push(`Player upsert batch ${i}-${i + batch.length} error: ${playerErr.message}`);
        } else {
          playersUpserted += batch.length;
        }
      }

      fantasyRelevantCount = playerUpsertRows.filter((p) => p.is_fantasy_relevant).length;

      // Mark any previously active players not in this import as inactive
      const seenProviderIds = players.map((p) => p.providerPlayerId);
      if (seenProviderIds.length > 0) {
        await supabaseAdmin
          .from("sports_players")
          .update({ status: "Inactive", team_id: null, updated_at: new Date().toISOString() })
          .eq("league_id", leagueId)
          .eq("provider", provider)
          .eq("status", "Active")
          .not("provider_player_id", "in", `(${seenProviderIds.map((id) => `"${id}"`).join(",")})`);
      }

      // --------------------------------------------------------
      // Upsert rosters
      // --------------------------------------------------------
      const { data: dbPlayers } = await supabaseAdmin
        .from("sports_players")
        .select("id, provider_player_id, team_id")
        .eq("league_id", leagueId)
        .eq("provider", provider);

      const playerIdMap: Record<string, { id: string; teamId: string | null }> = {};
      for (const dp of dbPlayers ?? []) {
        playerIdMap[dp.provider_player_id] = { id: dp.id, teamId: dp.team_id };
      }

      const rosterRows = players
        .filter((p) => playerIdMap[p.providerPlayerId])
        .map((p) => {
          const dbp = playerIdMap[p.providerPlayerId];
          return {
            player_id: dbp.id,
            team_id: dbp.teamId,
            season,
            roster_status: p.status === "Active" ? "Active" : "Inactive",
            updated_at: new Date().toISOString(),
          };
        });

      for (let i = 0; i < rosterRows.length; i += BATCH) {
        const batch = rosterRows.slice(i, i + BATCH);
        const { error: rosterErr } = await supabaseAdmin
          .from("sports_rosters")
          .upsert(batch, { onConflict: "player_id,season" });
        if (rosterErr) errors.push(`Roster upsert error: ${rosterErr.message}`);
      }

      // Mark import run as success
      await supabaseAdmin
        .from("roster_import_runs")
        .update({
          status: errors.length > 0 ? "failed" : "success",
          teams_seen: teamsSeen,
          players_seen: playersSeen,
          players_upserted: playersUpserted,
          fantasy_relevant_count: fantasyRelevantCount,
          errors: errors.length > 0 ? errors : null,
          completed_at: new Date().toISOString(),
        })
        .eq("id", runId);

    } catch (innerErr: unknown) {
      const msg = innerErr instanceof Error ? innerErr.message : String(innerErr);
      errors.push(msg);
      await supabaseAdmin
        .from("roster_import_runs")
        .update({
          status: "failed",
          errors: [msg],
          completed_at: new Date().toISOString(),
        })
        .eq("id", runId);

      return new Response(
        JSON.stringify({ success: false, runId, error: msg }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        success: errors.length === 0,
        runId,
        provider,
        season,
        teamsSeen,
        playersSeen,
        playersUpserted,
        fantasyRelevantCount,
        errors: errors.length > 0 ? errors : null,
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
