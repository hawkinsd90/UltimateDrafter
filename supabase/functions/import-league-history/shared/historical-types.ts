// Provider-neutral types for historical season imports.
// Both ESPN and Sleeper (future) must produce NormalizedHistoricalSeason.

export type Provider = "espn" | "sleeper";

export type MatchupClassification = "regular" | "playoff" | "championship" | "consolation" | "bye";

export interface NormalizedHistoricalTeam {
  externalTeamId: string;
  teamName: string;
  teamAbbrev: string;
  owners: string[];
  primaryOwner: string | null;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  playoffSeed: number | null;
  finalStanding: number | null;
  eliminated: boolean;
  eliminationPeriod: number | null;
  rawTeamData: Record<string, unknown>;
}

export interface NormalizedHistoricalMatchup {
  sourceMatchupId: number;
  matchupPeriod: number;
  classification: MatchupClassification;
  homeTeamId: string | null;
  awayTeamId: string | null;
  homeScore: number | null;
  awayScore: number | null;
  winner: "HOME" | "AWAY" | "UNDECIDED" | null;
  rawMatchupData: Record<string, unknown>;
}

export interface NormalizedHistoricalDraftPick {
  overallPickNumber: number;
  roundNumber: number;
  roundPickNumber: number | null;
  teamId: string;
  externalPlayerId: string;
  playerName: string;
  isKeeper: boolean;
  auctionBidAmount: number | null;
  rawPickData: Record<string, unknown>;
}

export interface NormalizedHistoricalDraft {
  draftType: string;
  numRounds: number;
  numPicks: number;
  completedAt: number | null;
  picks: NormalizedHistoricalDraftPick[];
  rawDraftDetail: Record<string, unknown>;
}

export interface NormalizedHistoricalSeason {
  provider: Provider;
  externalLeagueId: string;
  seasonYear: number;
  displayName: string;
  numTeams: number;
  scoringType: string;
  rawSettings: Record<string, unknown>;
  rawScoring: Record<string, unknown>;
  teams: NormalizedHistoricalTeam[];
  matchups: NormalizedHistoricalMatchup[];
  draft: NormalizedHistoricalDraft | null;
  previousSeasons: number[];
  completeness: {
    standings: boolean;
    matchups: boolean;
    draft: boolean;
  };
  warnings: string[];
}

export interface HistoricalImportSummary {
  success: true;
  seasonId: string;
  seasonYear: number;
  displayName: string;
  teamsImported: number;
  matchupsImported: number;
  draftPicksImported: number;
  managersMatched: number;
  managersCreated: number;
  completeness: {
    standings: boolean;
    matchups: boolean;
    draft: boolean;
  };
  warnings: string[];
}

export interface HistoricalImportRequest {
  leagueId: string;
  seasonYear: number;
  provider: Provider;
  externalLeagueId: string;
  isPrivate?: boolean;
  swid?: string;
  espnS2?: string;
}
