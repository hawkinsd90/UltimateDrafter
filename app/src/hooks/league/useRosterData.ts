import { useState, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import type { ImportedMember } from '../../components/league/ImportedLeaguematesPanel';
import type { Database } from '../../types/supabase';
import { loadTeamRoster } from '../../utils/loadRoster';
import { parseLeagueBaseYear } from '../../utils/season';

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

export interface DraftPickAsset {
  id:                string;
  leagueId:          string;
  seasonYear:        number;
  roundNumber:       number;
  originalMemberId:  string;
  currentMemberId:   string;
  status:            'available' | 'used';
  originalTeamName:  string | null;
  currentTeamName:   string | null;
}

export type PicksState =
  | { kind: 'loading' }
  | { kind: 'no_member' }
  | { kind: 'not_in_league' }
  | { kind: 'no_draft_order' }
  | { kind: 'order_incomplete' }
  | { kind: 'projected'; picks: DraftPick[]; pickAssets: DraftPickAsset[] }
  | { kind: 'actual';    picks: DraftPick[]; draftName: string; pickAssets: DraftPickAsset[] };

export async function loadTradeablePickAssets(
  leagueId: string,
  memberId: string,
): Promise<DraftPickAsset[]> {
  const { data: assets, error: assetsErr } = await supabase
    .from('league_draft_pick_assets')
    .select('id, league_id, season_year, round_number, original_member_id, current_member_id, status')
    .eq('league_id', leagueId)
    .eq('current_member_id', memberId)
    .eq('status', 'available')
    .order('season_year', { ascending: true })
    .order('round_number', { ascending: true });

  if (assetsErr || !assets) return [];

  const memberIds = new Set<string>();
  for (const a of assets) {
    memberIds.add(a.original_member_id);
    memberIds.add(a.current_member_id);
  }

  const { data: memberRows } = await supabase
    .from('league_members')
    .select('id, user_id')
    .in('id', Array.from(memberIds));

  const { data: importedRows } = await supabase
    .from('league_imported_members')
    .select('invited_user_id, team_name')
    .eq('league_id', leagueId);

  const teamNameByMemberId = new Map<string, string>();
  for (const lm of memberRows ?? []) {
    const imp = (importedRows ?? []).find(im => im.invited_user_id === lm.user_id);
    if (imp) teamNameByMemberId.set(lm.id, imp.team_name);
  }

  return assets.map(a => ({
    id:                a.id,
    leagueId:          a.league_id,
    seasonYear:        a.season_year,
    roundNumber:       a.round_number,
    originalMemberId:  a.original_member_id,
    currentMemberId:   a.current_member_id,
    status:            a.status as 'available' | 'used',
    originalTeamName:  teamNameByMemberId.get(a.original_member_id) ?? null,
    currentTeamName:   teamNameByMemberId.get(a.current_member_id) ?? null,
  }));
}

export async function loadAllPickAssets(
  leagueId: string,
  memberId: string,
): Promise<DraftPickAsset[]> {
  const { data: assets, error: assetsErr } = await supabase
    .from('league_draft_pick_assets')
    .select('id, league_id, season_year, round_number, original_member_id, current_member_id, status')
    .eq('league_id', leagueId)
    .eq('current_member_id', memberId)
    .order('season_year', { ascending: true })
    .order('round_number', { ascending: true });

  if (assetsErr || !assets) return [];

  const memberIds = new Set<string>();
  for (const a of assets) {
    memberIds.add(a.original_member_id);
    memberIds.add(a.current_member_id);
  }

  const { data: memberRows } = await supabase
    .from('league_members')
    .select('id, user_id')
    .in('id', Array.from(memberIds));

  const { data: importedRows } = await supabase
    .from('league_imported_members')
    .select('invited_user_id, team_name')
    .eq('league_id', leagueId);

  const teamNameByMemberId = new Map<string, string>();
  for (const lm of memberRows ?? []) {
    const imp = (importedRows ?? []).find(im => im.invited_user_id === lm.user_id);
    if (imp) teamNameByMemberId.set(lm.id, imp.team_name);
  }

  return assets.map(a => ({
    id:                a.id,
    leagueId:          a.league_id,
    seasonYear:        a.season_year,
    roundNumber:       a.round_number,
    originalMemberId:  a.original_member_id,
    currentMemberId:   a.current_member_id,
    status:            a.status as 'available' | 'used',
    originalTeamName:  teamNameByMemberId.get(a.original_member_id) ?? null,
    currentTeamName:   teamNameByMemberId.get(a.current_member_id) ?? null,
  }));
}

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

    const leagueDraftType  = leagueSettings?.default_draft_type ?? 'snake';
    const leagueRounds     = leagueSettings?.default_rounds ?? 15;
    const allowFuturePicks = leagueSettings?.allow_future_picks ?? false;

    // Fetch league season to derive base year
    const { data: leagueRow } = await supabase
      .from('leagues')
      .select('season')
      .eq('id', leagueId)
      .maybeSingle();

    const baseYear = leagueRow?.season
      ? parseLeagueBaseYear(leagueRow.season)
      : null;

    if (baseYear === null) {
      setPicksState({ kind: 'not_in_league' });
      setFetchError(`Cannot parse league season "${leagueRow?.season ?? ''}". Expected format like "2026-27" or "2026".`);
      return;
    }

    // Resolve the member's league_member_id for pick-asset queries
    const { data: myLeagueMemberRow } = await supabase
      .from('league_members')
      .select('id')
      .eq('league_id', leagueId)
      .eq('user_id', member.invitedUserId)
      .maybeSingle();

    // Ensure pick assets exist for this league before loading (if future picks enabled)
    let pickAssets: DraftPickAsset[] = [];
    if (allowFuturePicks && myLeagueMemberRow?.id) {
      if (baseYear !== null) {
        await supabase.rpc('ensure_league_future_pick_assets', { p_league_id: leagueId });
      }
      pickAssets = await loadAllPickAssets(leagueId, myLeagueMemberRow.id);
    }

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
          picks.push({ round, pick, overall, draftName: relevantDraft.name ?? 'Draft', year: baseYear });
        }
        setPicksState({ kind: 'actual', picks, draftName: relevantDraft.name ?? 'Draft', pickAssets });
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

    const totalTeams = totalMembers;
    const myPos      = myLeagueMember.draft_order;
    const isSnake    = leagueDraftType === 'snake';
    const picks: DraftPick[] = [];

    for (let round = 1; round <= leagueRounds; round++) {
      const pick    = isSnake && round % 2 === 0 ? totalTeams + 1 - myPos : myPos;
      const overall = (round - 1) * totalTeams + pick;
      picks.push({ round, pick, overall, draftName: 'Projected', year: baseYear });
    }

    setPicksState({ kind: 'projected', picks, pickAssets });
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
