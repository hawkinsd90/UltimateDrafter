// Persists a normalized historical season into the database.
//
// Safe re-import strategy:
//   1. Create an import_run record at the start
//   2. Call the save_historical_season RPC function which performs the entire
//      season replacement atomically in a single Postgres transaction
//   3. If the RPC succeeds, update import_run to "success" or "partial"
//   4. If the RPC fails, the transaction rolls back — previous data is preserved
//
// Manager identity corrections are preserved through re-imports:
//   - Managers are matched only by exact provider owner ID (never by name)
//   - Existing managers and aliases are never deleted or merged
//   - New owner IDs create new managers + aliases
//
// Transaction safety:
//   The save_historical_season function deletes existing child rows and inserts
//   new ones within a single BEGIN/END block. If any insert fails, the entire
//   transaction (including the deletes) rolls back. Previous season data is
//   never left in a partially destroyed state.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type {
  NormalizedHistoricalSeason,
  HistoricalImportSummary,
} from "./historical-types.ts";

export interface SaveHistoryInput {
  leagueId: string;
  externalLinkId: string | null;
  normalized: NormalizedHistoricalSeason;
  callerUserId: string;
  adminClient: SupabaseClient;
}

export async function saveHistoricalSeason(
  input: SaveHistoryInput
): Promise<HistoricalImportSummary> {
  const { leagueId, externalLinkId, normalized, callerUserId, adminClient } = input;
  const { seasonYear, externalLeagueId } = normalized;

  // ── 1. Create import run ────────────────────────────────────────────────────
  const { data: importRun, error: runErr } = await adminClient
    .from("league_history_import_runs")
    .insert({
      league_id: leagueId,
      season_year: seasonYear,
      provider: normalized.provider,
      external_league_id: externalLeagueId,
      status: "running",
      started_by: callerUserId,
      diagnostics: {},
    })
    .select("id")
    .single();

  if (runErr || !importRun) {
    throw new Error("Failed to create import run: " + (runErr?.message ?? "unknown"));
  }

  const importRunId = importRun.id;

  try {
    // ── 2. Build JSONB payload for the atomic RPC ──────────────────────────────
    const payload = {
      displayName: normalized.displayName,
      numTeams: normalized.numTeams,
      scoringType: normalized.scoringType,
      rawSettings: normalized.rawSettings,
      rawScoring: normalized.rawScoring,
      completeness: normalized.completeness,
      warnings: normalized.warnings,
      teams: normalized.teams.map((t) => ({
        externalTeamId: t.externalTeamId,
        teamName: t.teamName,
        teamAbbrev: t.teamAbbrev,
        owners: t.owners,
        primaryOwner: t.primaryOwner,
        wins: t.wins,
        losses: t.losses,
        ties: t.ties,
        pointsFor: t.pointsFor,
        pointsAgainst: t.pointsAgainst,
        playoffSeed: t.playoffSeed,
        finalStanding: t.finalStanding,
        eliminated: t.eliminated,
        eliminationPeriod: t.eliminationPeriod,
        rawTeamData: t.rawTeamData,
      })),
      matchups: normalized.matchups.map((m) => ({
        sourceMatchupId: m.sourceMatchupId,
        matchupPeriod: m.matchupPeriod,
        classification: m.classification,
        homeTeamId: m.homeTeamId,
        awayTeamId: m.awayTeamId,
        homeScore: m.homeScore,
        awayScore: m.awayScore,
        winner: m.winner,
        rawMatchupData: m.rawMatchupData,
      })),
      draft: normalized.draft ? {
        draftType: normalized.draft.draftType,
        numRounds: normalized.draft.numRounds,
        numPicks: normalized.draft.numPicks,
        completedAt: normalized.draft.completedAt,
        picks: normalized.draft.picks.map((p) => ({
          overallPickNumber: p.overallPickNumber,
          roundNumber: p.roundNumber,
          roundPickNumber: p.roundPickNumber,
          teamId: p.teamId,
          externalPlayerId: p.externalPlayerId,
          playerName: p.playerName,
          isKeeper: p.isKeeper,
          auctionBidAmount: p.auctionBidAmount,
          rawPickData: p.rawPickData,
        })),
        rawDraftDetail: normalized.draft.rawDraftDetail,
      } : null,
    };

    // ── 3. Call atomic save function ───────────────────────────────────────────
    const { data: result, error: rpcErr } = await adminClient
      .rpc("save_historical_season", {
        p_league_id: leagueId,
        p_season_year: seasonYear,
        p_data: payload,
        p_caller_user_id: callerUserId,
        p_external_link_id: externalLinkId,
        p_provider: normalized.provider,
        p_external_league_id: externalLeagueId,
      });

    if (rpcErr || !result) {
      throw new Error("Atomic save failed: " + (rpcErr?.message ?? "no result returned"));
    }

    const summary = result as Record<string, unknown>;
    const seasonId = summary.seasonId as string;
    const warnings = (Array.isArray(summary.warnings) ? summary.warnings : []) as string[];

    // ── 4. Update import run ───────────────────────────────────────────────────
    const runStatus = warnings.length > 0 ? "partial" : "success";

    await adminClient
      .from("league_history_import_runs")
      .update({
        status: runStatus,
        season_id: seasonId,
        diagnostics: {
          teamsImported: summary.teamsImported,
          matchupsImported: summary.matchupsImported,
          draftPicksImported: summary.draftPicksImported,
          managersMatched: summary.managersMatched,
          managersCreated: summary.managersCreated,
          warnings,
        },
        completed_at: new Date().toISOString(),
      })
      .eq("id", importRunId);

    return {
      success: true,
      seasonId,
      seasonYear,
      displayName: summary.displayName as string,
      teamsImported: summary.teamsImported as number,
      matchupsImported: summary.matchupsImported as number,
      draftPicksImported: summary.draftPicksImported as number,
      managersMatched: summary.managersMatched as number,
      managersCreated: summary.managersCreated as number,
      completeness: normalized.completeness,
      warnings,
    };

  } catch (err) {
    await adminClient
      .from("league_history_import_runs")
      .update({
        status: "failed",
        error_message: err instanceof Error ? err.message : String(err),
        completed_at: new Date().toISOString(),
      })
      .eq("id", importRunId);
    throw err;
  }
}
