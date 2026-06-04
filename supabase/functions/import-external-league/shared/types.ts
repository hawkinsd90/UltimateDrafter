// Shared types for the import-external-league edge function.
// All providers must produce NormalizedImport. No credentials ever appear here.

export type ImportMode =
  | "reference_only"
  | "manual_keeper_select"
  | "all_rostered_as_keepers";

export type Provider = "espn" | "sleeper";

export type ScoringType = "standard" | "ppr" | "half_ppr" | "custom";

// ── Input from client ────────────────────────────────────────────────────────

export type ProviderParams =
  | {
      provider: "sleeper";
      leagueId: string;
      season: number;
    }
  | {
      provider: "espn";
      leagueId: string;
      season: number;
      isPrivate: false;
    }
  | {
      provider: "espn";
      leagueId: string;
      season: number;
      isPrivate: true;
      swid: string;
      espnS2: string;
    };

export interface ImportRequest {
  draftId: string;
  importMode: ImportMode;
  params: ProviderParams;
}

// ── Normalized output shape (provider-neutral) ───────────────────────────────

export interface NormalizedRosterSettings {
  qb: number;
  rb: number;
  wr: number;
  te: number;
  flex: number;
  op: number;
  k: number;
  dst: number;
  bench: number;
  ir: number;
  taxi: number;
  // True when the provider supplied explicit per-position limits (e.g. ESPN positionLimits).
  // False for providers that have no concept of per-position caps (e.g. Sleeper).
  // save-import.ts uses this to decide whether to use max_* as-is or derive fallbacks.
  hasExplicitPositionLimits: boolean;
  // Per-position draft maximums. null = "no limit" per the provider. Only meaningful when
  // hasExplicitPositionLimits is true.
  max_qb: number | null;
  max_rb: number | null;
  max_wr: number | null;
  max_te: number | null;
  max_k:  number | null;
  max_dst: number | null;
}

export interface NormalizedLeague {
  externalLeagueId: string;
  externalSeason: number;
  displayName: string;
  numTeams: number;
  scoringType: ScoringType;
  rosterSettings: NormalizedRosterSettings;
  rawScoringSettings: Record<string, unknown>;
  providerVersion: string;
}

export interface NormalizedTeam {
  externalTeamId: string;
  externalOwnerId?: string;
  externalOwnerName?: string;
  teamName: string;
}

export interface NormalizedRosterPlayer {
  externalPlayerId: string;
  externalTeamId: string;
  playerName: string;
  position?: string;
  // Provider-specific debug data. Must never contain credentials.
  externalData?: Record<string, unknown>;
}

export interface NormalizedImport {
  league: NormalizedLeague;
  teams: NormalizedTeam[];
  rosters: NormalizedRosterPlayer[];
  warnings: string[];
}

// ── Player mapping result ────────────────────────────────────────────────────

export type MappingMethod = "auto_id" | "auto_name" | "fuzzy" | "manual";

export type ResolutionStatus = "unresolved" | "matched" | "manual" | "skipped";

export interface PlayerMappingResult {
  externalPlayerId: string;
  externalTeamId: string;
  playerName: string;
  position?: string;
  externalData?: Record<string, unknown>;
  sportsPlayerId: string | null;
  resolutionStatus: ResolutionStatus;
  mappingMethod?: MappingMethod;
  confidence?: number;
}

// ── Safe import summary returned to client ───────────────────────────────────

export interface ImportSummary {
  success: true;
  linkId: string;
  provider: Provider;
  externalLeagueId: string;
  displayName: string;
  numTeams: number;
  teamsImported: number;
  rosterPlayersImported: number;
  matchedPlayers: number;
  unresolvedPlayers: number;
  scoringType: ScoringType;
  rosterSettings: NormalizedRosterSettings;
  warnings: string[];
}
