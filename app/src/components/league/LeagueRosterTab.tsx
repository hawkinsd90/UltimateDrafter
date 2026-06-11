import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { ImportedMember } from './ImportedLeaguematesPanel';
import type { Database } from '../../types/supabase';
import PlayerDetailModal from '../draft/PlayerDetailModal';
import { usePlayerDetail } from '../../hooks/draft/usePlayerDetail';
import { useRosterData } from '../../hooks/league/useRosterData';
import type { RosterPlayer } from '../../hooks/league/useRosterData';
import { useTransactions } from '../../hooks/league/useTransactions';
import { useTrades } from '../../hooks/league/useTrades';
import RosterPicksCard from './RosterPicksCard';
import RecentActivityCard from './RecentActivityCard';
import PendingTradesCard from './PendingTradesCard';
import TradeProposalDrawer from './TradeProposalDrawer';
import { SectionHeader, PlayerSlotRow, EmptyRosterShell } from './RosterSlotRow';
import { buildEmptySlots, assignPlayersToSlots, slotGroup } from '../../utils/rosterSlots';
import type { RosterSlot } from '../../utils/rosterSlots';
import ConfirmModal from '../ConfirmModal';
import { useConfirm } from '../../hooks/useConfirm';

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

const card          = '#1e293b';
const border        = '#334155';
const textPrimary   = '#f1f5f9';
const textSecondary = '#94a3b8';
const blue          = '#3b82f6';

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
  const [tradeDrawerOpen,  setTradeDrawerOpen]   = useState(false);

  const {
    players, localOrder, setLocalOrder,
    loading, rosterEmpty, fetchError,
    picksState, activeDraftId, activeDraftStatus,
    loadRoster,
  } = useRosterData(leagueId, leagueSettings);

  const { activity, loadTransactions } = useTransactions(leagueId);

  const { pending: pendingTrades, recent: recentTrades, loadTrades } = useTrades(leagueId, userId, isLeagueOwner);

  // Drop flow
  const [selectedRosterPlayer, setSelectedRosterPlayer] = useState<RosterPlayer | null>(null);
  const [dropLoading, setDropLoading]                   = useState(false);
  const [dropError, setDropError]                       = useState('');

  const { playerDetail, detailLoading, openPlayerDetail, closePlayerDetail } = usePlayerDetail('', userId, null);

  const { confirm, pending: confirmPending, handleConfirm, handleCancel } = useConfirm();

  const selectedMember = joinedMembers.find(m => m.id === selectedMemberId) ?? null;
  const isOwnTeam      = selectedMember?.invitedUserId === userId;

  useEffect(() => {
    if (initialMemberId) {
      const match = joinedMembers.find(m => m.id === initialMemberId);
      if (match) setSelectedMemberId(match.id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMemberId]);

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
    if (!player.lrpId) return false;
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

    const title = isCommissionerDrop
      ? `Commissioner Action: Drop ${player.displayName} from ${selectedMember?.teamName ?? 'this team'}?`
      : `Drop ${player.displayName}?`;

    const ok = await confirm({
      title,
      message: contextNote,
      confirmLabel: 'Drop Player',
      danger: true,
    });
    if (!ok) return;

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

    handleCloseDetail();
    if (selectedMember) loadRoster(selectedMember);
    loadTransactions();
  }

  function handleTradeAction(didAccept: boolean) {
    loadTrades();
    if (didAccept) {
      if (selectedMember) loadRoster(selectedMember);
      loadTransactions();
    }
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

  // Only show Propose Trade when viewing own team and there are other joined members
  const canProposeTrade = isOwnTeam && joinedMembers.filter(m => m.invitedUserId !== userId).length > 0 && !!myTeam;

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
            {canProposeTrade && (
              <button
                onClick={() => setTradeDrawerOpen(true)}
                style={{
                  padding: '5px 14px', borderRadius: '9999px', fontSize: '13px', fontWeight: '600',
                  cursor: 'pointer', border: `1px solid ${blue}`,
                  background: 'rgba(59,130,246,0.12)', color: '#93c5fd',
                  transition: 'all 0.1s',
                }}
              >
                Propose Trade
              </button>
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
          <EmptyRosterShell starterSlots={starterSlots} benchSlots={benchSlots} />
        )}

        {!loading && !fetchError && players.length > 0 && assignments && (
          <>
            {unresolvedCount > 0 && (
              <div style={{ padding: '8px 16px', background: '#1c2840', borderBottom: `1px solid ${border}`, fontSize: '12px', color: '#93c5fd' }}>
                {unresolvedCount} player{unresolvedCount !== 1 ? 's' : ''} could not be matched and are shown with their imported names.
              </div>
            )}

            <SectionHeader label="Starters" />
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
                <SectionHeader label="Bench" />
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

      {!loading && selectedMember && (
        <RosterPicksCard picksState={picksState} activeDraftStatus={activeDraftStatus} />
      )}

      <PendingTradesCard
        leagueId={leagueId}
        userId={userId}
        isLeagueOwner={isLeagueOwner}
        pending={pendingTrades}
        recent={recentTrades}
        onTradeAction={handleTradeAction}
      />

      <RecentActivityCard activity={activity} userId={userId} />

      {!selectedMember && !loading && (
        <div style={{ marginTop: '16px', background: card, border: `1px solid ${border}`, borderRadius: '10px', padding: '24px', textAlign: 'center' }}>
          <p style={{ color: textSecondary, margin: 0, fontSize: '14px' }}>You are not connected to an imported team yet.</p>
          <p style={{ color: textSecondary, margin: '8px 0 0', fontSize: '13px' }}>
            Ask the league commissioner to send you an invite linked to your imported team.
          </p>
        </div>
      )}

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

      {confirmPending && (
        <ConfirmModal
          {...confirmPending.options}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      )}

      <TradeProposalDrawer
        open={tradeDrawerOpen}
        leagueId={leagueId}
        userId={userId}
        myMember={myTeam}
        joinedMembers={joinedMembers}
        leagueMembers={leagueMembers}
        myRoster={players}
        leagueSettings={leagueSettings}
        onClose={() => setTradeDrawerOpen(false)}
        onProposalSent={() => {
          setTradeDrawerOpen(false);
          loadTrades();
        }}
      />
    </div>
  );
}
