// Sleeper Fantasy Football provider adapter.
// All endpoints are public and read-only — no credentials required.
//
// Fetches league info, rosters, and users in parallel.
// Player names are resolved from local sports_players (provider='sleeper')
// rather than making the expensive /v1/players/nfl call.

import type {
  NormalizedImport,
  NormalizedRosterPlayer,
  NormalizedTeam,
} from "../shared/types.ts";
import { sleeperRosterSettings, sleeperScoringType } from "../shared/normalize.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

const SLEEPER_API = "https://api.sleeper.app/v1";

export async function fetchSleeperLeague(
  leagueId: string,
  season: number,
  adminClient: SupabaseClient
): Promise<NormalizedImport> {
  console.log(JSON.stringify({ event: "sleeper_fetch_start", leagueId, season }));

  // Fetch league metadata, rosters, and users in parallel
  const [leagueResp, rostersResp, usersResp] = await Promise.all([
    fetch(`${SLEEPER_API}/league/${leagueId}`),
    fetch(`${SLEEPER_API}/league/${leagueId}/rosters`),
    fetch(`${SLEEPER_API}/league/${leagueId}/users`),
  ]);

  if (!leagueResp.ok) {
    if (leagueResp.status === 404) {
      throw new Error(`Sleeper league "${leagueId}" was not found. Verify the league ID.`);
    }
    throw new Error(`Sleeper league API returned HTTP ${leagueResp.status}.`);
  }
  if (!rostersResp.ok) {
    throw new Error(`Sleeper rosters API returned HTTP ${rostersResp.status}.`);
  }
  if (!usersResp.ok) {
    throw new Error(`Sleeper users API returned HTTP ${usersResp.status}.`);
  }

  const [leagueData, rostersData, usersData] = await Promise.all([
    leagueResp.json(),
    rostersResp.json(),
    usersResp.json(),
  ]) as [Record<string, unknown>, unknown[], unknown[]];

  console.log(JSON.stringify({
    event: "sleeper_fetch_complete",
    leagueId,
    season,
    rosterCount: Array.isArray(rostersData) ? rostersData.length : 0,
    userCount: Array.isArray(usersData) ? usersData.length : 0,
  }));

  return normalizeSleeperResponse(
    leagueId,
    season,
    leagueData,
    rostersData,
    usersData,
    adminClient
  );
}

async function normalizeSleeperResponse(
  leagueId: string,
  season: number,
  leagueData: Record<string, unknown>,
  rostersData: unknown[],
  usersData: unknown[],
  adminClient: SupabaseClient
): Promise<NormalizedImport> {
  const warnings: string[] = [];

  // ── League metadata ─────────────────────────────────────────────────────────
  const leagueName =
    (leagueData?.name as string | undefined) ??
    `Sleeper League ${leagueId}`;

  const rosterPositions = leagueData?.roster_positions;
  const rosterSettings = sleeperRosterSettings(rosterPositions);

  const scoringSettingsRaw = leagueData?.scoring_settings;
  const scoringType = sleeperScoringType(scoringSettingsRaw);
  const rawScoringSettings: Record<string, unknown> =
    typeof scoringSettingsRaw === "object" && scoringSettingsRaw !== null
      ? (scoringSettingsRaw as Record<string, unknown>)
      : {};

  // ── Users map: user_id → { displayName, teamName } ─────────────────────────
  const userMap = new Map<string, { displayName: string; teamName?: string }>();
  for (const u of usersData) {
    if (typeof u !== "object" || u === null) continue;
    const user = u as Record<string, unknown>;
    const uid = user?.user_id as string | undefined;
    if (!uid) continue;

    const displayName =
      (user?.display_name as string | undefined) ??
      (user?.username as string | undefined) ??
      uid;

    const metadata = user?.metadata as Record<string, unknown> | undefined;
    const teamName = metadata?.team_name as string | undefined;

    userMap.set(uid, { displayName, teamName });
  }

  // ── Teams + Rosters ─────────────────────────────────────────────────────────
  const teams: NormalizedTeam[] = [];
  // Collect all unique Sleeper player IDs for bulk name resolution
  const allPlayerIds = new Set<string>();

  // Roster data keyed by roster_id for team building
  const rosterList = Array.isArray(rostersData) ? rostersData : [];

  for (const r of rosterList) {
    if (typeof r !== "object" || r === null) continue;
    const roster = r as Record<string, unknown>;
    const players = Array.isArray(roster?.players) ? (roster.players as unknown[]) : [];
    for (const pid of players) {
      if (typeof pid === "string" && pid.trim() !== "") {
        allPlayerIds.add(pid.trim());
      }
    }
  }

  // Bulk-resolve player names from local sports_players table (provider='sleeper')
  // This avoids the expensive /v1/players/nfl call (~5MB) when roster data is already imported.
  const playerNameMap = new Map<string, { name: string; position: string | undefined }>();
  if (allPlayerIds.size > 0) {
    const idArray = [...allPlayerIds];
    // Query in batches of 500 to avoid URL length limits
    const BATCH = 500;
    for (let i = 0; i < idArray.length; i += BATCH) {
      const batch = idArray.slice(i, i + BATCH);
      const { data: spRows } = await adminClient
        .from("sports_players")
        .select("provider_player_id, display_name, fantasy_position")
        .eq("provider", "sleeper")
        .in("provider_player_id", batch);

      for (const row of spRows ?? []) {
        playerNameMap.set(row.provider_player_id, {
          name: row.display_name,
          position: row.fantasy_position ?? undefined,
        });
      }
    }
  }

  const resolvedCount = playerNameMap.size;
  const unresolvedCount = allPlayerIds.size - resolvedCount;
  console.log(JSON.stringify({
    event: "sleeper_player_resolution",
    totalPlayers: allPlayerIds.size,
    resolvedFromLocal: resolvedCount,
    unresolvedFromLocal: unresolvedCount,
  }));

  if (unresolvedCount > 0) {
    warnings.push(
      `${unresolvedCount} player(s) from imported rosters were not found in the local player database. ` +
      "Run the NFL roster import for the current season to improve resolution."
    );
  }

  // Build teams and roster entries
  const rosters: NormalizedRosterPlayer[] = [];

  for (const r of rosterList) {
    if (typeof r !== "object" || r === null) continue;
    const roster = r as Record<string, unknown>;

    const rosterId = roster?.roster_id != null ? String(roster.roster_id) : undefined;
    if (!rosterId) {
      warnings.push("Skipped a Sleeper roster with no roster_id.");
      continue;
    }

    const ownerId = roster?.owner_id as string | undefined;
    const ownerInfo = ownerId ? userMap.get(ownerId) : undefined;

    // Team name: metadata.team_name > display_name > roster_id
    const teamName =
      ownerInfo?.teamName ||
      ownerInfo?.displayName ||
      `Team ${rosterId}`;

    teams.push({
      externalTeamId: rosterId,
      externalOwnerId: ownerId,
      externalOwnerName: ownerInfo?.displayName,
      teamName,
    });

    // Roster players
    const players = Array.isArray(roster?.players) ? (roster.players as unknown[]) : [];
    if (players.length === 0) {
      warnings.push(`Sleeper roster ${rosterId} (${teamName}) has no players.`);
    }

    for (const pid of players) {
      if (typeof pid !== "string" || pid.trim() === "") continue;

      const resolved = playerNameMap.get(pid);
      rosters.push({
        externalPlayerId: pid,
        externalTeamId: rosterId,
        playerName: resolved?.name ?? `Sleeper Player ${pid}`,
        position: resolved?.position,
        // externalData: safe debug fields only
        externalData: {
          sleeperPlayerId: pid,
          sleeperRosterId: rosterId,
          resolvedFromLocal: resolved != null,
        },
      });
    }
  }

  if (teams.length === 0) {
    throw new Error(
      `No rosters found for Sleeper league "${leagueId}". ` +
      "Verify the league ID is correct and the league has at least one roster."
    );
  }

  return {
    league: {
      externalLeagueId: leagueId,
      externalSeason: season,
      displayName: leagueName,
      numTeams: teams.length,
      scoringType,
      rosterSettings,
      rawScoringSettings,
      providerVersion: "sleeper-v1",
    },
    teams,
    rosters,
    warnings,
  };
}
