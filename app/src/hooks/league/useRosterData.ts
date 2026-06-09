import { useState, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import type { ImportedMember } from '../../components/league/ImportedLeaguematesPanel';
import type { Database } from '../../types/supabase';
import { POS_PRIORITY } from '../../utils/rosterSlots';

type LeagueSettings = Database['public']['Tables']['league_settings']['Row'];

export interface RosterPlayer {
  id:               string;
  lrpId:            string | null;
  sportsPlayerId:   string | null;
  displayName:      string;
  fantasyPosition:  string | null;
  teamAbbr:         string | null;
  resolutionStatus: string;
  unresolved:       boolean;
}

export interface DraftPick {
  round:     number;
  pick:      number;
  overall:   number;
  draftName: string;
  year:      number;
}

export type PicksState =
  | { kind: 'loading' }
  | { kind: 'no_member' }
  | { kind: 'not_in_league' }
  | { kind: 'no_draft_order' }
  | { kind: 'order_incomplete' }
  | { kind: 'projected'; picks: DraftPick[] }
  | { kind: 'actual';    picks: DraftPick[]; draftName: string };

export function useRosterData(leagueId: string, leagueSettings: LeagueSettings | null) {
  const [players, setPlayers]               = useState<RosterPlayer[]>([]);
  const [localOrder, setLocalOrder]         = useState<string[]>([]);
  const [loading, setLoading]               = useState(false);
  const [rosterEmpty, setRosterEmpty]       = useState(false);
  const [fetchError, setFetchError]         = useState('');
  const [picksState, setPicksState]         = useState<PicksState>({ kind: 'loading' });
  const [activeDraftId, setActiveDraftId]   = useState<string | null>(null);
  const [activeDraftStatus, setActiveDraftStatus] = useState<string | null>(null);

  const loadDraftPicks = useCallback(async (member: ImportedMember) => {
    setPicksState({ kind: 'loading' });

    if (!member.invitedUserId) {
      setPicksState({ kind: 'no_member' });
      return;
    }

    const leagueExt = leagueSettings as (LeagueSettings & {
      default_draft_type?: string; default_rounds?: number;
      allow_future_picks?: boolean; future_pick_years?: number;
    }) | null;
    const leagueDraftType  = leagueExt?.default_draft_type ?? 'snake';
    const leagueRounds     = leagueExt?.default_rounds ?? 15;
    const allowFuturePicks = leagueExt?.allow_future_picks ?? false;
    const futurePickYears  = leagueExt?.future_pick_years ?? 1;

    const { data: activeDrafts } = await supabase
      .from('drafts')
      .select('id, name, draft_type, status')
      .eq('league_id', leagueId)
      .in('status', ['pending', 'in_progress', 'paused'])
      .order('created_at', { ascending: false })
      .limit(1);

    let relevantDraft = activeDrafts?.[0] ?? null;

    if (!relevantDraft) {
      const { data: completedDrafts } = await supabase
        .from('drafts')
        .select('id, name, draft_type, status')
        .eq('league_id', leagueId)
        .eq('status', 'completed')
        .order('created_at', { ascending: false })
        .limit(1);
      relevantDraft = completedDrafts?.[0] ?? null;
    }

    setActiveDraftId(relevantDraft?.id ?? null);
    setActiveDraftStatus(relevantDraft?.status ?? null);

    if (relevantDraft) {
      const [participantsRes, draftSettingsRes] = await Promise.all([
        supabase
          .from('draft_participants')
          .select('user_id, draft_position')
          .eq('draft_id', relevantDraft.id)
          .order('draft_position', { ascending: true }),
        supabase
          .from('draft_settings')
          .select('num_rounds, draft_type')
          .eq('draft_id', relevantDraft.id)
          .maybeSingle(),
      ]);

      const participants  = participantsRes.data ?? [];
      const myParticipant = participants.find(p => p.user_id === member.invitedUserId);

      if (myParticipant && myParticipant.draft_position != null) {
        const totalTeams = participants.length || 1;
        const myPos      = myParticipant.draft_position;
        const rounds     = draftSettingsRes.data?.num_rounds ?? leagueRounds;
        const isSnake    = (draftSettingsRes.data?.draft_type ?? relevantDraft.draft_type ?? leagueDraftType) === 'snake';
        const picks: DraftPick[] = [];
        for (let round = 1; round <= rounds; round++) {
          const pick    = isSnake && round % 2 === 0 ? totalTeams + 1 - myPos : myPos;
          const overall = (round - 1) * totalTeams + pick;
          picks.push({ round, pick, overall, draftName: relevantDraft.name ?? 'Draft', year: new Date().getFullYear() });
        }
        setPicksState({ kind: 'actual', picks, draftName: relevantDraft.name ?? 'Draft' });
        return;
      }
    }

    const { data: allMembers } = await supabase
      .from('league_members')
      .select('id, user_id, draft_order')
      .eq('league_id', leagueId)
      .order('draft_order', { ascending: true, nullsFirst: false });

    const members        = allMembers ?? [];
    const totalMembers   = members.length;
    const myLeagueMember = members.find(m => m.user_id === member.invitedUserId);

    if (!myLeagueMember) { setPicksState({ kind: 'not_in_league' }); return; }
    if (myLeagueMember.draft_order == null) { setPicksState({ kind: 'no_draft_order' }); return; }
    if (members.some(m => m.draft_order == null)) { setPicksState({ kind: 'order_incomplete' }); return; }

    const baseYear   = new Date().getFullYear();
    const totalTeams = totalMembers;
    const myPos      = myLeagueMember.draft_order;
    const isSnake    = leagueDraftType === 'snake';
    const picks: DraftPick[] = [];

    for (let round = 1; round <= leagueRounds; round++) {
      const pick    = isSnake && round % 2 === 0 ? totalTeams + 1 - myPos : myPos;
      const overall = (round - 1) * totalTeams + pick;
      picks.push({ round, pick, overall, draftName: 'Projected', year: baseYear });
    }

    if (allowFuturePicks) {
      for (let yo = 1; yo <= futurePickYears; yo++) {
        for (let round = 1; round <= leagueRounds; round++) {
          picks.push({ round, pick: 0, overall: 0, draftName: 'Future', year: baseYear + yo });
        }
      }
    }

    setPicksState({ kind: 'projected', picks });
  }, [leagueId, leagueSettings]);

  const loadRoster = useCallback(async (member: ImportedMember) => {
    setLoading(true);
    setPlayers([]);
    setLocalOrder([]);
    setRosterEmpty(false);
    setFetchError('');

    loadDraftPicks(member);

    const { data: appRows, error: appErr } = await supabase
      .from('league_roster_players')
      .select('id, sports_player_id, external_player_name, external_position, sort_order')
      .eq('imported_member_id', member.id)
      .eq('roster_status', 'active')
      .order('sort_order', { ascending: true });

    if (!appErr && appRows && appRows.length > 0) {
      const resolvedIds = appRows.filter(r => r.sports_player_id).map(r => r.sports_player_id as string);
      const detailMap   = new Map<string, { display_name: string; fantasy_position: string | null; team_abbr: string | null }>();

      if (resolvedIds.length > 0) {
        const { data: poolRows } = await supabase
          .from('nfl_draft_player_pool')
          .select('id, display_name, fantasy_position, team_abbr')
          .in('id', resolvedIds);
        for (const sp of poolRows ?? []) {
          detailMap.set(sp.id, { display_name: sp.display_name, fantasy_position: sp.fantasy_position, team_abbr: sp.team_abbr });
        }
        const missingIds = resolvedIds.filter(id => !detailMap.has(id));
        if (missingIds.length > 0) {
          const { data: spRows } = await supabase
            .from('sports_players')
            .select('id, display_name, fantasy_position, team:sports_teams(abbreviation)')
            .in('id', missingIds);
          for (const sp of spRows ?? []) {
            detailMap.set(sp.id, {
              display_name:     sp.display_name,
              fantasy_position: sp.fantasy_position,
              team_abbr:        (sp.team as unknown as { abbreviation: string | null } | null)?.abbreviation ?? null,
            });
          }
        }
      }

      const resolved: RosterPlayer[] = appRows.map(row => {
        const detail = row.sports_player_id ? detailMap.get(row.sports_player_id) : null;
        return {
          id:               row.id,
          lrpId:            row.id,
          sportsPlayerId:   row.sports_player_id ?? null,
          displayName:      detail?.display_name ?? row.external_player_name ?? 'Unknown',
          fantasyPosition:  detail?.fantasy_position ?? row.external_position ?? null,
          teamAbbr:         detail?.team_abbr ?? null,
          resolutionStatus: row.sports_player_id ? 'matched' : 'unresolved',
          unresolved:       !row.sports_player_id,
        };
      });

      const resolvedPlayers   = resolved.filter(p => !p.unresolved);
      const unresolvedPlayers = resolved.filter(p => p.unresolved);
      const ordered = [...resolvedPlayers, ...unresolvedPlayers];
      setPlayers(ordered);
      setLocalOrder(ordered.map(p => p.id));
      setLoading(false);
      return;
    }

    if (!member.externalTeamId || !member.externalLeagueId) {
      setRosterEmpty(true);
      setLoading(false);
      return;
    }

    const { data: links, error: linksErr } = await supabase
      .from('external_league_links')
      .select('id, provider, external_league_id, import_status')
      .eq('league_id', leagueId);

    if (linksErr) { setFetchError('Could not load import data.'); setLoading(false); return; }

    const matchingLink = (links ?? []).find(
      l => l.provider === member.provider && l.external_league_id === member.externalLeagueId
    );
    if (!matchingLink) { setRosterEmpty(true); setLoading(false); return; }

    const { data: teamRow, error: teamErr } = await supabase
      .from('external_league_teams')
      .select('link_id, external_team_id, mapping_status')
      .eq('link_id', matchingLink.id)
      .eq('external_team_id', member.externalTeamId)
      .maybeSingle();

    if (teamErr) { setFetchError('Could not load team data.'); setLoading(false); return; }
    if (!teamRow) { setRosterEmpty(true); setLoading(false); return; }

    const { data: rosterRows, error: rosterErr } = await supabase
      .from('external_roster_players')
      .select('id, external_player_name, external_position, sports_player_id, resolution_status')
      .eq('link_id', teamRow.link_id)
      .eq('external_team_id', teamRow.external_team_id);

    if (rosterErr) { setFetchError('Could not load roster players.'); setLoading(false); return; }
    if (!rosterRows || rosterRows.length === 0) { setRosterEmpty(true); setLoading(false); return; }

    const resolvedIds = rosterRows.filter(r => r.sports_player_id).map(r => r.sports_player_id as string);
    const detailMap   = new Map<string, { display_name: string; fantasy_position: string | null; team_abbr: string | null }>();

    if (resolvedIds.length > 0) {
      const { data: poolRows } = await supabase
        .from('nfl_draft_player_pool')
        .select('id, display_name, fantasy_position, team_abbr')
        .in('id', resolvedIds);
      for (const sp of poolRows ?? []) {
        detailMap.set(sp.id, { display_name: sp.display_name, fantasy_position: sp.fantasy_position, team_abbr: sp.team_abbr });
      }
      const missingIds = resolvedIds.filter(id => !detailMap.has(id));
      if (missingIds.length > 0) {
        const { data: spRows } = await supabase
          .from('sports_players')
          .select('id, display_name, fantasy_position, team:sports_teams(abbreviation)')
          .in('id', missingIds);
        for (const sp of spRows ?? []) {
          detailMap.set(sp.id, {
            display_name:     sp.display_name,
            fantasy_position: sp.fantasy_position,
            team_abbr:        (sp.team as unknown as { abbreviation: string | null } | null)?.abbreviation ?? null,
          });
        }
      }
    }

    const resolved: RosterPlayer[] = rosterRows.map(row => {
      const detail = row.sports_player_id ? detailMap.get(row.sports_player_id) : null;
      return {
        id:               row.id,
        lrpId:            null,
        sportsPlayerId:   row.sports_player_id ?? null,
        displayName:      detail?.display_name ?? row.external_player_name ?? 'Unknown',
        fantasyPosition:  detail?.fantasy_position ?? row.external_position ?? null,
        teamAbbr:         detail?.team_abbr ?? null,
        resolutionStatus: row.resolution_status,
        unresolved:       !row.sports_player_id,
      };
    });

    resolved.sort((a, b) => {
      if (a.unresolved !== b.unresolved) return a.unresolved ? 1 : -1;
      const ai = POS_PRIORITY.indexOf(a.fantasyPosition ?? '');
      const bi = POS_PRIORITY.indexOf(b.fantasyPosition ?? '');
      if (ai !== bi) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      return a.displayName.localeCompare(b.displayName);
    });

    setPlayers(resolved);
    setLocalOrder(resolved.map(p => p.id));
    setLoading(false);
  }, [leagueId, loadDraftPicks]);

  return {
    players, setPlayers,
    localOrder, setLocalOrder,
    loading,
    rosterEmpty,
    fetchError,
    picksState,
    activeDraftId,
    activeDraftStatus,
    loadRoster,
  };
}
