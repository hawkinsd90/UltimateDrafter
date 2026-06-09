import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import type { ImportedMember } from './ImportedLeaguematesPanel';
import type { Database } from '../../types/supabase';
import PlayerDetailModal from '../draft/PlayerDetailModal';
import { usePlayerDetail } from '../../hooks/draft/usePlayerDetail';

type LeagueMember   = Database['public']['Tables']['league_members']['Row'];
type LeagueSettings = Database['public']['Tables']['league_settings']['Row'];

interface Props {
  leagueId:        string;
  userId:          string;
  isLeagueOwner:   boolean;
  importedMembers: ImportedMember[];
  leagueMembers:   LeagueMember[];
  leagueSettings:  LeagueSettings | null;
  initialMemberId?: string | null;
}

interface RosterPlayer {
  id:               string;  // league_roster_players.id (app path) or external_roster_players.id (fallback)
  lrpId:            string | null; // league_roster_players.id; null in fallback path
  sportsPlayerId:   string | null;
  displayName:      string;
  fantasyPosition:  string | null;
  teamAbbr:         string | null;
  resolutionStatus: string;
  unresolved:       boolean;
}

interface RosterSlot {
  label:        string;
  displayLabel: string;
  section:      'starters' | 'bench';
}

interface DraftPick {
  round:     number;
  pick:      number;
  overall:   number;
  draftName: string;
  year:      number;
}

type PicksState =
  | { kind: 'loading' }
  | { kind: 'no_member' }
  | { kind: 'not_in_league' }
  | { kind: 'no_draft_order' }
  | { kind: 'order_incomplete' }
  | { kind: 'projected'; picks: DraftPick[] }
  | { kind: 'actual';    picks: DraftPick[]; draftName: string };

interface TransactionRow {
  id:                   string;
  transaction_type:     string;
  actor_user_id:        string | null;
  external_player_name: string | null;
  external_position:    string | null;
  metadata:             Record<string, unknown>;
  created_at:           string;
  league_imported_members: { team_name: string }[] | null;
}

const card          = '#1e293b';
const border        = '#334155';
const textPrimary   = '#f1f5f9';
const textSecondary = '#94a3b8';
const blue          = '#3b82f6';

const POSITION_COLORS: Record<string, { bg: string; text: string }> = {
  QB:   { bg: '#7c2d12', text: '#fed7aa' },
  RB:   { bg: '#14532d', text: '#bbf7d0' },
  WR:   { bg: '#1e3a5f', text: '#bfdbfe' },
  TE:   { bg: '#3b1a5f', text: '#e9d5ff' },
  FLEX: { bg: '#1e3a5f', text: '#93c5fd' },
  K:    { bg: '#1a2e1a', text: '#86efac' },
  DST:  { bg: '#1c1a2e', text: '#a5b4fc' },
  DEF:  { bg: '#1c1a2e', text: '#a5b4fc' },
  OP:   { bg: '#3b2a12', text: '#fde68a' },
  BN:   { bg: '#1e293b', text: '#64748b' },
};

const POS_PRIORITY = ['QB', 'RB', 'WR', 'TE', 'K', 'DST', 'DEF'];

function posColor(pos: string | null) {
  return POSITION_COLORS[pos ?? ''] ?? { bg: '#334155', text: '#94a3b8' };
}

function buildEmptySlots(settings: LeagueSettings | null): RosterSlot[] {
  const s = settings;
  const qb    = s?.roster_qb   ?? 1;
  const rb    = s?.roster_rb   ?? 2;
  const wr    = s?.roster_wr   ?? 2;
  const te    = s?.roster_te   ?? 1;
  const flex  = s?.roster_flex ?? 1;
  const k     = s?.roster_k    ?? 1;
  const dst   = s?.roster_dst  ?? 1;
  const op    = (s as (LeagueSettings & { roster_op?: number }) | null)?.roster_op ?? 0;
  const bench = s?.bench       ?? 6;

  const slots: RosterSlot[] = [];
  for (let i = 0; i < qb;    i++) slots.push({ label: 'QB',   displayLabel: 'QB',             section: 'starters' });
  for (let i = 0; i < rb;    i++) slots.push({ label: 'RB',   displayLabel: 'RB',             section: 'starters' });
  for (let i = 0; i < wr;    i++) slots.push({ label: 'WR',   displayLabel: 'WR',             section: 'starters' });
  for (let i = 0; i < te;    i++) slots.push({ label: 'TE',   displayLabel: 'TE',             section: 'starters' });
  for (let i = 0; i < flex;  i++) slots.push({ label: 'FLEX', displayLabel: 'FLEX',           section: 'starters' });
  for (let i = 0; i < k;     i++) slots.push({ label: 'K',    displayLabel: 'K',              section: 'starters' });
  for (let i = 0; i < dst;   i++) slots.push({ label: 'DST',  displayLabel: 'DST',            section: 'starters' });
  for (let i = 0; i < op;    i++) slots.push({ label: 'OP',   displayLabel: 'SuperFlex (OP)', section: 'starters' });
  for (let i = 0; i < bench; i++) slots.push({ label: 'BN',   displayLabel: 'BN',             section: 'bench' });
  return slots;
}

function slotFitsPlayer(slotLabel: string, pos: string | null): boolean {
  if (!pos) return false;
  if (slotLabel === pos) return true;
  if (slotLabel === 'BN') return true;
  if (slotLabel === 'FLEX') return ['RB', 'WR', 'TE'].includes(pos);
  if (slotLabel === 'OP') return ['QB', 'RB', 'WR', 'TE'].includes(pos);
  return false;
}

function assignPlayersToSlots(slots: RosterSlot[], orderedPlayers: RosterPlayer[]): (RosterPlayer | null)[] {
  const used = new Set<string>();
  return slots.map(slot => {
    const match = orderedPlayers.find(p => !used.has(p.id) && slotFitsPlayer(slot.label, p.fantasyPosition));
    if (match) { used.add(match.id); return match; }
    return null;
  });
}

function slotGroup(slot: RosterSlot): string {
  if (slot.section === 'bench') return 'BN';
  return slot.label;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export default function LeagueRosterTab({
  leagueId, userId, isLeagueOwner, importedMembers, leagueMembers, leagueSettings, initialMemberId,
}: Props) {
  const joinedMembers = importedMembers.filter(m => m.invitedUserId !== null);
  const myTeam        = joinedMembers.find(m => m.invitedUserId === userId) ?? null;

  const resolveDefault = () => {
    if (initialMemberId) return joinedMembers.find(m => m.id === initialMemberId) ?? myTeam ?? joinedMembers[0] ?? null;
    return myTeam ?? joinedMembers[0] ?? null;
  };

  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(resolveDefault()?.id ?? null);
  const [players, setPlayers]                   = useState<RosterPlayer[]>([]);
  const [localOrder, setLocalOrder]             = useState<string[]>([]);
  const [loading, setLoading]                   = useState(false);
  const [rosterEmpty, setRosterEmpty]           = useState(false);
  const [fetchError, setFetchError]             = useState('');
  const [picksState, setPicksState]             = useState<PicksState>({ kind: 'loading' });

  // Most-relevant draft for this league — used for drop context.
  // pending/in_progress/paused → during-draft drop (exclusion removed immediately)
  // completed (no active draft) → post-draft cleanup drop (exclusion untouched)
  const [activeDraftId, setActiveDraftId]         = useState<string | null>(null);
  const [activeDraftStatus, setActiveDraftStatus] = useState<string | null>(null);

  // Drop flow
  const [selectedRosterPlayer, setSelectedRosterPlayer] = useState<RosterPlayer | null>(null);
  const [dropLoading, setDropLoading]           = useState(false);
  const [dropError, setDropError]               = useState('');

  // Recent Activity
  const [transactions, setTransactions]         = useState<TransactionRow[]>([]);

  const { playerDetail, detailLoading, openPlayerDetail, closePlayerDetail } = usePlayerDetail('', userId, null);

  const selectedMember = joinedMembers.find(m => m.id === selectedMemberId) ?? null;
  const isOwnTeam      = selectedMember?.invitedUserId === userId;

  useEffect(() => {
    if (initialMemberId) {
      const match = joinedMembers.find(m => m.id === initialMemberId);
      if (match) setSelectedMemberId(match.id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMemberId]);

  const loadTransactions = useCallback(async () => {
    const { data } = await supabase
      .from('league_roster_transactions')
      .select(`
        id, transaction_type, actor_user_id,
        external_player_name, external_position,
        metadata, created_at,
        league_imported_members!imported_member_id(team_name)
      `)
      .eq('league_id', leagueId)
      .order('created_at', { ascending: false })
      .limit(20);
    if (data) setTransactions(data as TransactionRow[]);
  }, [leagueId]);

  useEffect(() => { loadTransactions(); }, [loadTransactions]);

  const loadDraftPicks = useCallback(async (member: ImportedMember) => {
    setPicksState({ kind: 'loading' });

    if (!member.invitedUserId) {
      setPicksState({ kind: 'no_member' });
      return;
    }

    const leagueExt        = leagueSettings as (LeagueSettings & {
      default_draft_type?: string; default_rounds?: number;
      allow_future_picks?: boolean; future_pick_years?: number;
    }) | null;
    const leagueDraftType  = leagueExt?.default_draft_type ?? 'snake';
    const leagueRounds     = leagueExt?.default_rounds ?? 15;
    const allowFuturePicks = leagueExt?.allow_future_picks ?? false;
    const futurePickYears  = leagueExt?.future_pick_years ?? 1;

    // 1. Find the most-relevant draft: active first, then most-recent completed.
    //    Active draft is used for pick display AND for the drop exclusion context.
    //    Completed draft (no active) is used only for the drop cleanup context.
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

    // Use draft participant positions for pick display for any draft (active or completed)
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
        const draftLabel = relevantDraft.name ?? 'Draft';
        setPicksState({ kind: 'actual', picks, draftName: draftLabel });
        return;
      }
    }

    // 2. No active draft (or member not in it) — project from league_members.draft_order.
    //    Future years, if enabled, show generic round labels only (no exact pick numbers
    //    because future draft order is not finalized).
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

    // Current year: exact projected pick numbers
    for (let round = 1; round <= leagueRounds; round++) {
      const pick    = isSnake && round % 2 === 0 ? totalTeams + 1 - myPos : myPos;
      const overall = (round - 1) * totalTeams + pick;
      picks.push({ round, pick, overall, draftName: 'Projected', year: baseYear });
    }

    // Future years: generic read-only labels only (no exact numbers — order not finalized)
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

    // ── 1. Try app-owned league_roster_players first ──────────────────────────
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
          lrpId:            row.id,  // app-owned path: id IS the lrpId
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

    // ── 2. Fallback: read directly from external_roster_players (snapshot) ────
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
        lrpId:            null,  // fallback path: no app-owned row, drop not available
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

  useEffect(() => {
    if (selectedMember) loadRoster(selectedMember);
  }, [selectedMember, loadRoster]);

  useEffect(() => {
    if (!selectedMemberId && (myTeam ?? joinedMembers[0])?.id) {
      setSelectedMemberId((myTeam ?? joinedMembers[0]).id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMemberId, joinedMembers.length]);

  // ── Drop flow ──────────────────────────────────────────────────────────────

  function canDropPlayer(player: RosterPlayer): boolean {
    if (!player.lrpId) return false;                   // fallback path
    return isOwnTeam || isLeagueOwner;
  }

  function openPlayerDetailForRoster(player: RosterPlayer) {
    if (!player.sportsPlayerId) return;
    setSelectedRosterPlayer(player);
    openPlayerDetail(player.sportsPlayerId);
  }

  function handleCloseDetail() {
    setSelectedRosterPlayer(null);
    setDropError('');
    closePlayerDetail();
  }

  async function handleDropPlayer(player: RosterPlayer) {
    if (!player.lrpId) return;

    const isCommissionerDrop = isLeagueOwner && selectedMember?.invitedUserId !== userId;
    const isPostDraftCleanup = activeDraftStatus === 'completed';
    const isDuringDraft      = activeDraftStatus === 'pending' || activeDraftStatus === 'in_progress' || activeDraftStatus === 'paused';

    const contextNote = isPostDraftCleanup
      ? 'This will remove the player from the active roster for roster cleanup/export prep. Draft history will not be changed.'
      : isDuringDraft
        ? 'This may make the player available in the draft pool if eligible.'
        : 'This will remove the player from the active roster and record a transaction.';

    const who = isCommissionerDrop
      ? `Commissioner Action: Drop ${player.displayName} from ${selectedMember?.teamName ?? 'this team'}?`
      : `Drop ${player.displayName} from your roster?`;

    if (!window.confirm(`${who}\n\n${contextNote}`)) return;

    setDropLoading(true);
    setDropError('');

    const { data, error } = await supabase.rpc('drop_league_roster_player', {
      p_league_roster_player_id: player.lrpId,
      p_draft_id:                activeDraftId ?? null,
    });

    setDropLoading(false);

    if (error) {
      setDropError(error.message ?? 'Failed to drop player.');
      return;
    }

    const result = data as { success?: boolean } | null;
    if (!result?.success) {
      setDropError('Drop failed. Please try again.');
      return;
    }

    // Success: close modal, reload roster + transactions
    handleCloseDetail();
    if (selectedMember) loadRoster(selectedMember);
    loadTransactions();
  }

  // ── Slot ordering ──────────────────────────────────────────────────────────

  function movePlayerInGroup(playerId: string, dir: -1 | 1, slotIndex: number, allSlots: RosterSlot[], allAssignments: (RosterPlayer | null)[]) {
    const group = slotGroup(allSlots[slotIndex]);
    let targetSlotIdx = slotIndex + dir;
    while (targetSlotIdx >= 0 && targetSlotIdx < allSlots.length) {
      if (slotGroup(allSlots[targetSlotIdx]) !== group) break;
      if (allAssignments[targetSlotIdx]) break;
      targetSlotIdx += dir;
    }
    if (targetSlotIdx < 0 || targetSlotIdx >= allSlots.length) return;
    if (slotGroup(allSlots[targetSlotIdx]) !== group) return;
    const targetPlayer = allAssignments[targetSlotIdx];
    if (!targetPlayer) return;

    setLocalOrder(prev => {
      const copy = [...prev];
      const idxA = copy.indexOf(playerId);
      const idxB = copy.indexOf(targetPlayer.id);
      if (idxA === -1 || idxB === -1) return prev;
      [copy[idxA], copy[idxB]] = [copy[idxB], copy[idxA]];
      return copy;
    });
  }

  function memberLabel(m: ImportedMember): string {
    const claimed = leagueMembers.find(lm => lm.user_id === m.invitedUserId);
    const suffix  = m.invitedUserId === userId
      ? ' (you)'
      : claimed ? ` · ${claimed.display_name ?? claimed.phone_e164 ?? ''}` : '';
    return m.teamName + suffix;
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (joinedMembers.length === 0) {
    return (
      <div style={{ fontFamily: 'system-ui, sans-serif', color: textPrimary }}>
        <div style={{ background: card, border: `1px solid ${border}`, borderRadius: '10px', padding: '32px', textAlign: 'center' }}>
          <p style={{ color: textSecondary, margin: 0, fontSize: '14px' }}>
            No members have claimed their imported team yet.
          </p>
          <p style={{ color: textSecondary, margin: '8px 0 0', fontSize: '13px' }}>
            Once leaguemates accept their invites, their rosters will appear here.
          </p>
        </div>
      </div>
    );
  }

  const playerMap      = new Map(players.map(p => [p.id, p]));
  const orderedPlayers = localOrder.map(id => playerMap.get(id)).filter(Boolean) as RosterPlayer[];
  const emptySlots     = buildEmptySlots(leagueSettings);
  const starterSlots   = emptySlots.filter(s => s.section === 'starters');
  const benchSlots     = emptySlots.filter(s => s.section === 'bench');
  const assignments    = players.length > 0 ? assignPlayersToSlots(emptySlots, orderedPlayers) : null;
  const unresolvedCount = players.filter(p => p.unresolved).length;

  const modalCanDrop = !!(
    selectedRosterPlayer?.lrpId &&
    !selectedRosterPlayer.unresolved &&
    canDropPlayer(selectedRosterPlayer)
  );

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', color: textPrimary }}>

      {joinedMembers.length > 1 && (
        <div style={{ background: card, border: `1px solid ${border}`, borderRadius: '10px', padding: '14px 16px', marginBottom: '16px' }}>
          <p style={{ margin: '0 0 10px', fontSize: '12px', fontWeight: '600', color: textSecondary, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            View Team
          </p>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {joinedMembers.map(m => {
              const active = m.id === selectedMemberId;
              return (
                <button
                  key={m.id}
                  onClick={() => setSelectedMemberId(m.id)}
                  style={{
                    padding: '5px 14px', borderRadius: '9999px', fontSize: '13px', fontWeight: '600',
                    cursor: 'pointer', border: `1px solid ${active ? blue : border}`,
                    background: active ? '#1d4ed8' : 'transparent',
                    color: active ? '#fff' : textSecondary,
                    transition: 'all 0.1s',
                  }}
                >
                  {memberLabel(m)}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ background: card, border: `1px solid ${border}`, borderRadius: '10px', overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: `1px solid ${border}`, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '14px', fontWeight: '700', color: textPrimary }}>
            {selectedMember?.teamName ?? 'Roster'}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {isLeagueOwner && selectedMember && selectedMember.invitedUserId !== userId && (
              <span style={{ fontSize: '11px', fontWeight: '600', padding: '2px 8px', borderRadius: '9999px', background: 'rgba(251,191,36,0.12)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.3)' }}>
                Commissioner View
              </span>
            )}
            {selectedMember && (
              <span style={{ fontSize: '12px', color: textSecondary }}>
                Imported from {selectedMember.provider?.toUpperCase()}
              </span>
            )}
          </div>
        </div>

        {dropError && (
          <div style={{ padding: '10px 16px', background: 'rgba(239,68,68,0.1)', borderBottom: `1px solid #ef4444`, fontSize: '13px', color: '#ef4444' }}>
            {dropError}
          </div>
        )}

        {loading && (
          <div style={{ padding: '32px', textAlign: 'center', color: textSecondary, fontSize: '14px' }}>Loading roster...</div>
        )}

        {!loading && fetchError && (
          <div style={{ padding: '16px', color: '#f87171', fontSize: '13px' }}>{fetchError}</div>
        )}

        {!loading && !fetchError && rosterEmpty && (
          <EmptyRosterShell starterSlots={starterSlots} benchSlots={benchSlots} border={border} textSecondary={textSecondary} />
        )}

        {!loading && !fetchError && players.length > 0 && assignments && (
          <>
            {unresolvedCount > 0 && (
              <div style={{ padding: '8px 16px', background: '#1c2840', borderBottom: `1px solid ${border}`, fontSize: '12px', color: '#93c5fd' }}>
                {unresolvedCount} player{unresolvedCount !== 1 ? 's' : ''} could not be matched and are shown with their imported names.
              </div>
            )}

            <SectionHeader label="Starters" border={border} textSecondary={textSecondary} />
            {starterSlots.map((slot, slotIdx) => {
              const player = assignments[slotIdx];
              const group  = slotGroup(slot);
              const canUp = isOwnTeam && !!player && (() => {
                for (let i = slotIdx - 1; i >= 0; i--) {
                  if (slotGroup(emptySlots[i]) !== group) break;
                  if (assignments[i]) return true;
                }
                return false;
              })();
              const canDown = isOwnTeam && !!player && (() => {
                for (let i = slotIdx + 1; i < emptySlots.length; i++) {
                  if (slotGroup(emptySlots[i]) !== group) break;
                  if (assignments[i]) return true;
                }
                return false;
              })();
              return (
                <PlayerSlotRow
                  key={`starter-${slotIdx}`}
                  slot={slot}
                  player={player}
                  border={border}
                  textPrimary={textPrimary}
                  textSecondary={textSecondary}
                  isLast={false}
                  canMoveUp={canUp}
                  canMoveDown={canDown}
                  onMoveUp={() => player && movePlayerInGroup(player.id, -1, slotIdx, emptySlots, assignments)}
                  onMoveDown={() => player && movePlayerInGroup(player.id, 1, slotIdx, emptySlots, assignments)}
                  onPlayerClick={player?.sportsPlayerId && !player?.unresolved ? () => openPlayerDetailForRoster(player) : undefined}
                  canDropUnresolved={player?.unresolved ? canDropPlayer(player) : false}
                  onDropUnresolved={player?.unresolved ? () => handleDropPlayer(player) : undefined}
                />
              );
            })}

            {benchSlots.length > 0 && (
              <>
                <SectionHeader label="Bench" border={border} textSecondary={textSecondary} />
                {benchSlots.map((slot, i) => {
                  const globalSlotIdx = starterSlots.length + i;
                  const player        = assignments[globalSlotIdx];
                  const group         = slotGroup(slot);
                  const canUp = isOwnTeam && !!player && (() => {
                    for (let j = globalSlotIdx - 1; j >= 0; j--) {
                      if (slotGroup(emptySlots[j]) !== group) break;
                      if (assignments[j]) return true;
                    }
                    return false;
                  })();
                  const canDown = isOwnTeam && !!player && (() => {
                    for (let j = globalSlotIdx + 1; j < emptySlots.length; j++) {
                      if (slotGroup(emptySlots[j]) !== group) break;
                      if (assignments[j]) return true;
                    }
                    return false;
                  })();
                  return (
                    <PlayerSlotRow
                      key={`bench-${i}`}
                      slot={slot}
                      player={player}
                      border={border}
                      textPrimary={textPrimary}
                      textSecondary={textSecondary}
                      isLast={i === benchSlots.length - 1}
                      canMoveUp={canUp}
                      canMoveDown={canDown}
                      onMoveUp={() => player && movePlayerInGroup(player.id, -1, globalSlotIdx, emptySlots, assignments)}
                      onMoveDown={() => player && movePlayerInGroup(player.id, 1, globalSlotIdx, emptySlots, assignments)}
                      onPlayerClick={player?.sportsPlayerId && !player?.unresolved ? () => openPlayerDetailForRoster(player) : undefined}
                      canDropUnresolved={player?.unresolved ? canDropPlayer(player) : false}
                      onDropUnresolved={player?.unresolved ? () => handleDropPlayer(player) : undefined}
                    />
                  );
                })}
              </>
            )}
          </>
        )}
      </div>

      {/* Draft Picks */}
      {!loading && selectedMember && picksState.kind !== 'loading' && picksState.kind !== 'no_member' && (
        <div style={{ marginTop: '16px', background: card, border: `1px solid ${border}`, borderRadius: '10px', overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: `1px solid ${border}` }}>
            <span style={{ fontSize: '14px', fontWeight: '700', color: textPrimary }}>
              {picksState.kind === 'projected' ? 'Draft Pick Assets' : 'Draft Picks'}
            </span>
            {(picksState.kind === 'projected' || picksState.kind === 'actual') && (
              <div style={{ marginTop: '3px', fontSize: '12px', color: textSecondary }}>
                {picksState.kind === 'projected'
                  ? 'Based on current league draft order and league settings. Create a draft to lock these picks in.'
                  : activeDraftStatus === 'completed'
                    ? `Based on the completed draft's participant order and draft settings.`
                    : `Based on this draft's participant order and draft settings.`}
              </div>
            )}
          </div>

          {picksState.kind === 'not_in_league' && (
            <div style={{ padding: '20px 16px', color: textSecondary, fontSize: '13px' }}>This team is not connected to a league member yet.</div>
          )}
          {picksState.kind === 'no_draft_order' && (
            <div style={{ padding: '20px 16px', color: textSecondary, fontSize: '13px' }}>This team does not have a draft order position yet. The commissioner can set draft order from the Members tab.</div>
          )}
          {picksState.kind === 'order_incomplete' && (
            <div style={{ padding: '20px 16px', color: textSecondary, fontSize: '13px' }}>Draft order is incomplete. The commissioner can finish setting draft order from the Members tab.</div>
          )}

          {(picksState.kind === 'projected' || picksState.kind === 'actual') && (() => {
            const years = Array.from(new Set(picksState.picks.map(p => p.year))).sort((a, b) => a - b);
            const currentYear = years[0];
            const multiYear = years.length > 1;
            return (
              <div style={{ padding: '12px 16px' }}>
                {years.map((year, yi) => {
                  const yearPicks = picksState.picks.filter(p => p.year === year);
                  const isCurrent = year === currentYear;
                  return (
                    <div key={year} style={{ marginBottom: multiYear && yi < years.length - 1 ? '16px' : 0 }}>
                      {multiYear && (
                        <div style={{ fontSize: '11px', fontWeight: '700', color: textSecondary, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px', paddingBottom: '4px', borderBottom: `1px solid ${border}` }}>
                          {year} Picks
                        </div>
                      )}
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {yearPicks.map(pick => isCurrent ? (
                          <div key={`${year}-${pick.round}`} style={{ padding: '6px 12px', borderRadius: '7px', background: '#0f172a', border: `1px solid ${picksState.kind === 'projected' ? '#334155' : '#1d4ed8'}`, textAlign: 'center', minWidth: '72px' }}>
                            <div style={{ fontSize: '10px', color: textSecondary, fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Rd {pick.round}</div>
                            <div style={{ fontSize: '16px', fontWeight: '700', color: picksState.kind === 'projected' ? textSecondary : textPrimary }}>#{pick.overall}</div>
                            <div style={{ fontSize: '10px', color: textSecondary }}>Pick {pick.pick}</div>
                          </div>
                        ) : (
                          <div key={`${year}-${pick.round}`} style={{ padding: '6px 12px', borderRadius: '7px', background: '#0f172a', border: '1px solid #1e3a5f', textAlign: 'center', minWidth: '72px' }}>
                            <div style={{ fontSize: '10px', color: '#475569', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{year}</div>
                            <div style={{ fontSize: '16px', fontWeight: '700', color: '#475569' }}>Rd {pick.round}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      )}

      {/* Recent Activity */}
      {transactions.length > 0 && (
        <div style={{ marginTop: '16px', background: card, border: `1px solid ${border}`, borderRadius: '10px', overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: `1px solid ${border}` }}>
            <span style={{ fontSize: '14px', fontWeight: '700', color: textPrimary }}>Recent Activity</span>
          </div>
          {transactions.map((tx, i) => {
            const isMe      = tx.actor_user_id === userId;
            const isComm    = tx.metadata?.commissioner_action === true;
            const isCleanup = tx.metadata?.post_draft_cleanup === true;
            const team      = (tx.league_imported_members?.[0])?.team_name ?? null;
            const player    = tx.external_player_name ?? 'Unknown player';
            const pos       = tx.external_position;
            return (
              <div
                key={tx.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: '10px',
                  padding: '10px 16px',
                  borderBottom: i < transactions.length - 1 ? `1px solid ${border}` : 'none',
                }}
              >
                <div style={{
                  width: '28px', height: '28px', borderRadius: '50%', flexShrink: 0,
                  background: tx.transaction_type === 'drop' ? 'rgba(239,68,68,0.15)' : 'rgba(59,130,246,0.15)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '12px',
                  color: tx.transaction_type === 'drop' ? '#ef4444' : '#60a5fa',
                  fontWeight: '700',
                }}>
                  {tx.transaction_type === 'drop' ? '↓' : '↑'}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '13px', fontWeight: '600', color: textPrimary }}>
                    {player}
                    {pos && (
                      <span style={{ marginLeft: '6px', fontSize: '10px', fontWeight: '700', padding: '1px 5px', borderRadius: '4px', background: posColor(pos).bg, color: posColor(pos).text }}>
                        {pos}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '12px', color: textSecondary, marginTop: '1px' }}>
                    {tx.transaction_type === 'drop' ? 'Dropped' : tx.transaction_type}
                    {team && ` from ${team}`}
                    {isMe && ' · You'}
                    {isCleanup && (
                      <span style={{ marginLeft: '6px', fontSize: '10px', fontWeight: '700', padding: '1px 6px', borderRadius: '4px', background: 'rgba(148,163,184,0.12)', color: '#94a3b8' }}>
                        Cleanup
                      </span>
                    )}
                    {isComm && !isMe && (
                      <span style={{ marginLeft: '6px', fontSize: '10px', fontWeight: '700', padding: '1px 6px', borderRadius: '4px', background: 'rgba(251,191,36,0.12)', color: '#fbbf24' }}>
                        Commissioner
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ fontSize: '11px', color: '#475569', flexShrink: 0 }}>
                  {timeAgo(tx.created_at)}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!selectedMember && !loading && (
        <div style={{ marginTop: '16px', background: card, border: `1px solid ${border}`, borderRadius: '10px', padding: '24px', textAlign: 'center' }}>
          <p style={{ color: textSecondary, margin: 0, fontSize: '14px' }}>You are not connected to an imported team yet.</p>
          <p style={{ color: textSecondary, margin: '8px 0 0', fontSize: '13px' }}>
            Ask the league commissioner to send you an invite linked to your imported team.
          </p>
        </div>
      )}

      {/* Player detail modal */}
      <PlayerDetailModal
        detail={playerDetail}
        loading={detailLoading || dropLoading}
        isOnBoard={false}
        isPicked={false}
        canPick={false}
        showBoardActions={false}
        sourceBadge="Imported"
        canDrop={modalCanDrop}
        onDrop={selectedRosterPlayer ? () => handleDropPlayer(selectedRosterPlayer) : undefined}
        onAdd={() => {}}
        onRemove={() => {}}
        onPick={() => {}}
        onClose={handleCloseDetail}
      />
    </div>
  );
}

function SectionHeader({ label, border, textSecondary }: { label: string; border: string; textSecondary: string }) {
  return (
    <div style={{ padding: '8px 16px 2px', borderBottom: `1px solid ${border}`, background: 'rgba(255,255,255,0.02)' }}>
      <span style={{ fontSize: '10px', fontWeight: '700', color: textSecondary, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        {label}
      </span>
    </div>
  );
}

function PlayerSlotRow({
  slot, player, border, textPrimary, textSecondary, isLast,
  canMoveUp, canMoveDown, onMoveUp, onMoveDown, onPlayerClick,
  canDropUnresolved, onDropUnresolved,
}: {
  slot: RosterSlot;
  player: RosterPlayer | null;
  border: string;
  textPrimary: string;
  textSecondary: string;
  isLast: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onPlayerClick?: () => void;
  canDropUnresolved?: boolean;
  onDropUnresolved?: () => void;
}) {
  const col = posColor(slot.label);
  const clickable = !!player && !player.unresolved && !!onPlayerClick;
  return (
    <div
      onClick={() => clickable && onPlayerClick!()}
      style={{
        display: 'flex', alignItems: 'center', gap: '10px',
        padding: '9px 16px',
        borderBottom: isLast ? 'none' : `1px solid ${border}`,
        cursor: clickable ? 'pointer' : 'default',
        transition: clickable ? 'background 0.1s' : 'none',
      }}
      onMouseEnter={e => { if (clickable) (e.currentTarget as HTMLDivElement).style.background = 'rgba(59,130,246,0.06)'; }}
      onMouseLeave={e => { if (clickable) (e.currentTarget as HTMLDivElement).style.background = ''; }}
    >
      <span style={{
        minWidth: '38px', padding: '2px 5px', borderRadius: '4px',
        fontSize: '10px', fontWeight: '700', textAlign: 'center',
        background: col.bg, color: col.text, flexShrink: 0,
      }}>
        {slot.label}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        {player ? (
          <>
            <div style={{
              fontWeight: '600', fontSize: '14px',
              color: player.unresolved ? textSecondary : textPrimary,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {player.displayName}
              {player.unresolved && (
                <span style={{ marginLeft: '6px', fontSize: '10px', fontWeight: '700', padding: '1px 5px', borderRadius: '4px', background: '#292524', color: '#a8a29e' }}>
                  Unresolved
                </span>
              )}
            </div>
            {(player.teamAbbr || player.fantasyPosition) && (
              <div style={{ fontSize: '11px', color: textSecondary, marginTop: '1px' }}>
                {[player.fantasyPosition, player.teamAbbr].filter(Boolean).join(' · ')}
              </div>
            )}
          </>
        ) : (
          <span style={{ fontSize: '13px', color: textSecondary, fontStyle: 'italic' }}>— Empty —</span>
        )}
      </div>
      {player && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
          {/* Drop button for unresolved players (resolved players use the modal) */}
          {player.unresolved && canDropUnresolved && onDropUnresolved && (
            <button
              onClick={e => { e.stopPropagation(); onDropUnresolved(); }}
              title="Drop player"
              style={{
                padding: '2px 8px', fontSize: '11px', fontWeight: '700',
                background: 'rgba(239,68,68,0.1)', color: '#ef4444',
                border: '1px solid rgba(239,68,68,0.4)', borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              Drop
            </button>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <ArrowBtn enabled={canMoveUp} dir="up" onClick={e => { e.stopPropagation(); onMoveUp(); }} />
            <ArrowBtn enabled={canMoveDown} dir="down" onClick={e => { e.stopPropagation(); onMoveDown(); }} />
          </div>
        </div>
      )}
    </div>
  );
}

function ArrowBtn({ enabled, dir, onClick }: { enabled: boolean; dir: 'up' | 'down'; onClick: (e: React.MouseEvent) => void }) {
  return (
    <button
      onClick={onClick}
      disabled={!enabled}
      title={dir === 'up' ? 'Move up' : 'Move down'}
      style={{
        width: '22px', height: '20px', padding: 0,
        background: enabled ? 'rgba(59,130,246,0.15)' : 'transparent',
        border: `1px solid ${enabled ? '#3b82f6' : '#334155'}`,
        borderRadius: '3px', cursor: enabled ? 'pointer' : 'default',
        color: enabled ? '#60a5fa' : '#475569',
        fontSize: '10px', lineHeight: 1,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      {dir === 'up' ? '▲' : '▼'}
    </button>
  );
}

function EmptyRosterShell({ starterSlots, benchSlots, border, textSecondary }: {
  starterSlots: RosterSlot[]; benchSlots: RosterSlot[]; border: string; textSecondary: string;
}) {
  return (
    <>
      <div style={{ padding: '10px 16px', background: '#172033', borderBottom: `1px solid ${border}`, fontSize: '12px', color: '#93c5fd' }}>
        No roster players have been imported for this team yet. The league commissioner can import rosters from the Settings tab &rarr; Import External League Roster.
      </div>
      <div style={{ padding: '8px 16px 2px', borderBottom: `1px solid ${border}` }}>
        <span style={{ fontSize: '10px', fontWeight: '700', color: textSecondary, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Starters</span>
      </div>
      {starterSlots.map((slot, i) => {
        const col = posColor(slot.label);
        return (
          <div key={`es-${i}`} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 16px', borderBottom: `1px solid ${border}`, opacity: 0.55 }}>
            <span style={{ minWidth: '38px', padding: '2px 5px', borderRadius: '4px', fontSize: '10px', fontWeight: '700', textAlign: 'center', background: col.bg, color: col.text, flexShrink: 0 }}>{slot.label}</span>
            <span style={{ fontSize: '13px', color: textSecondary, fontStyle: 'italic' }}>— Empty —</span>
          </div>
        );
      })}
      {benchSlots.length > 0 && (
        <>
          <div style={{ padding: '8px 16px 2px', borderBottom: `1px solid ${border}` }}>
            <span style={{ fontSize: '10px', fontWeight: '700', color: textSecondary, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Bench</span>
          </div>
          {benchSlots.map((slot, i) => {
            const col = posColor(slot.label);
            return (
              <div key={`eb-${i}`} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 16px', borderBottom: i < benchSlots.length - 1 ? `1px solid ${border}` : 'none', opacity: 0.45 }}>
                <span style={{ minWidth: '38px', padding: '2px 5px', borderRadius: '4px', fontSize: '10px', fontWeight: '700', textAlign: 'center', background: col.bg, color: col.text, flexShrink: 0 }}>{slot.label}</span>
                <span style={{ fontSize: '13px', color: textSecondary, fontStyle: 'italic' }}>— Empty —</span>
              </div>
            );
          })}
        </>
      )}
    </>
  );
}
