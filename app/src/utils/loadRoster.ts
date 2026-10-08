import { supabase } from '../lib/supabase';
import type { ImportedMember } from '../components/league/ImportedLeaguematesPanel';
import type { RosterPlayer } from '../hooks/league/useRosterData';
import { POS_PRIORITY } from './rosterSlots';

interface PlayerDetail {
  display_name: string;
  fantasy_position: string | null;
  team_abbr: string | null;
}

async function resolvePlayerDetails(
  sportsPlayerIds: string[],
): Promise<Map<string, PlayerDetail>> {
  const detailMap = new Map<string, PlayerDetail>();
  if (sportsPlayerIds.length === 0) return detailMap;

  const { data: poolRows } = await supabase
    .from('nfl_draft_player_pool')
    .select('id, display_name, fantasy_position, team_abbr')
    .in('id', sportsPlayerIds);
  for (const sp of poolRows ?? []) {
    detailMap.set(sp.id, {
      display_name: sp.display_name,
      fantasy_position: sp.fantasy_position,
      team_abbr: sp.team_abbr,
    });
  }

  const missingIds = sportsPlayerIds.filter(id => !detailMap.has(id));
  if (missingIds.length > 0) {
    const { data: spRows } = await supabase
      .from('sports_players')
      .select('id, display_name, fantasy_position, team:sports_teams(abbreviation)')
      .in('id', missingIds);
    for (const sp of spRows ?? []) {
      detailMap.set(sp.id, {
        display_name: sp.display_name,
        fantasy_position: sp.fantasy_position,
        team_abbr: (sp.team as unknown as { abbreviation: string | null } | null)?.abbreviation ?? null,
      });
    }
  }

  return detailMap;
}

export interface LoadRosterResult {
  players: RosterPlayer[];
  rosterEmpty: boolean;
  error: string;
}

export async function loadTeamRoster(
  member: ImportedMember,
  leagueId: string,
): Promise<LoadRosterResult> {
  const empty: LoadRosterResult = { players: [], rosterEmpty: true, error: '' };

  // Path 1: app-owned rows from league_roster_players
  const { data: appRows, error: appErr } = await supabase
    .from('league_roster_players')
    .select('id, sports_player_id, external_player_name, external_position, sort_order')
    .eq('imported_member_id', member.id)
    .eq('roster_status', 'active')
    .order('sort_order', { ascending: true });

  if (!appErr && appRows && appRows.length > 0) {
    const resolvedIds = appRows
      .filter(r => r.sports_player_id)
      .map(r => r.sports_player_id as string);
    const detailMap = await resolvePlayerDetails(resolvedIds);

    const resolved: RosterPlayer[] = appRows.map(row => {
      const detail = row.sports_player_id ? detailMap.get(row.sports_player_id) : null;
      return {
        id: row.id,
        lrpId: row.id,
        sportsPlayerId: row.sports_player_id ?? null,
        displayName: detail?.display_name ?? row.external_player_name ?? 'Unknown',
        fantasyPosition: detail?.fantasy_position ?? row.external_position ?? null,
        teamAbbr: detail?.team_abbr ?? null,
        resolutionStatus: row.sports_player_id ? 'matched' : 'unresolved',
        unresolved: !row.sports_player_id,
      };
    });

    const resolvedPlayers = resolved.filter(p => !p.unresolved);
    const unresolvedPlayers = resolved.filter(p => p.unresolved);
    const ordered = [...resolvedPlayers, ...unresolvedPlayers];
    return { players: ordered, rosterEmpty: false, error: '' };
  }

  // Path 2: fall back to external_roster_players via import chain
  if (!member.externalTeamId || !member.externalLeagueId) {
    return empty;
  }

  const { data: links, error: linksErr } = await supabase
    .from('external_league_links')
    .select('id, provider, external_league_id, import_status')
    .eq('league_id', leagueId);

  if (linksErr) return { players: [], rosterEmpty: false, error: 'Could not load import data.' };

  const matchingLink = (links ?? []).find(
    l => l.provider === member.provider && l.external_league_id === member.externalLeagueId,
  );
  if (!matchingLink) return empty;

  const { data: teamRow, error: teamErr } = await supabase
    .from('external_league_teams')
    .select('link_id, external_team_id, mapping_status')
    .eq('link_id', matchingLink.id)
    .eq('external_team_id', member.externalTeamId)
    .maybeSingle();

  if (teamErr) return { players: [], rosterEmpty: false, error: 'Could not load team data.' };
  if (!teamRow) return empty;

  const { data: rosterRows, error: rosterErr } = await supabase
    .from('external_roster_players')
    .select('id, external_player_name, external_position, sports_player_id, resolution_status')
    .eq('link_id', teamRow.link_id)
    .eq('external_team_id', teamRow.external_team_id);

  if (rosterErr) return { players: [], rosterEmpty: false, error: 'Could not load roster players.' };
  if (!rosterRows || rosterRows.length === 0) return empty;

  const resolvedIds = rosterRows
    .filter(r => r.sports_player_id)
    .map(r => r.sports_player_id as string);
  const detailMap = await resolvePlayerDetails(resolvedIds);

  const resolved: RosterPlayer[] = rosterRows.map(row => {
    const detail = row.sports_player_id ? detailMap.get(row.sports_player_id) : null;
    return {
      id: row.id,
      lrpId: null,
      sportsPlayerId: row.sports_player_id ?? null,
      displayName: detail?.display_name ?? row.external_player_name ?? 'Unknown',
      fantasyPosition: detail?.fantasy_position ?? row.external_position ?? null,
      teamAbbr: detail?.team_abbr ?? null,
      resolutionStatus: row.resolution_status,
      unresolved: !row.sports_player_id,
    };
  });

  resolved.sort((a, b) => {
    if (a.unresolved !== b.unresolved) return a.unresolved ? 1 : -1;
    const ai = POS_PRIORITY.indexOf(a.fantasyPosition ?? '');
    const bi = POS_PRIORITY.indexOf(b.fantasyPosition ?? '');
    if (ai !== bi) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    return a.displayName.localeCompare(b.displayName);
  });

  return { players: resolved, rosterEmpty: false, error: '' };
}
