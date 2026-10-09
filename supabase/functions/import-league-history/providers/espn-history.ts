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
  const url =
    `${ESPN_API_BASE}/${season}/segments/0/leagues/${leagueId}` +
    `?${views.map((v) => `view=${v}`).join("&")}`;

  const headers: Record<string, string> = {
    "Accept": "application/json",
    "User-Agent": "UltimateDrafter/1.0",
  };

  if (isPrivate && params.swid && params.espnS2) {
    headers["Cookie"] = `SWID=${params.swid}; espn_s2=${params.espnS2}`;
  }

  console.log(JSON.stringify({
    event: "espn_history_fetch_start",
    leagueId,
    season,
    isPrivate,
    hasSwid: isPrivate ? (params.swid?.length ?? 0) > 0 : false,
    hasEspnS2: isPrivate ? (params.espnS2?.length ?? 0) > 0 : false,
    views,
  }));

  const resp = await fetch(url, { headers });

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
      `ESPN returned 404 for season ${season}. This season may not be available via the v3 API. ` +
      "Seasons before 2019 may not be accessible."
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

  if (typeof raw !== "object" || raw === null) {
    throw new Error("ESPN API returned an unexpected response shape.");
  }

  const data = raw as Record<string, unknown>;

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

  // Identify the champion team (final_standing === 1) to classify the championship game.
  // The final period has multiple placement matchups; only the one involving the
  // champion team is the actual championship game.
  const championTeamId = teams.find((t) => t.finalStanding === 1)?.externalTeamId ?? null;

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
      if (matchupPeriod === lastMatchupPeriod && homeScore !== null && awayScore !== null) {
        // Only the matchup involving the champion team is the championship game.
        // The rest are consolation/placement matchups in the final period.
        if (championTeamId && (homeTeamId === championTeamId || awayTeamId === championTeamId)) {
          classification = "championship";
        } else {
          classification = "consolation";
        }
      } else if (awayTeamId === null) {
        classification = "bye";
      } else {
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
