// ESPN historical season adapter.
// Fetches historical season data from the ESPN Fantasy API v3.
//
// The URL pattern is the same as the current-season import:
//   https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/{year}/segments/0/leagues/{id}
//
// This works for completed seasons 2019+ without authentication for public leagues.
// Private leagues or pre-2019 seasons may require SWID + espn_s2 cookies.
//
// SECURITY INVARIANTS (same as the active import adapter):
//   - swid and espnS2 are used ONLY to build the Cookie header for the outbound fetch.
//   - They are never assigned to any variable that is logged, returned, or stored.
//   - Raw ESPN response bodies are never stored — only normalized data is returned.

import type {
  NormalizedHistoricalSeason,
  NormalizedHistoricalTeam,
  NormalizedHistoricalMatchup,
  NormalizedHistoricalDraft,
  NormalizedHistoricalDraftPick,
  MatchupClassification,
} from "./historical-types.ts";

const ESPN_API_BASE = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons";
const ESPN_LEGACY_API_BASE = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/leagueHistory";
const ESPN_REQUEST_TIMEOUT_MS = 8000;

export type EspnSeasonAvailability =
  | { status: "verified_available"; message: string }
  | { status: "access_required"; message: string }
  | { status: "unavailable"; message: string }
  | { status: "not_verified"; message: string };

function buildHeaders(params: EspnHistoryParams): Record<string, string> {
  const headers: Record<string, string> = {
    "Accept": "application/json",
    "User-Agent": "UltimateDrafter/1.0",
  };
  if (params.isPrivate && params.swid && params.espnS2) {
    headers["Cookie"] = `SWID=${params.swid}; espn_s2=${params.espnS2}`;
  }
  return headers;
}

function buildSeasonUrl(season: number, leagueId: string, views: string[]): string {
  if (season < 2018) {
    const query = new URLSearchParams({ seasonId: String(season) });
    for (const view of views) query.append("view", view);
    return `${ESPN_LEGACY_API_BASE}/${leagueId}?${query.toString()}`;
  }
  const query = new URLSearchParams();
  for (const view of views) query.append("view", view);
  return `${ESPN_API_BASE}/${season}/segments/0/leagues/${leagueId}?${query.toString()}`;
}

async function fetchWithTimeout(url: string, headers: Record<string, string>): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ESPN_REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { headers, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function isUsableHistoricalResponse(raw: unknown): boolean {
  const data = Array.isArray(raw) ? raw[0] : raw;
  if (typeof data !== "object" || data === null) return false;
  const record = data as Record<string, unknown>;
  return Array.isArray(record.teams) || typeof record.settings === "object";
}

export async function verifyEspnHistoricalSeason(
  params: EspnHistoryParams,
): Promise<EspnSeasonAvailability> {
  const url = buildSeasonUrl(params.season, params.leagueId, ["mStatus", "mTeam", "mSettings"]);
  try {
    const response = await fetchWithTimeout(url, buildHeaders(params));
    if (response.status === 401 || response.status === 403) {
      return {
        status: "access_required",
        message: params.isPrivate
          ? "ESPN rejected the supplied private-league credentials."
          : "ESPN requires private-league credentials for this season.",
      };
    }
    if (response.status === 404) {
      return {
        status: "unavailable",
        message: `ESPN confirmed that season ${params.season} is unavailable through its supported historical endpoint.`,
      };
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok || !contentType.includes("application/json")) {
      return {
        status: "not_verified",
        message: `ESPN did not return a usable verification response (HTTP ${response.status}).`,
      };
    }
    const raw: unknown = await response.json();
    if (!isUsableHistoricalResponse(raw)) {
      return {
        status: "not_verified",
        message: "ESPN returned data, but it did not contain usable historical league data.",
      };
    }
    return { status: "verified_available", message: "Verified and ready to import." };
  } catch (err) {
    return {
      status: "not_verified",
      message: err instanceof DOMException && err.name === "AbortError"
        ? "ESPN verification timed out."
        : "ESPN verification could not be completed.",
    };
  }
}

export interface EspnHistoryParams {
  leagueId: string;
  season: number;
  isPrivate: boolean;
  swid?: string;
  espnS2?: string;
}

export async function fetchEspnHistoricalSeason(
  params: EspnHistoryParams
): Promise<NormalizedHistoricalSeason> {
  const { leagueId, season, isPrivate } = params;

  // Fetch all views in a single API call — verified to work in Phase 0
  const views = ["mTeam", "mSettings", "mStatus", "mMatchup", "mDraftDetail"];
  const url = buildSeasonUrl(season, leagueId, views);
  const headers = buildHeaders(params);

  console.log(JSON.stringify({
    event: "espn_history_fetch_start",
    leagueId,
    season,
    isPrivate,
    hasSwid: isPrivate ? (params.swid?.length ?? 0) > 0 : false,
    hasEspnS2: isPrivate ? (params.espnS2?.length ?? 0) > 0 : false,
    views,
  }));

  const resp = await fetchWithTimeout(url, headers);

  const contentType = resp.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    if (isPrivate && (resp.status === 401 || resp.status === 403 || resp.status === 200)) {
      throw new Error(
        "ESPN returned a non-JSON response. The league may be private, or " +
        "the provided SWID and espn_s2 credentials may be expired."
      );
    }
    throw new Error(
      `ESPN API returned an unexpected content type (HTTP ${resp.status}). ` +
      "The league ID or season may be incorrect."
    );
  }

  if (resp.status === 401 || resp.status === 403) {
    throw new Error(
      `ESPN denied access (HTTP ${resp.status}). ` +
      (isPrivate
        ? "The credentials may be expired or incorrect."
        : "This league may be private. Enable private mode and provide credentials.")
    );
  }

  if (resp.status === 404) {
    throw new Error(
      `ESPN returned 404 for season ${season}. This season may not be available through ESPN's supported historical endpoints.`
    );
  }

  if (!resp.ok) {
    throw new Error(`ESPN API returned HTTP ${resp.status} for league ${leagueId}, season ${season}.`);
  }

  const raw: unknown = await resp.json();
  return normalizeEspnHistoricalResponse(raw, leagueId, season);
}

function normalizeEspnHistoricalResponse(
  raw: unknown,
  leagueId: string,
  season: number
): NormalizedHistoricalSeason {
  const warnings: string[] = [];

  const responseData = Array.isArray(raw) ? raw[0] : raw;
  if (typeof responseData !== "object" || responseData === null) {
    throw new Error("ESPN API returned an unexpected response shape.");
  }

  const data = responseData as Record<string, unknown>;

  // ── Settings ────────────────────────────────────────────────────────────────
  const settings = data?.settings as Record<string, unknown> | undefined;
  const leagueName =
    (settings?.name as string | undefined) ??
    `ESPN League ${leagueId}`;

  const scoringSettings = settings?.scoringSettings as Record<string, unknown> | undefined;
  const scoringType =
    (scoringSettings?.playerRankType as string | undefined) === "PPR" ? "ppr" :
    (scoringSettings?.playerRankType as string | undefined) === "STANDARD" ? "standard" :
    "custom";

  const scheduleSettings = settings?.scheduleSettings as Record<string, unknown> | undefined;
  const matchupPeriodCount =
    typeof scheduleSettings?.matchupPeriodCount === "number"
      ? scheduleSettings.matchupPeriodCount
      : 14;
  const playoffTeamCount =
    typeof scheduleSettings?.playoffTeamCount === "number"
      ? scheduleSettings.playoffTeamCount
      : 0;

  // ── Status / previousSeasons ────────────────────────────────────────────────
  const status = data?.status as Record<string, unknown> | undefined;
  const previousSeasonsRaw = status?.previousSeasons;
  const previousSeasons: number[] =
    Array.isArray(previousSeasonsRaw)
      ? previousSeasonsRaw.filter((n): n is number => typeof n === "number")
      : [];

  // ── Members map: ESPN userId → display name ─────────────────────────────────
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
    warnings.push("ESPN response contained no teams.");
  }

  const teams: NormalizedHistoricalTeam[] = [];

  for (const t of teamsRaw) {
    if (typeof t !== "object" || t === null) continue;
    const team = t as Record<string, unknown>;

    const teamId = team?.id != null ? String(team.id) : undefined;
    if (!teamId) {
      warnings.push("Skipped a team with no ID.");
      continue;
    }

    const abbrev = (team?.abbrev as string | undefined)?.trim() ?? "";
    const teamName =
      (team?.name as string | undefined)?.trim() ||
      (team?.location && team?.nickname
        ? `${team.location} ${team.nickname}`.trim()
        : "") ||
      abbrev ||
      `Team ${teamId}`;

    const ownersArr = Array.isArray(team?.owners) ? (team.owners as unknown[]) : [];
    const owners = ownersArr.filter((o): o is string => typeof o === "string");
    const primaryOwner =
      typeof team?.primaryOwner === "string"
        ? team.primaryOwner
        : owners.length > 0
          ? owners[0]
          : null;

    const recordOverall = (team?.record as Record<string, unknown>)?.overall as Record<string, unknown> | undefined;
    const wins = typeof recordOverall?.wins === "number" ? recordOverall.wins : 0;
    const losses = typeof recordOverall?.losses === "number" ? recordOverall.losses : 0;
    const ties = typeof recordOverall?.ties === "number" ? recordOverall.ties : 0;
    const pointsFor = typeof recordOverall?.pointsFor === "number" ? recordOverall.pointsFor : 0;
    const pointsAgainst = typeof recordOverall?.pointsAgainst === "number" ? recordOverall.pointsAgainst : 0;

    const playoffSeed =
      typeof team?.playoffSeed === "number" && team.playoffSeed > 0
        ? team.playoffSeed
        : null;

    const finalStanding =
      typeof team?.rankCalculatedFinal === "number" && team.rankCalculatedFinal > 0
        ? team.rankCalculatedFinal
        : null;

    const eliminated = Boolean(team?.eliminated);
    const eliminationPeriod =
      typeof team?.eliminationMatchupPeriod === "number" && team.eliminationMatchupPeriod > 0
        ? team.eliminationMatchupPeriod
        : null;

    teams.push({
      externalTeamId: teamId,
      teamName,
      teamAbbrev: abbrev,
      owners,
      primaryOwner,
      wins,
      losses,
      ties,
      pointsFor,
      pointsAgainst,
      playoffSeed,
      finalStanding,
      eliminated,
      eliminationPeriod,
      rawTeamData: {
        abbrev,
        name: teamName,
        owners,
        primaryOwner,
        playoffSeed,
        rankCalculatedFinal: finalStanding,
        divisionId: team?.divisionId ?? 0,
      },
    });
  }

  // ── Matchups (schedule) ─────────────────────────────────────────────────────
  const scheduleRaw = Array.isArray(data?.schedule) ? (data.schedule as unknown[]) : [];
  const matchups: NormalizedHistoricalMatchup[] = [];

  const lastMatchupPeriod = scheduleRaw.reduce((max: number, m) => {
    const period = typeof (m as Record<string, unknown>)?.matchupPeriodId === "number"
      ? (m as Record<string, unknown>).matchupPeriodId as number
      : 0;
    return Math.max(max, period);
  }, 0);

  // Identify champion (rankCalculatedFinal = 1) and runner-up (rankCalculatedFinal = 2).
  // The championship game is the matchup in the last playoff period that contains
  // BOTH the champion and the runner-up. This is the only reliable indicator —
  // ESPN does not label brackets or championship games explicitly.
  const championTeamId = teams.find((t) => t.finalStanding === 1)?.externalTeamId ?? null;
  const runnerUpTeamId = teams.find((t) => t.finalStanding === 2)?.externalTeamId ?? null;

  for (const m of scheduleRaw) {
    if (typeof m !== "object" || m === null) continue;
    const mu = m as Record<string, unknown>;

    const matchupId = typeof mu?.id === "number" ? mu.id : 0;
    const matchupPeriod = typeof mu?.matchupPeriodId === "number" ? mu.matchupPeriodId : 0;

    const home = mu?.home as Record<string, unknown> | undefined;
    const away = mu?.away as Record<string, unknown> | undefined;

    const homeTeamId = home?.teamId != null ? String(home.teamId) : null;
    const awayTeamId = away?.teamId != null ? String(away.teamId) : null;

    const homeScore =
      typeof home?.totalPoints === "number" ? home.totalPoints : null;
    const awayScore =
      typeof away?.totalPoints === "number" ? away.totalPoints : null;

    const winnerRaw = typeof mu?.winner === "string" ? mu.winner : null;
    const winner: "HOME" | "AWAY" | "UNDECIDED" | null =
      winnerRaw === "HOME" ? "HOME" :
      winnerRaw === "AWAY" ? "AWAY" :
      winnerRaw === "UNDECIDED" ? "UNDECIDED" :
      null;

    // Classify: periods > matchupPeriodCount are playoff
    let classification: MatchupClassification = "regular";
    if (matchupPeriod > matchupPeriodCount) {
      if (awayTeamId === null) {
        classification = "bye";
      } else if (
        matchupPeriod === lastMatchupPeriod &&
        championTeamId && runnerUpTeamId &&
        homeTeamId && awayTeamId &&
        ((homeTeamId === championTeamId && awayTeamId === runnerUpTeamId) ||
         (homeTeamId === runnerUpTeamId && awayTeamId === championTeamId))
      ) {
        // Championship game: the final-period matchup with both rank=1 and rank=2.
        classification = "championship";
      } else {
        // All other playoff matchups (including final-period placement games).
        // ESPN does not label consolation vs winners-bracket, so "playoff" is
        // the safe generic classification.
        classification = "playoff";
      }
    }

    matchups.push({
      sourceMatchupId: matchupId,
      matchupPeriod,
      classification,
      homeTeamId,
      awayTeamId,
      homeScore,
      awayScore,
      winner,
      rawMatchupData: {
        id: matchupId,
        matchupPeriodId: matchupPeriod,
      },
    });
  }

  // ── Draft ───────────────────────────────────────────────────────────────────
  const draftDetail = data?.draftDetail as Record<string, unknown> | undefined;
  let draft: NormalizedHistoricalDraft | null = null;

  if (draftDetail && draftDetail.drafted === true) {
    const picksRaw = Array.isArray(draftDetail.picks) ? (draftDetail.picks as unknown[]) : [];
    const picks: NormalizedHistoricalDraftPick[] = [];

    const draftSettingsType =
      (settings?.draftSettings as Record<string, unknown>)?.type as string | undefined;

    let numRounds = 0;

    for (const p of picksRaw) {
      if (typeof p !== "object" || p === null) continue;
      const pick = p as Record<string, unknown>;

      const overallPickNumber =
        typeof pick?.overallPickNumber === "number" ? pick.overallPickNumber :
        typeof pick?.pickNumber === "number" ? pick.pickNumber : 0;

      const roundNumber =
        typeof pick?.roundId === "number" ? pick.roundId : 0;

      if (roundNumber > numRounds) numRounds = roundNumber;

      const roundPickNumber =
        typeof pick?.roundPickNumber === "number" ? pick.roundPickNumber : null;

      const teamId = pick?.teamId != null ? String(pick.teamId) : "";
      const playerId = pick?.playerId != null ? String(pick.playerId) : "";

      const isKeeper = Boolean(pick?.keeper);
      const auctionBidAmount =
        typeof pick?.bidAmount === "number" && pick.bidAmount > 0
          ? pick.bidAmount
          : null;

      picks.push({
        overallPickNumber,
        roundNumber,
        roundPickNumber,
        teamId,
        externalPlayerId: playerId,
        playerName: "", // ESPN historical picks don't include player names
        isKeeper,
        auctionBidAmount,
        rawPickData: {
          overallPickNumber,
          roundId: roundNumber,
          roundPickNumber,
          playerId,
          teamId,
          keeper: isKeeper,
          bidAmount: pick?.bidAmount ?? 0,
        },
      });
    }

    const completedAt =
      typeof draftDetail?.completeDate === "number"
        ? draftDetail.completeDate
        : null;

    draft = {
      draftType: draftSettingsType ?? "unknown",
      numRounds,
      numPicks: picks.length,
      completedAt,
      picks,
      rawDraftDetail: {
        drafted: draftDetail.drafted,
        inProgress: draftDetail.inProgress,
        completeDate: draftDetail.completeDate,
      },
    };
  }

  // ── Completeness ────────────────────────────────────────────────────────────
  const completeness = {
    standings: teams.length > 0,
    matchups: matchups.length > 0,
    draft: draft !== null && draft.picks.length > 0,
  };

  console.log(JSON.stringify({
    event: "espn_history_fetch_complete",
    leagueId,
    season,
    teams: teams.length,
    matchups: matchups.length,
    draftPicks: draft?.picks.length ?? 0,
    previousSeasons,
    completeness,
  }));

  return {
    provider: "espn",
    externalLeagueId: leagueId,
    seasonYear: season,
    displayName: leagueName,
    numTeams: teams.length,
    scoringType,
    rawSettings: settings ?? {},
    rawScoring: scoringSettings ?? {},
    teams,
    matchups,
    draft,
    previousSeasons,
    completeness,
    warnings,
  };
}
