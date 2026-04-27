// Provider-neutral normalization utilities.
// ESPN slot ID map, Sleeper position array parser, scoring type detection.

import type { NormalizedRosterSettings, ScoringType } from "./types.ts";

// ── ESPN lineup slot ID → roster position name ───────────────────────────────
// Source: ESPN Fantasy API v3 lineup slot definitions.
// Only slots relevant to fantasy football are mapped.
const ESPN_SLOT_MAP: Record<number, keyof NormalizedRosterSettings> = {
  0:  "qb",
  2:  "rb",
  4:  "wr",
  6:  "te",
  16: "dst",
  17: "k",
  20: "bench",
  21: "ir",
  23: "flex",
  24: "taxi",
};

// ESPN defaultPositionId → fantasy position string
const ESPN_POSITION_MAP: Record<number, string> = {
  1:  "QB",
  2:  "RB",
  3:  "WR",
  4:  "TE",
  5:  "K",
  16: "DST",
};

export function espnPositionLabel(defaultPositionId: unknown): string | undefined {
  if (typeof defaultPositionId !== "number") return undefined;
  return ESPN_POSITION_MAP[defaultPositionId];
}

// Build NormalizedRosterSettings from ESPN lineupSlotCounts map.
// lineupSlotCounts keys are string slot IDs; values are counts.
export function espnRosterSettings(
  lineupSlotCounts: Record<string, unknown> | undefined
): NormalizedRosterSettings {
  const settings = emptyRosterSettings();
  if (!lineupSlotCounts) return settings;

  for (const [slotIdStr, countRaw] of Object.entries(lineupSlotCounts)) {
    const slotId = Number(slotIdStr);
    const count = typeof countRaw === "number" ? countRaw : 0;
    const key = ESPN_SLOT_MAP[slotId];
    if (key && count > 0) {
      settings[key] += count;
    }
  }
  return settings;
}

// ── Sleeper roster_positions array → NormalizedRosterSettings ────────────────
// roster_positions is an array like ['QB','RB','RB','WR','WR','TE','FLEX','K','DEF','BN','BN','IR']
const SLEEPER_POSITION_MAP: Record<string, keyof NormalizedRosterSettings> = {
  QB:   "qb",
  RB:   "rb",
  WR:   "wr",
  TE:   "te",
  FLEX: "flex",
  REC_FLEX: "flex",
  SUPER_FLEX: "flex",
  K:    "k",
  DEF:  "dst",
  DL:   "dst",
  BN:   "bench",
  IR:   "ir",
  TAXI: "taxi",
};

export function sleeperRosterSettings(
  rosterPositions: unknown
): NormalizedRosterSettings {
  const settings = emptyRosterSettings();
  if (!Array.isArray(rosterPositions)) return settings;

  for (const pos of rosterPositions) {
    if (typeof pos !== "string") continue;
    const key = SLEEPER_POSITION_MAP[pos.toUpperCase()];
    if (key) settings[key] += 1;
  }
  return settings;
}

function emptyRosterSettings(): NormalizedRosterSettings {
  return { qb: 0, rb: 0, wr: 0, te: 0, flex: 0, k: 0, dst: 0, bench: 0, ir: 0, taxi: 0 };
}

// ── Scoring type detection ────────────────────────────────────────────────────

// ESPN: scoring settings is an array of { statId, pointsPerEvent } objects.
// Reception stat IDs that indicate PPR: 53 (receiving receptions in modern ESPN API).
// ESPN also uses a flat map format in some API versions — handle both shapes.
export function espnScoringType(scoringSettings: unknown): ScoringType {
  if (!scoringSettings) return "standard";

  // Flat map shape: { "53": 1.0, ... }
  if (typeof scoringSettings === "object" && !Array.isArray(scoringSettings)) {
    const map = scoringSettings as Record<string, unknown>;
    // stat 53 = receiving receptions
    const rec = map["53"];
    if (typeof rec === "number") return recValueToScoringType(rec);
  }

  // Array shape: [{ statId: 53, pointsPerEvent: 1.0 }, ...]
  if (Array.isArray(scoringSettings)) {
    for (const entry of scoringSettings) {
      if (
        typeof entry === "object" &&
        entry !== null &&
        (entry as Record<string, unknown>).statId === 53
      ) {
        const pts = (entry as Record<string, unknown>).pointsPerEvent;
        if (typeof pts === "number") return recValueToScoringType(pts);
      }
    }
  }

  return "custom";
}

// Sleeper: league.scoring_settings.rec
export function sleeperScoringType(scoringSettings: unknown): ScoringType {
  if (typeof scoringSettings !== "object" || scoringSettings === null) return "standard";
  const map = scoringSettings as Record<string, unknown>;
  const rec = map["rec"];
  if (typeof rec !== "number") return "standard";
  return recValueToScoringType(rec);
}

function recValueToScoringType(rec: number): ScoringType {
  if (rec >= 1) return "ppr";
  if (rec >= 0.4) return "half_ppr"; // 0.5 ± small float tolerance
  return "standard";
}

// ── Normalize position strings to fantasy position labels ────────────────────
const POSITION_NORMALIZER: Record<string, string> = {
  QB: "QB", RB: "RB", WR: "WR", TE: "TE",
  K: "K", PK: "K",
  DEF: "DST", DST: "DST", D: "DST",
  // Non-fantasy positions returned as-is (will not match nfl_draft_player_pool)
};

export function normalizePosition(pos: unknown): string | undefined {
  if (typeof pos !== "string" || pos.trim() === "") return undefined;
  return POSITION_NORMALIZER[pos.toUpperCase()] ?? pos.toUpperCase();
}
