import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import type { ImportedMember } from './ImportedLeaguematesPanel';
import type { Database } from '../../types/supabase';

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
  id:               string;
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
  round: number;
  pick: number;
  overall: number;
  draftName: string;
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
  const [draftPicks, setDraftPicks]   = useState<DraftPick[]>([]);

  const selectedMember = joinedMembers.find(m => m.id === selectedMemberId) ?? null;

  useEffect(() => {
    if (initialMemberId) {
      const match = joinedMembers.find(m => m.id === initialMemberId);
      if (match) setSelectedMemberId(match.id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMemberId]);

  const loadDraftPicks = useCallback(async (member: ImportedMember) => {
    setDraftPicks([]);
    if (!member.invitedUserId) return;

    const { data: draftsData } = await supabase
      .from('drafts')
      .select('id, name, rounds, num_teams, draft_type, status')
      .eq('league_id', leagueId)
      .in('status', ['pending', 'in_progress']);

    if (!draftsData || draftsData.length === 0) return;

    const picks: DraftPick[] = [];
    for (const draft of draftsData) {
      const { data: participants } = await supabase
        .from('draft_participants')
        .select('user_id, draft_position')
        .eq('draft_id', draft.id)
        .order('draft_position', { ascending: true });

      if (!participants) continue;
      const totalTeams = participants.length || draft.num_teams || 1;
      const myParticipant = participants.find(p => p.user_id === member.invitedUserId);
      if (!myParticipant || myParticipant.draft_position == null) continue;

      const myPos = myParticipant.draft_position;
      const rounds = draft.rounds ?? 15;
      const isSnake = (draft.draft_type ?? 'snake') === 'snake';

      for (let round = 1; round <= rounds; round++) {
        const posInRound = isSnake && round % 2 === 0
          ? totalTeams + 1 - myPos
          : myPos;
        const overall = (round - 1) * totalTeams + posInRound;
        picks.push({ round, pick: posInRound, overall, draftName: draft.name ?? 'Draft' });
      }
    }

    setDraftPicks(picks);
  }, [leagueId]);

  const loadRoster = useCallback(async (member: ImportedMember) => {
    setLoading(true);
    setPlayers([]);
    setLocalOrder([]);
    setRosterEmpty(false);
    setFetchError('');

    loadDraftPicks(member);

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
              const canUp = !!player && (() => {
                for (let i = slotIdx - 1; i >= 0; i--) {
                  if (slotGroup(emptySlots[i]) !== group) break;
                  if (assignments[i]) return true;
                }
                return false;
              })();
              const canDown = !!player && (() => {
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
                  const canUp = !!player && (() => {
                    for (let j = globalSlotIdx - 1; j >= 0; j--) {
                      if (slotGroup(emptySlots[j]) !== group) break;
                      if (assignments[j]) return true;
                    }
                    return false;
                  })();
                  const canDown = !!player && (() => {
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
                    />
                  );
                })}
              </>
            )}
          </>
        )}
      </div>

      {/* Draft Picks */}
      {!loading && draftPicks.length > 0 && selectedMember && (
        <div style={{ marginTop: '16px', background: card, border: `1px solid ${border}`, borderRadius: '10px', overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: `1px solid ${border}` }}>
            <span style={{ fontSize: '14px', fontWeight: '700', color: textPrimary }}>Draft Picks</span>
            <span style={{ marginLeft: '8px', fontSize: '12px', color: textSecondary }}>Active drafts only</span>
          </div>
          {Array.from(new Set(draftPicks.map(p => p.draftName))).map(draftName => {
            const picks = draftPicks.filter(p => p.draftName === draftName);
            return (
              <div key={draftName} style={{ borderBottom: `1px solid ${border}` }}>
                <div style={{ padding: '8px 16px 4px', background: 'rgba(255,255,255,0.02)' }}>
                  <span style={{ fontSize: '11px', fontWeight: '700', color: textSecondary, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    {draftName}
                  </span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', padding: '8px 16px 12px' }}>
                  {picks.map(pick => (
                    <div key={`${pick.round}-${pick.pick}`} style={{
                      padding: '5px 12px', borderRadius: '6px', background: '#0f172a',
                      border: `1px solid ${border}`, textAlign: 'center', minWidth: '70px',
                    }}>
                      <div style={{ fontSize: '10px', color: textSecondary, fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        Rd {pick.round}
                      </div>
                      <div style={{ fontSize: '15px', fontWeight: '700', color: textPrimary }}>
                        #{pick.overall}
                      </div>
                      <div style={{ fontSize: '10px', color: textSecondary }}>
                        Pick {pick.pick}
                      </div>
                    </div>
                  ))}
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
  canMoveUp, canMoveDown, onMoveUp, onMoveDown,
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
}) {
  const col = posColor(slot.label);
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '10px',
      padding: '9px 16px',
      borderBottom: isLast ? 'none' : `1px solid ${border}`,
    }}>
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
          <ArrowBtn enabled={canMoveUp} dir="up" onClick={onMoveUp} />
          <ArrowBtn enabled={canMoveDown} dir="down" onClick={onMoveDown} />
        </div>
      )}
    </div>
  );
}

function ArrowBtn({ enabled, dir, onClick }: { enabled: boolean; dir: 'up' | 'down'; onClick: () => void }) {
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
