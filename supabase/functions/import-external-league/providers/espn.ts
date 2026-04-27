// ESPN Fantasy Football provider adapter.
// Fetches league data from the unofficial ESPN Fantasy API v3.
//
// SECURITY INVARIANTS (enforced here, not just documented):
//   - swid and espnS2 are used ONLY to build the Cookie header for the outbound fetch.
//   - They are never assigned to any variable that is logged, returned, or stored.
//   - raw ESPN response bodies are never stored — only normalized metadata is returned.
//   - externalData on roster players contains only: playerId, position, proTeam. No cookies.

import type { NormalizedImport, NormalizedTeam, NormalizedRosterPlayer } from "../shared/types.ts";
import { espnRosterSettings, espnScoringType, espnPositionLabel } from "../shared/normalize.ts";

function getString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

type EspnParams =
  | { leagueId: string; season: number; isPrivate: false }
  | { leagueId: string; season: number; isPrivate: true; swid: string; espnS2: string };

const ESPN_API_BASE = "https://fantasy.espn.com/apis/v3/games/ffl/seasons";

export async function fetchEspnLeague(params: EspnParams): Promise<NormalizedImport> {
  const { leagueId, season } = params;

  const url =
    `${ESPN_API_BASE}/${season}/segments/0/leagues/${leagueId}` +
    `?view=mTeam&view=mRoster&view=mSettings`;

  const headers: Record<string, string> = {
    "Accept": "application/json",
    "User-Agent": "UltimateDrafter/1.0",
  };

  // Credentials used here and nowhere else. Never logged, never stored.
  if (params.isPrivate) {
    headers["Cookie"] = `SWID=${params.swid}; espn_s2=${params.espnS2}`;
  }

  // Safe diagnostic log: presence booleans only, never values
  console.log(JSON.stringify({
    event: "espn_fetch_start",
    leagueId,
    season,
    isPrivate: params.isPrivate,
    hasSwid: params.isPrivate ? (params.swid.length > 0) : false,
    hasEspnS2: params.isPrivate ? (params.espnS2.length > 0) : false,
  }));

  const resp = await fetch(url, { headers });

  // Detect login/redirect HTML responses (private leagues with bad/expired creds)
  const contentType = resp.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    const isAuthFailure = resp.status === 401 || resp.status === 403 || resp.status === 200;
    if (params.isPrivate && isAuthFailure) {
      throw new Error(
        "ESPN returned a non-JSON response. The league may be private, or " +
        "the provided SWID and espn_s2 credentials may be expired. " +
        "Please verify your credentials and try again."
      );
    }
    throw new Error(
      `ESPN API returned an unexpected content type (HTTP ${resp.status}). ` +
      "The league ID or season may be incorrect."
    );
  }

  if (resp.status === 401 || resp.status === 403) {
    throw new Error(
      "ESPN denied access (HTTP " + resp.status + "). " +
      (params.isPrivate
        ? "The provided credentials may be expired or incorrect."
        : "This league may be private. Enable private mode and provide SWID + espn_s2.")
    );
  }

  if (!resp.ok) {
    throw new Error(`ESPN API returned HTTP ${resp.status} for league ${leagueId}.`);
  }

  // Parse response — never store this raw object anywhere
  const raw: unknown = await resp.json();

  console.log(JSON.stringify({
    event: "espn_fetch_complete",
    leagueId,
    season,
    hasTeams: Array.isArray((raw as Record<string, unknown>)?.teams),
    hasSettings: typeof (raw as Record<string, unknown>)?.settings === "object",
    hasMembers: Array.isArray((raw as Record<string, unknown>)?.members),
  }));

  return normalizeEspnResponse(raw, leagueId, season);
}

function normalizeEspnResponse(
  raw: unknown,
  leagueId: string,
  season: number
): NormalizedImport {
  const warnings: string[] = [];

  if (typeof raw !== "object" || raw === null) {
    throw new Error("ESPN API returned an unexpected response shape.");
  }

  const data = raw as Record<string, unknown>;

  // ── Settings ────────────────────────────────────────────────────────────────
  const settings = data?.settings as Record<string, unknown> | undefined;
  const leagueName =
    (settings?.name as string | undefined) ??
    (data?.id != null ? `ESPN League ${data.id}` : `ESPN League ${leagueId}`);

  const rosterSettings_raw = (settings?.rosterSettings as Record<string, unknown> | undefined);
  const lineupSlotCounts = rosterSettings_raw?.lineupSlotCounts as Record<string, unknown> | undefined;
  const rosterSettings = espnRosterSettings(lineupSlotCounts);

  const scoringSettings = (settings?.scoringSettings as unknown) ?? undefined;
  const scoringType = espnScoringType(scoringSettings);

  // Store only safe scoring data — stat multipliers only, no credentials.
  // Preserve array shape when ESPN returns array-form scoring settings.
  const rawScoringSettings: Record<string, unknown> =
    Array.isArray(scoringSettings)
      ? { scoringItems: scoringSettings }
      : typeof scoringSettings === "object" && scoringSettings !== null
        ? (scoringSettings as Record<string, unknown>)
        : {};

  // ── Members map: espn userId → display name ─────────────────────────────────
  const membersRaw = Array.isArray(data?.members) ? (data.members as unknown[]) : [];
  const memberMap = new Map<string, string>();
  for (const m of membersRaw) {
    if (typeof m !== "object" || m === null) continue;
    const member = m as Record<string, unknown>;
    const mid = member?.id as string | undefined;
    const displayName =
      (member?.displayName as string | undefined) ??
      (member?.firstName && member?.lastName
        ? `${member.firstName} ${member.lastName}`
        : undefined) ??
      (member?.firstName as string | undefined) ??
      undefined;
    if (mid && displayName) memberMap.set(mid, displayName);
  }

  // ── Teams ───────────────────────────────────────────────────────────────────
  const teamsRaw = Array.isArray(data?.teams) ? (data.teams as unknown[]) : [];
  if (teamsRaw.length === 0) {
    warnings.push("ESPN response contained no teams. The league ID or season may be incorrect.");
  }

  const teams: NormalizedTeam[] = [];
  const rosters: NormalizedRosterPlayer[] = [];

  for (const t of teamsRaw) {
    if (typeof t !== "object" || t === null) continue;
    const team = t as Record<string, unknown>;

    const teamId = team?.id != null ? String(team.id) : undefined;
    if (!teamId) {
      warnings.push("Skipped a team with no ID in ESPN response.");
      continue;
    }

    // Team name: location + nickname preferred; fall back to abbrev or team ID
    const location = (team?.location as string | undefined)?.trim() ?? "";
    const nickname = (team?.nickname as string | undefined)?.trim() ?? "";
    const abbrev = (team?.abbrev as string | undefined)?.trim() ?? "";
    const teamName =
      location && nickname ? `${location} ${nickname}` :
      location || nickname || abbrev || `Team ${teamId}`;

    // Owner: ESPN teams have an `owners` array of ESPN user IDs
    const ownersArr = Array.isArray(team?.owners)
      ? (team.owners as unknown[])
      : [];
    const primaryOwnerId =
      ownersArr.length > 0 && typeof ownersArr[0] === "string"
        ? (ownersArr[0] as string)
        : undefined;
    const ownerName = primaryOwnerId ? memberMap.get(primaryOwnerId) : undefined;

    teams.push({
      externalTeamId: teamId,
      externalOwnerId: primaryOwnerId,
      externalOwnerName: ownerName,
      teamName,
    });

    // ── Roster entries ─────────────────────────────────────────────────────────
    const rosterObj = team?.roster as Record<string, unknown> | undefined;
    const entries = Array.isArray(rosterObj?.entries) ? (rosterObj.entries as unknown[]) : [];

    if (entries.length === 0) {
      warnings.push(`Team ${teamName} (ID: ${teamId}) has no roster entries.`);
    }

    for (const e of entries) {
      if (typeof e !== "object" || e === null) continue;
      const entry = e as Record<string, unknown>;

      // Defensive parsing: ESPN has changed this nesting over API versions.
      // We check multiple known paths with optional chaining and fallbacks.
      const playerId =
        entry?.playerId != null ? String(entry.playerId) :
        entry?.playerPoolEntry != null
          ? String((entry.playerPoolEntry as Record<string, unknown>)?.id ?? "")
          : undefined;

      if (!playerId || playerId === "") {
        warnings.push(`Skipped a roster entry with no player ID on team ${teamName}.`);
        continue;
      }

      // Player name: try multiple known nesting paths safely with explicit getString()
      const playerPoolEntry = entry?.playerPoolEntry as Record<string, unknown> | undefined;
      const innerPlayerPool = playerPoolEntry?.playerPoolEntry as Record<string, unknown> | undefined;
      const directPlayer = playerPoolEntry?.player as Record<string, unknown> | undefined;
      const innerPlayer = innerPlayerPool?.player as Record<string, unknown> | undefined;

      const fullName =
        getString(directPlayer?.fullName) ||
        getString(innerPlayer?.fullName) ||
        "";

      // defaultPositionId may be on player or playerPoolEntry
      const defaultPositionId: unknown =
        directPlayer?.defaultPositionId ??
        innerPlayer?.defaultPositionId ??
        playerPoolEntry?.defaultPositionId ??
        undefined;

      const position = espnPositionLabel(defaultPositionId);

      // proTeamId — safe to store, it's a number not a credential
      const proTeamId: unknown =
        directPlayer?.proTeamId ??
        innerPlayer?.proTeamId ??
        undefined;

      // Log if name was empty so we can diagnose ESPN API shape changes
      if (!fullName) {
        console.log(JSON.stringify({
          event: "espn_player_name_missing",
          playerId,
          teamId,
          hasPlayerPoolEntry: playerPoolEntry != null,
          hasInnerPlayerPool: innerPlayerPool != null,
          hasDirectPlayer: directPlayer != null,
          hasInnerPlayer: innerPlayer != null,
        }));
      }

      rosters.push({
        externalPlayerId: playerId,
        externalTeamId: teamId,
        playerName: fullName || `ESPN Player ${playerId}`,
        position,
        // externalData: safe debug fields only — NO cookies, NO credentials
        externalData: {
          espnPlayerId: playerId,
          espnTeamId: teamId,
          position: position ?? null,
          proTeamId: proTeamId ?? null,
        },
      });
    }
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
      providerVersion: "espn-v3",
    },
    teams,
    rosters,
    warnings,
  };
}
