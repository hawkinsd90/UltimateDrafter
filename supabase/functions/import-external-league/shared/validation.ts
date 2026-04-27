// Input validation for the import-external-league edge function.
// Validates the raw request body and returns typed params or a clear error string.

import type { ImportMode, ImportRequest, Provider, ProviderParams } from "./types.ts";

const VALID_PROVIDERS: Provider[] = ["espn", "sleeper"];
const VALID_IMPORT_MODES: ImportMode[] = [
  "reference_only",
  "manual_keeper_select",
  "all_rostered_as_keepers",
];

export interface ValidationError {
  status: 400;
  message: string;
}

export function validateRequest(
  body: Record<string, unknown>
): ImportRequest | ValidationError {
  const { draftId, provider, leagueId, season, importMode, isPrivate, swid, espnS2 } = body;

  if (typeof draftId !== "string" || draftId.trim() === "") {
    return error("draftId is required.");
  }
  if (!VALID_PROVIDERS.includes(provider as Provider)) {
    return error(`provider must be one of: ${VALID_PROVIDERS.join(", ")}.`);
  }
  if (typeof leagueId !== "string" || leagueId.trim() === "") {
    return error("leagueId is required.");
  }
  if (typeof season !== "number" || !Number.isInteger(season) || season < 2000 || season > 2100) {
    return error("season must be an integer year (e.g. 2025).");
  }
  if (!VALID_IMPORT_MODES.includes(importMode as ImportMode)) {
    return error(`importMode must be one of: ${VALID_IMPORT_MODES.join(", ")}.`);
  }

  let params: ProviderParams;

  if (provider === "espn") {
    if (isPrivate === true) {
      if (typeof swid !== "string" || swid.trim() === "") {
        return error("swid is required for private ESPN leagues.");
      }
      if (typeof espnS2 !== "string" || espnS2.trim() === "") {
        return error("espnS2 is required for private ESPN leagues.");
      }
      params = {
        provider: "espn",
        leagueId: leagueId.trim(),
        season,
        isPrivate: true,
        swid: swid.trim(),
        espnS2: espnS2.trim(),
      };
    } else {
      params = {
        provider: "espn",
        leagueId: leagueId.trim(),
        season,
        isPrivate: false,
      };
    }
  } else {
    // Sleeper — no credentials
    params = {
      provider: "sleeper",
      leagueId: leagueId.trim(),
      season,
    };
  }

  return {
    draftId: draftId.trim(),
    importMode: importMode as ImportMode,
    params,
  };
}

function error(message: string): ValidationError {
  return { status: 400, message };
}

export function isValidationError(v: unknown): v is ValidationError {
  return typeof v === "object" && v !== null && (v as ValidationError).status === 400;
}
