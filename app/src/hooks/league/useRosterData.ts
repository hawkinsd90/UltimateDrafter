import { useState, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import type { ImportedMember } from '../../components/league/ImportedLeaguematesPanel';
import type { Database } from '../../types/supabase';
import { loadTeamRoster } from '../../utils/loadRoster';

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

    const result = await loadTeamRoster(member, leagueId);

    setPlayers(result.players);
    setLocalOrder(result.players.map(p => p.id));
    setRosterEmpty(result.rosterEmpty);
    setFetchError(result.error);
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
