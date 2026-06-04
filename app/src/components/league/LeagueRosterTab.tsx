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
  importedMembers: ImportedMember[];
  leagueMembers:   LeagueMember[];
  leagueSettings:  LeagueSettings | null;
  initialMemberId?: string | null;
}

interface RosterPlayer {
  id:               string;  // external_roster_players.id
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
  round:    number;
  pick:     number;
  overall:  number;
  draftName: string;
}

type PicksState =
  | { kind: 'loading' }
  | { kind: 'no_member' }           // member has no invitedUserId
  | { kind: 'not_in_league' }       // invitedUserId has no league_members row
  | { kind: 'no_draft_order' }      // member is in league but has no draft_order
  | { kind: 'order_incomplete' }    // some other member is missing draft_order
  | { kind: 'projected'; picks: DraftPick[] }
  | { kind: 'actual';    picks: DraftPick[]; draftName: string };

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

// Movement group: starters each keep their slot label as a group (QB↔QB, RB↔RB, etc.),
// bench is one free-swap pool. FLEX and OP are each their own group.
function slotGroup(slot: RosterSlot): string {
  if (slot.section === 'bench') return 'BN';
  return slot.label;
}

export default function LeagueRosterTab({
  leagueId, userId, importedMembers, leagueMembers, leagueSettings, initialMemberId,
}: Props) {
  const joinedMembers = importedMembers.filter(m => m.invitedUserId !== null);
  const myTeam        = joinedMembers.find(m => m.invitedUserId === userId) ?? null;

  const resolveDefault = () => {
    if (initialMemberId) return joinedMembers.find(m => m.id === initialMemberId) ?? myTeam ?? joinedMembers[0] ?? null;
    return myTeam ?? joinedMembers[0] ?? null;
  };

  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(resolveDefault()?.id ?? null);
  const [players, setPlayers]         = useState<RosterPlayer[]>([]);
  const [localOrder, setLocalOrder]   = useState<string[]>([]);
  const [loading, setLoading]         = useState(false);
  const [rosterEmpty, setRosterEmpty] = useState(false);
  const [fetchError, setFetchError]   = useState('');
  const [picksState, setPicksState]   = useState<PicksState>({ kind: 'loading' });

  const { playerDetail, detailLoading, openPlayerDetail, closePlayerDetail } = usePlayerDetail('', userId, null);

  const selectedMember = joinedMembers.find(m => m.id === selectedMemberId) ?? null;

  useEffect(() => {
    if (initialMemberId) {
      const match = joinedMembers.find(m => m.id === initialMemberId);
      if (match) setSelectedMemberId(match.id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMemberId]);

  const loadDraftPicks = useCallback(async (member: ImportedMember) => {
    setPicksState({ kind: 'loading' });

    if (!member.invitedUserId) {
      setPicksState({ kind: 'no_member' });
      return;
    }

    const leagueExt       = leagueSettings as (LeagueSettings & { default_draft_type?: string; default_rounds?: number }) | null;
    const leagueDraftType = leagueExt?.default_draft_type ?? 'snake';
    const leagueRounds    = leagueExt?.default_rounds ?? 15;

    // 1. Check for an active/paused draft — use it as source of truth if found
    const { data: draftsData } = await supabase
      .from('drafts')
      .select('id, name, draft_type, status')
      .eq('league_id', leagueId)
      .in('status', ['pending', 'in_progress', 'paused'])
      .order('created_at', { ascending: false })
      .limit(1);

    if (draftsData && draftsData.length > 0) {
      const draft = draftsData[0];
      const [participantsRes, draftSettingsRes] = await Promise.all([
        supabase
          .from('draft_participants')
          .select('user_id, draft_position')
          .eq('draft_id', draft.id)
          .order('draft_position', { ascending: true }),
        supabase
          .from('draft_settings')
          .select('num_rounds, draft_type')
          .eq('draft_id', draft.id)
          .maybeSingle(),
      ]);

      const participants  = participantsRes.data ?? [];
      const myParticipant = participants.find(p => p.user_id === member.invitedUserId);

      if (myParticipant && myParticipant.draft_position != null) {
        const totalTeams = participants.length || 1;
        const myPos      = myParticipant.draft_position;
        const rounds     = draftSettingsRes.data?.num_rounds ?? leagueRounds;
        const isSnake    = (draftSettingsRes.data?.draft_type ?? draft.draft_type ?? leagueDraftType) === 'snake';
        const picks: DraftPick[] = [];
        for (let round = 1; round <= rounds; round++) {
          const pick    = isSnake && round % 2 === 0 ? totalTeams + 1 - myPos : myPos;
          const overall = (round - 1) * totalTeams + pick;
          picks.push({ round, pick, overall, draftName: draft.name ?? 'Draft' });
        }
        setPicksState({ kind: 'actual', picks, draftName: draft.name ?? 'Draft' });
        return;
      }
      // Draft exists but user not yet a participant — fall through to projected
    }

    // 2. No active draft (or user not in participants) — project from league_members.draft_order
    // Fetch ALL members so we can count totalTeams accurately and detect incomplete order
    const { data: allMembers } = await supabase
      .from('league_members')
      .select('id, user_id, draft_order')
      .eq('league_id', leagueId)
      .order('draft_order', { ascending: true, nullsFirst: false });

    const members        = allMembers ?? [];
    const totalMembers   = members.length;
    const myLeagueMember = members.find(m => m.user_id === member.invitedUserId);

    if (!myLeagueMember) {
      setPicksState({ kind: 'not_in_league' });
      return;
    }

    if (myLeagueMember.draft_order == null) {
      setPicksState({ kind: 'no_draft_order' });
      return;
    }

    const anyMissingOrder = members.some(m => m.draft_order == null);
    if (anyMissingOrder) {
      setPicksState({ kind: 'order_incomplete' });
      return;
    }

    const totalTeams = totalMembers;
    const myPos      = myLeagueMember.draft_order;
    const isSnake    = leagueDraftType === 'snake';
    const picks: DraftPick[] = [];
    for (let round = 1; round <= leagueRounds; round++) {
      const pick    = isSnake && round % 2 === 0 ? totalTeams + 1 - myPos : myPos;
      const overall = (round - 1) * totalTeams + pick;
      picks.push({ round, pick, overall, draftName: 'Projected' });
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
          sportsPlayerId:   row.sports_player_id ?? null,
          displayName:      detail?.display_name ?? row.external_player_name ?? 'Unknown',
          fantasyPosition:  detail?.fantasy_position ?? row.external_position ?? null,
          teamAbbr:         detail?.team_abbr ?? null,
          resolutionStatus: row.sports_player_id ? 'matched' : 'unresolved',
          unresolved:       !row.sports_player_id,
        };
      });

      // Sort: resolved first by position priority, then unresolved; within group by name
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

  // Swap the player in slotIndex with the nearest occupied slot in the same group, in direction dir.
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
  // Only allow movement on your own team
  const isOwnTeam = selectedMember?.invitedUserId === userId;

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
          {selectedMember && (
            <span style={{ fontSize: '12px', color: textSecondary }}>
              Imported from {selectedMember.provider?.toUpperCase()}
            </span>
          )}
        </div>

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
                  onPlayerClick={player?.sportsPlayerId && !player?.unresolved ? () => openPlayerDetail(player.sportsPlayerId!) : undefined}
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
                      onPlayerClick={player?.sportsPlayerId && !player?.unresolved ? () => openPlayerDetail(player.sportsPlayerId!) : undefined}
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

          {/* Header */}
          <div style={{ padding: '12px 16px', borderBottom: `1px solid ${border}` }}>
            <span style={{ fontSize: '14px', fontWeight: '700', color: textPrimary }}>
              {picksState.kind === 'projected' ? 'Projected Current Draft Picks' : 'Draft Picks'}
            </span>
            {(picksState.kind === 'projected' || picksState.kind === 'actual') && (
              <div style={{ marginTop: '3px', fontSize: '12px', color: textSecondary }}>
                {picksState.kind === 'projected'
                  ? 'Based on current league draft order and league settings. Create a draft to lock these picks in.'
                  : `Based on this draft's participant order and draft settings.`}
              </div>
            )}
          </div>

          {/* Not connected to a league member */}
          {picksState.kind === 'not_in_league' && (
            <div style={{ padding: '20px 16px', color: textSecondary, fontSize: '13px' }}>
              This team is not connected to a league member yet.
            </div>
          )}

          {/* No draft order for this team */}
          {picksState.kind === 'no_draft_order' && (
            <div style={{ padding: '20px 16px', color: textSecondary, fontSize: '13px' }}>
              This team does not have a draft order position yet. The commissioner can set draft order from the Members tab.
            </div>
          )}

          {/* Some members are missing draft order */}
          {picksState.kind === 'order_incomplete' && (
            <div style={{ padding: '20px 16px', color: textSecondary, fontSize: '13px' }}>
              Draft order is incomplete. The commissioner can finish setting draft order from the Members tab.
            </div>
          )}

          {/* Picks grid */}
          {(picksState.kind === 'projected' || picksState.kind === 'actual') && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', padding: '12px 16px' }}>
              {picksState.picks.map(pick => (
                <div key={`${pick.round}-${pick.pick}`} style={{
                  padding: '6px 12px', borderRadius: '7px', background: '#0f172a',
                  border: `1px solid ${picksState.kind === 'projected' ? '#334155' : '#1d4ed8'}`,
                  textAlign: 'center', minWidth: '72px',
                }}>
                  <div style={{ fontSize: '10px', color: textSecondary, fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Rd {pick.round}
                  </div>
                  <div style={{ fontSize: '16px', fontWeight: '700', color: picksState.kind === 'projected' ? textSecondary : textPrimary }}>
                    #{pick.overall}
                  </div>
                  <div style={{ fontSize: '10px', color: textSecondary }}>
                    Pick {pick.pick}
                  </div>
                </div>
              ))}
            </div>
          )}
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
        loading={detailLoading}
        isOnBoard={false}
        isPicked={false}
        canPick={false}
        showBoardActions={false}
        sourceBadge="Imported"
        onAdd={() => {}}
        onRemove={() => {}}
        onPick={() => {}}
        onClose={closePlayerDetail}
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
  onPlayerClick?: (sportsPlayerId: string) => void;
}) {
  const col = posColor(slot.label);
  const clickable = !!player && !player.unresolved && !!onPlayerClick;
  return (
    <div
      onClick={() => clickable && onPlayerClick!(player!.id)}
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flexShrink: 0 }}>
          <ArrowBtn enabled={canMoveUp} dir="up" onClick={e => { e.stopPropagation(); onMoveUp(); }} />
          <ArrowBtn enabled={canMoveDown} dir="down" onClick={e => { e.stopPropagation(); onMoveDown(); }} />
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
