// Persists a normalized import into the database.
// Supports two paths:
//   Draft path  — draftId is set; writes external_league_links (with draft_id),
//                 draft_scoring_rules, and draft_settings in addition to shared tables.
//   League path — draftId is null; writes external_league_links (draft_id = null),
//                 league_imported_members; skips draft_scoring_rules and draft_settings.
//
// leagueId is always pre-resolved and verified by the access layer before this runs.
// Credentials are never passed here — ownership is re-verified as defense-in-depth.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type {
  ImportMode,
  ImportSummary,
  NormalizedImport,
  PlayerMappingResult,
  Provider,
} from "./types.ts";

export interface SaveImportInput {
  draftId: string | null;
  leagueId: string;
  provider: Provider;
  importMode: ImportMode;
  normalized: NormalizedImport;
  mappedPlayers: PlayerMappingResult[];
  callerUserId: string;
  adminClient: SupabaseClient;
}

export async function saveImport(input: SaveImportInput): Promise<ImportSummary> {
  const {
    draftId,
    leagueId,
    provider,
    importMode,
    normalized,
    mappedPlayers,
    callerUserId,
    adminClient,
  } = input;

  const { league, teams, warnings } = normalized;
  const isDraftPath = draftId !== null;

  // ── 1. Defense-in-depth: re-verify draft status (draft path only) ──────────
  if (isDraftPath) {
    const { data: draft, error: draftErr } = await adminClient
      .from("drafts")
      .select("id, league_id, status")
      .eq("id", draftId)
      .maybeSingle();

    if (draftErr || !draft) throw new Error("Draft not found.");
    if (draft.status !== "pending") throw new Error("Import is only allowed while the draft is pending.");
    if (draft.league_id !== leagueId) throw new Error("Draft does not belong to the expected league.");
  }

  // ── 2. Defense-in-depth: re-verify league ownership ────────────────────────
  const { data: leagueRow, error: leagueErr } = await adminClient
    .from("leagues")
    .select("owner_id")
    .eq("id", leagueId)
    .maybeSingle();

  if (leagueErr || !leagueRow) throw new Error("League not found.");
  if (leagueRow.owner_id !== callerUserId) throw new Error("Only the league owner can import an external league.");

  // ── 3. Find existing link ──────────────────────────────────────────────────
  let existingLink: { id: string; locked_at: string | null } | null = null;

  if (isDraftPath) {
    const { data } = await adminClient
      .from("external_league_links")
      .select("id, locked_at")
      .eq("draft_id", draftId)
      .maybeSingle();
    existingLink = data;
  } else {
    const { data } = await adminClient
      .from("external_league_links")
      .select("id, locked_at")
      .eq("league_id", leagueId)
      .eq("provider", provider)
      .eq("external_league_id", league.externalLeagueId)
      .is("draft_id", null)
      .maybeSingle();
    existingLink = data;
  }

  if (existingLink?.locked_at) {
    throw new Error("This import is locked. Use the re-import flow to replace it.");
  }

  // ── 4. If re-importing, delete child rows so we can insert fresh ───────────
  if (existingLink) {
    await adminClient.from("external_roster_players").delete().eq("link_id", existingLink.id);
    await adminClient.from("external_league_teams").delete().eq("link_id", existingLink.id);
  }

  // ── 5. Upsert external_league_links ────────────────────────────────────────
  // raw_metadata stores only safe, normalized data — never credentials.
  const rawMetadata = {
    leagueName: league.displayName,
    numTeams: league.numTeams,
    scoringType: league.scoringType,
    rosterSettings: league.rosterSettings,
    rawScoringSettings: league.rawScoringSettings,
    providerVersion: league.providerVersion,
    warnings,
  };

  const linkPayload = {
    draft_id: draftId ?? null,
    league_id: leagueId,
    provider,
    external_league_id: league.externalLeagueId,
    external_season: league.externalSeason,
    display_name: league.displayName,
    import_mode: importMode,
    import_status: "imported",
    imported_at: new Date().toISOString(),
    locked_at: null,
    locked_by: null,
    raw_metadata: rawMetadata,
    created_by: callerUserId,
    updated_at: new Date().toISOString(),
  };

  let linkId: string;

  if (existingLink) {
    const { data: updatedLink, error: updateErr } = await adminClient
      .from("external_league_links")
      .update(linkPayload)
      .eq("id", existingLink.id)
      .select("id")
      .single();

    if (updateErr || !updatedLink) {
      throw new Error("Failed to update import link: " + (updateErr?.message ?? "unknown"));
    }
    linkId = updatedLink.id;
  } else {
    const { data: newLink, error: insertErr } = await adminClient
      .from("external_league_links")
      .insert(linkPayload)
      .select("id")
      .single();

    if (insertErr || !newLink) {
      throw new Error("Failed to create import link: " + (insertErr?.message ?? "unknown"));
    }
    linkId = newLink.id;
  }

  // ── 6. Insert external_league_teams ────────────────────────────────────────
  const teamRows = teams.map((t) => ({
    link_id: linkId,
    external_team_id: t.externalTeamId,
    external_owner_id: t.externalOwnerId ?? null,
    external_owner_name: t.externalOwnerName ?? null,
    external_team_name: t.teamName,
    mapping_status: "pending",
    draft_participant_id: null,
    mapped_at: null,
  }));

  if (teamRows.length > 0) {
    const { error: teamErr } = await adminClient.from("external_league_teams").insert(teamRows);
    if (teamErr) throw new Error("Failed to insert imported teams: " + teamErr.message);
  }

  // ── 7. Insert external_roster_players ──────────────────────────────────────
  const rosterRows = mappedPlayers.map((mp) => ({
    link_id: linkId,
    external_team_id: mp.externalTeamId,
    external_player_id: mp.externalPlayerId,
    external_player_name: mp.playerName,
    external_position: mp.position ?? null,
    sports_player_id: mp.sportsPlayerId,
    resolution_status: mp.resolutionStatus,
    resolved_at: mp.sportsPlayerId ? new Date().toISOString() : null,
    // external_data holds provider debug info; credentials must never appear here.
    external_data: mp.externalData ?? null,
  }));

  if (rosterRows.length > 0) {
    const BATCH = 500;
    for (let i = 0; i < rosterRows.length; i += BATCH) {
      const batch = rosterRows.slice(i, i + BATCH);
      const { error: rosterErr } = await adminClient.from("external_roster_players").insert(batch);
      if (rosterErr) {
        throw new Error(`Failed to insert roster players (batch ${i}–${i + batch.length}): ${rosterErr.message}`);
      }
    }
  }

  // ── 8a. Draft path only: upsert draft_scoring_rules ───────────────────────
  if (isDraftPath) {
    const { error: scoringErr } = await adminClient
      .from("draft_scoring_rules")
      .upsert(
        {
          draft_id: draftId,
          link_id: linkId,
          source: "imported",
          scoring_type: league.scoringType,
          raw_scoring: league.rawScoringSettings,
        },
        { onConflict: "draft_id" }
      );

    if (scoringErr) {
      warnings.push("Could not save scoring rules: " + scoringErr.message);
    }
  }

  // ── 8b. League path only: sync league_imported_members ────────────────────
  // This populates the members list so the Roster tab can display per-team
  // rosters immediately after the league-level import completes.
  if (!isDraftPath && teams.length > 0) {
    // Delete existing imported members for this provider/external_league_id combo
    // to ensure a clean replace on re-import.
    await adminClient
      .from("league_imported_members")
      .delete()
      .eq("league_id", leagueId)
      .eq("provider", provider)
      .eq("external_league_id", league.externalLeagueId);

    const memberRows = teams.map((t) => ({
      league_id: leagueId,
      provider,
      external_league_id: league.externalLeagueId,
      external_team_id: t.externalTeamId,
      external_owner_id: t.externalOwnerId ?? null,
      external_owner_name: t.externalOwnerName ?? null,
      team_name: t.teamName,
      invited_user_id: null,
      invite_id: null,
    }));

    const { error: membersErr } = await adminClient
      .from("league_imported_members")
      .insert(memberRows);

    if (membersErr) {
      warnings.push("Could not sync league imported members: " + membersErr.message);
    }
  }

  // ── 9. Sync roster slots to league_settings (both paths) ──────────────────
  const rs = league.rosterSettings;

  const maxLimits = rs.hasExplicitPositionLimits
    ? { max_qb: rs.max_qb, max_rb: rs.max_rb, max_wr: rs.max_wr,
        max_te: rs.max_te, max_k:  rs.max_k,  max_dst: rs.max_dst }
    : { max_qb: rs.qb + rs.op, max_rb: rs.rb + rs.flex, max_wr: rs.wr + rs.flex,
        max_te: rs.te + rs.flex, max_k: rs.k, max_dst: rs.dst };

  const rosterPayload = {
    roster_qb:   rs.qb,
    roster_rb:   rs.rb,
    roster_wr:   rs.wr,
    roster_te:   rs.te,
    roster_flex: rs.flex,
    roster_op:   rs.op,
    roster_k:    rs.k,
    roster_dst:  rs.dst,
    bench:       rs.bench,
    updated_at:  new Date().toISOString(),
    roster_limits_enabled: true,
    ...maxLimits,
  };

  const { error: leagueSettingsErr } = await adminClient
    .from("league_settings")
    .update(rosterPayload)
    .eq("league_id", leagueId);

  if (leagueSettingsErr) {
    warnings.push("Could not update league roster settings: " + leagueSettingsErr.message);
  }

  // ── 10. Draft path only: sync roster slots to draft_settings ──────────────
  if (isDraftPath) {
    const { data: existingSettings } = await adminClient
      .from("draft_settings")
      .select("draft_id")
      .eq("draft_id", draftId)
      .maybeSingle();

    if (existingSettings) {
      const { error: settingsErr } = await adminClient
        .from("draft_settings")
        .update(rosterPayload)
        .eq("draft_id", draftId);
      if (settingsErr) warnings.push("Could not update draft roster settings: " + settingsErr.message);
    } else {
      const { error: settingsErr } = await adminClient
        .from("draft_settings")
        .insert({ draft_id: draftId, created_by: callerUserId, ...rosterPayload });
      if (settingsErr) warnings.push("Could not save draft roster settings: " + settingsErr.message);
    }
  }

  // ── 11. Build summary ──────────────────────────────────────────────────────
  const matchedPlayers   = mappedPlayers.filter((p) => p.resolutionStatus === "matched").length;
  const unresolvedPlayers = mappedPlayers.filter((p) => p.resolutionStatus === "unresolved").length;

  return {
    success: true,
    linkId,
    provider,
    externalLeagueId: league.externalLeagueId,
    displayName: league.displayName,
    numTeams: league.numTeams,
    teamsImported: teamRows.length,
    rosterPlayersImported: rosterRows.length,
    matchedPlayers,
    unresolvedPlayers,
    scoringType: league.scoringType,
    rosterSettings: league.rosterSettings,
    warnings,
  };
}
