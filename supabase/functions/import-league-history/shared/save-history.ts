// Persists a normalized historical season into the database.
//
// Safe re-import strategy:
//   1. Find existing season by (league_id, season_year)
//   2. Create an import_run record at the start
//   3. Save managers (auto-match by provider owner ID, never auto-merge by name)
//   4. Save season teams (delete + re-insert for this season only)
//   5. Save matchups (delete + re-insert for this season only)
//   6. Save draft + picks (delete + re-insert for this season only)
//   7. Update season import_status and import_run status
//
// Manager identity corrections are preserved through re-imports:
//   - Managers are matched only by exact provider owner ID (never by name)
//   - Existing managers and aliases are never deleted or merged
//   - New owner IDs create new managers + aliases

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

interface ManagerMatchResult {
  managerId: string;
  aliasId: string;
  isNew: boolean;
}

export async function saveHistoricalSeason(
  input: SaveHistoryInput
): Promise<HistoricalImportSummary> {
  const { leagueId, externalLinkId, normalized, callerUserId, adminClient } = input;
  const { seasonYear, externalLeagueId, teams, matchups, draft, completeness } = normalized;
  const warnings: string[] = [...normalized.warnings];

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
    // ── 2. Upsert season ──────────────────────────────────────────────────────
    const { data: existingSeason } = await adminClient
      .from("league_history_seasons")
      .select("id")
      .eq("league_id", leagueId)
      .eq("season_year", seasonYear)
      .maybeSingle();

    const seasonPayload = {
      league_id: leagueId,
      external_link_id: externalLinkId,
      season_year: seasonYear,
      external_league_id: externalLeagueId,
      display_name: normalized.displayName,
      num_teams: normalized.numTeams,
      scoring_type: normalized.scoringType,
      raw_settings: normalized.rawSettings,
      raw_scoring: normalized.rawScoring,
      import_status: "complete",
      import_completeness: completeness,
      import_errors: warnings,
      imported_at: new Date().toISOString(),
      imported_by: callerUserId,
      updated_at: new Date().toISOString(),
    };

    let seasonId: string;

    if (existingSeason) {
      const { data: updated, error: updErr } = await adminClient
        .from("league_history_seasons")
        .update(seasonPayload)
        .eq("id", existingSeason.id)
        .select("id")
        .single();
      if (updErr || !updated) throw new Error("Failed to update season: " + (updErr?.message ?? "unknown"));
      seasonId = updated.id;
    } else {
      const { data: created, error: insErr } = await adminClient
        .from("league_history_seasons")
        .insert(seasonPayload)
        .select("id")
        .single();
      if (insErr || !created) throw new Error("Failed to create season: " + (insErr?.message ?? "unknown"));
      seasonId = created.id;
    }

    // ── 3. Match managers by provider owner ID ────────────────────────────────
    const { results: managerResults, managersCreated, managersMatched } = await matchManagers(
      adminClient,
      leagueId,
      normalized.provider,
      teams,
      warnings
    );

    // Build owner_id → managerId map
    const ownerToManager = new Map<string, ManagerMatchResult>();
    for (const [ownerId, result] of managerResults) {
      ownerToManager.set(ownerId, result);
    }

    // ── 4. Save season teams ──────────────────────────────────────────────────
    // Delete existing teams for this season only (cascade deletes team_managers)
    await adminClient
      .from("league_history_season_teams")
      .delete()
      .eq("season_id", seasonId);

    const teamRows = teams.map((t) => {
      const primaryResult = t.primaryOwner ? ownerToManager.get(t.primaryOwner) : null;
      const primaryManagerId = primaryResult?.managerId ?? null;
      return {
        season_id: seasonId,
        league_id: leagueId,
        external_team_id: t.externalTeamId,
        team_name: t.teamName,
        team_abbrev: t.teamAbbrev,
        primary_manager_id: primaryManagerId,
        wins: t.wins,
        losses: t.losses,
        ties: t.ties,
        points_for: t.pointsFor,
        points_against: t.pointsAgainst,
        playoff_seed: t.playoffSeed,
        final_standing: t.finalStanding,
        is_champion: t.finalStanding === 1,
        is_runner_up: t.finalStanding === 2,
        eliminated: t.eliminated,
        elimination_period: t.eliminationPeriod,
        raw_team_data: t.rawTeamData,
      };
    });

    if (teamRows.length > 0) {
      const { error: teamInsErr } = await adminClient
        .from("league_history_season_teams")
        .insert(teamRows);
      if (teamInsErr) throw new Error("Failed to insert season teams: " + teamInsErr.message);
    }

    // Fetch inserted teams to get UUIDs for FK references
    const { data: insertedTeams } = await adminClient
      .from("league_history_season_teams")
      .select("id, external_team_id")
      .eq("season_id", seasonId);

    const teamIdMap = new Map<string, string>();
    for (const t of insertedTeams ?? []) {
      teamIdMap.set(t.external_team_id as string, t.id as string);
    }

    // ── 5. Save team_managers (co-manager associations) ───────────────────────
    const teamManagerRows: Record<string, unknown>[] = [];
    for (const t of teams) {
      const seasonTeamId = teamIdMap.get(t.externalTeamId);
      if (!seasonTeamId) continue;

      for (const ownerId of t.owners) {
        const result = ownerToManager.get(ownerId);
        if (!result) continue;
        const isPrimary = ownerId === t.primaryOwner;
        teamManagerRows.push({
          season_team_id: seasonTeamId,
          manager_id: result.managerId,
          role: isPrimary ? "primary" : "co_manager",
        });
      }
    }

    if (teamManagerRows.length > 0) {
      const { error: tmErr } = await adminClient
        .from("league_history_team_managers")
        .upsert(teamManagerRows, {
          onConflict: "season_team_id,manager_id",
          ignoreDuplicates: true,
        });
      if (tmErr) warnings.push("Could not save some team_manager associations: " + tmErr.message);
    }

    // ── 6. Save matchups ──────────────────────────────────────────────────────
    await adminClient
      .from("league_history_matchups")
      .delete()
      .eq("season_id", seasonId);

    const matchupRows = matchups.map((m) => ({
      season_id: seasonId,
      league_id: leagueId,
      source_matchup_id: m.sourceMatchupId,
      matchup_period: m.matchupPeriod,
      classification: m.classification,
      home_team_id: m.homeTeamId ? (teamIdMap.get(m.homeTeamId) ?? null) : null,
      away_team_id: m.awayTeamId ? (teamIdMap.get(m.awayTeamId) ?? null) : null,
      home_score: m.homeScore,
      away_score: m.awayScore,
      winner: m.winner,
      raw_matchup_data: m.rawMatchupData,
    }));

    if (matchupRows.length > 0) {
      const BATCH = 200;
      for (let i = 0; i < matchupRows.length; i += BATCH) {
        const batch = matchupRows.slice(i, i + BATCH);
        const { error: mErr } = await adminClient
          .from("league_history_matchups")
          .insert(batch);
        if (mErr) throw new Error(`Failed to insert matchups (batch ${i}): ${mErr.message}`);
      }
    }

    // ── 7. Save draft + picks ─────────────────────────────────────────────────
    let draftPicksImported = 0;

    if (draft) {
      await adminClient
        .from("league_history_drafts")
        .delete()
        .eq("season_id", seasonId);

      const draftRow = {
        season_id: seasonId,
        league_id: leagueId,
        draft_type: draft.draftType,
        num_rounds: draft.numRounds,
        num_picks: draft.numPicks,
        completed_at: draft.completedAt
          ? new Date(draft.completedAt).toISOString()
          : null,
        raw_draft_detail: draft.rawDraftDetail,
      };

      const { data: insertedDraft, error: dErr } = await adminClient
        .from("league_history_drafts")
        .insert(draftRow)
        .select("id")
        .single();

      if (dErr || !insertedDraft) {
        warnings.push("Failed to save draft: " + (dErr?.message ?? "unknown"));
      } else {
        const draftId = insertedDraft.id;

        const pickRows = draft.picks.map((p) => ({
          draft_id: draftId,
          season_id: seasonId,
          league_id: leagueId,
          overall_pick_number: p.overallPickNumber,
          round_number: p.roundNumber,
          round_pick_number: p.roundPickNumber,
          team_id: p.teamId ? (teamIdMap.get(p.teamId) ?? null) : null,
          external_team_id: p.teamId || null,
          external_player_id: p.externalPlayerId,
          player_name: p.playerName || null,
          player_position: null,
          is_keeper: p.isKeeper,
          auction_bid_amount: p.auctionBidAmount,
          raw_pick_data: p.rawPickData,
        }));

        if (pickRows.length > 0) {
          const BATCH = 200;
          for (let i = 0; i < pickRows.length; i += BATCH) {
            const batch = pickRows.slice(i, i + BATCH);
            const { error: pErr } = await adminClient
              .from("league_history_draft_picks")
              .insert(batch);
            if (pErr) {
              warnings.push(`Failed to insert some draft picks (batch ${i}): ${pErr.message}`);
              break;
            }
          }
          draftPicksImported = pickRows.length;
        }
      }
    }

    // ── 8. Update import run ──────────────────────────────────────────────────
    const runStatus = warnings.length > 0 ? "partial" : "success";

    await adminClient
      .from("league_history_import_runs")
      .update({
        status: runStatus,
        season_id: seasonId,
        diagnostics: {
          teamsImported: teamRows.length,
          matchupsImported: matchupRows.length,
          draftPicksImported,
          managersMatched,
          managersCreated,
          warnings,
        },
        completed_at: new Date().toISOString(),
      })
      .eq("id", importRunId);

    return {
      success: true,
      seasonId,
      seasonYear,
      displayName: normalized.displayName,
      teamsImported: teamRows.length,
      matchupsImported: matchupRows.length,
      draftPicksImported,
      managersMatched,
      managersCreated,
      completeness,
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

// ── Manager matching ──────────────────────────────────────────────────────────
// Match ESPN owner GUIDs to existing league_history_managers via aliases.
// If no match is found, create a new manager + alias.
// Never auto-merge by name — only by exact provider owner ID.
async function matchManagers(
  adminClient: SupabaseClient,
  leagueId: string,
  provider: string,
  teams: { owners: string[]; primaryOwner: string | null }[],
  warnings: string[]
): Promise<{ results: Map<string, ManagerMatchResult>; managersCreated: number; managersMatched: number }> {
  const allOwnerIds = new Set<string>();
  for (const t of teams) {
    for (const o of t.owners) {
      allOwnerIds.add(o);
    }
  }

  const results = new Map<string, ManagerMatchResult>();
  let managersCreated = 0;
  let managersMatched = 0;

  if (allOwnerIds.size === 0) return { results, managersCreated, managersMatched };

  // Load existing managers for this league
  const { data: existingManagers } = await adminClient
    .from("league_history_managers")
    .select("id, display_name")
    .eq("league_id", leagueId);

  const managerIds = (existingManagers ?? []).map((m) => m.id as string);

  // Query existing aliases for these managers + provider
  let existingAliases: { id: string; manager_id: string; external_owner_id: string }[] = [];
  if (managerIds.length > 0) {
    const { data: aliases } = await adminClient
      .from("league_history_manager_aliases")
      .select("id, manager_id, external_owner_id")
      .eq("provider", provider)
      .in("manager_id", managerIds);

    existingAliases = (aliases ?? []) as { id: string; manager_id: string; external_owner_id: string }[];
  }

  const aliasByOwnerId = new Map<string, { aliasId: string; managerId: string }>();
  for (const a of existingAliases) {
    aliasByOwnerId.set(a.external_owner_id, { aliasId: a.id, managerId: a.manager_id });
  }

  for (const ownerId of allOwnerIds) {
    const existing = aliasByOwnerId.get(ownerId);
    if (existing) {
      results.set(ownerId, {
        managerId: existing.managerId,
        aliasId: existing.aliasId,
        isNew: false,
      });
      managersMatched++;
      continue;
    }

    // No match — create new manager + alias
    const { data: newManager, error: mErr } = await adminClient
      .from("league_history_managers")
      .insert({ league_id: leagueId, display_name: ownerId })
      .select("id")
      .single();

    if (mErr || !newManager) {
      warnings.push("Failed to create manager for owner " + ownerId + ": " + (mErr?.message ?? "unknown"));
      continue;
    }

    const { data: newAlias, error: aErr } = await adminClient
      .from("league_history_manager_aliases")
      .insert({
        manager_id: newManager.id,
        provider,
        external_owner_id: ownerId,
        display_name: ownerId,
        match_method: "auto_id",
        match_confidence: 1.0,
      })
      .select("id")
      .single();

    if (aErr || !newAlias) {
      warnings.push("Failed to create alias for owner " + ownerId + ": " + (aErr?.message ?? "unknown"));
      continue;
    }

    results.set(ownerId, { managerId: newManager.id, aliasId: newAlias.id, isNew: true });
    managersCreated++;
  }

  return { results, managersCreated, managersMatched };
}
