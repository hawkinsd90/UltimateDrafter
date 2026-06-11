import { useState } from 'react';
import { posColor } from '../../utils/positionColors';
import { timeAgo } from '../../utils/time';
import type { TradeProposal } from '../../hooks/league/useTrades';
import { useTradeProposal } from '../../hooks/league/useTradeProposal';
import { useConfirm } from '../../hooks/useConfirm';
import ConfirmModal from '../ConfirmModal';

const card          = '#1e293b';
const border        = '#334155';
const textPrimary   = '#f1f5f9';
const textSecondary = '#94a3b8';
const amber         = '#fbbf24';
const green         = '#22c55e';
const red           = '#ef4444';
const blue          = '#3b82f6';

interface Props {
  leagueId:      string;
  userId:        string;
  isLeagueOwner: boolean;
  pending:       TradeProposal[];
  recent:        TradeProposal[];
  onTradeAction: (didAccept: boolean) => void;
}

function PlayerPill({ name, pos }: { name: string; pos: string | null }) {
  const c = posColor(pos);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', marginRight: '4px', marginBottom: '4px' }}>
      <span style={{ fontSize: '12px', color: textPrimary, fontWeight: '600' }}>{name}</span>
      {pos && (
        <span style={{ fontSize: '10px', fontWeight: '700', padding: '1px 5px', borderRadius: '4px', background: c.bg, color: c.text }}>
          {pos}
        </span>
      )}
    </span>
  );
}

function TradeRow({ proposal, userId, isLeagueOwner, onAction }: {
  proposal:      TradeProposal;
  userId:        string;
  isLeagueOwner: boolean;
  onAction:      (didAccept: boolean) => void;
}) {
  const { submitting, error, clearError, acceptProposal, rejectProposal, cancelProposal } = useTradeProposal();
  const { confirm, pending: confirmPending, handleConfirm, handleCancel: handleConfirmCancel } = useConfirm();
  const [localError, setLocalError] = useState('');

  const isProposer  = proposal.proposer_user_id === userId;
  const isReceiver  = !isProposer;
  const canCancel   = isProposer || isLeagueOwner;

  const sendPlayers    = proposal.players.filter(p => p.direction === 'send');
  const receivePlayers = proposal.players.filter(p => p.direction === 'receive');

  async function handleAccept() {
    clearError();
    setLocalError('');
    const ok = await confirm({
      title:        'Accept trade?',
      message:      `Accept this trade? ${proposal.proposer_team_name ?? 'Proposer'} sent ${sendPlayers.map(p => p.snapshot_player_name).join(', ')} for ${receivePlayers.map(p => p.snapshot_player_name).join(', ')}. This cannot be undone.`,
      confirmLabel: 'Accept Trade',
    });
    if (!ok) return;

    const success = await acceptProposal(proposal.id);
    if (!success) {
      setLocalError(error || 'Failed to accept trade.');
      return;
    }
    onAction(true);
  }

  async function handleReject() {
    clearError();
    setLocalError('');
    const ok = await confirm({
      title:        'Reject trade?',
      message:      'Reject this trade proposal? The proposer will be notified.',
      confirmLabel: 'Reject Trade',
      danger:       true,
    });
    if (!ok) return;

    const success = await rejectProposal(proposal.id);
    if (!success) {
      setLocalError(error || 'Failed to reject trade.');
      return;
    }
    onAction(false);
  }

  async function handleCancelProposal() {
    clearError();
    setLocalError('');
    const isCommCancel = isLeagueOwner && !isProposer;
    const ok = await confirm({
      title:        isCommCancel ? 'Cancel trade (Commissioner)?' : 'Cancel trade proposal?',
      message:      isCommCancel
        ? 'As commissioner, you are canceling this trade proposal. This action will be logged.'
        : 'Cancel your trade proposal? The other team will not be notified.',
      confirmLabel: 'Cancel Proposal',
      danger:       true,
    });
    if (!ok) return;

    const success = await cancelProposal(proposal.id);
    if (!success) {
      setLocalError(error || 'Failed to cancel trade.');
      return;
    }
    onAction(false);
  }

  return (
    <div style={{ padding: '14px 16px', borderBottom: `1px solid ${border}` }}>
      {(localError) && (
        <div style={{ marginBottom: '8px', padding: '8px 10px', background: 'rgba(239,68,68,0.1)', borderRadius: '6px', fontSize: '12px', color: red }}>
          {localError}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '12px', color: textSecondary, marginBottom: '6px' }}>
            <span style={{ fontWeight: '700', color: textPrimary }}>{proposal.proposer_team_name ?? 'Unknown'}</span>
            {' '}proposes to{' '}
            <span style={{ fontWeight: '700', color: textPrimary }}>{proposal.receiver_team_name ?? 'Unknown'}</span>
            {proposal.message && (
              <span style={{ display: 'block', marginTop: '4px', fontStyle: 'italic', color: textSecondary }}>
                "{proposal.message}"
              </span>
            )}
          </div>

          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: '10px', fontWeight: '700', color: textSecondary, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>
                {proposal.proposer_team_name ?? 'Proposer'} sends
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap' }}>
                {sendPlayers.map(p => (
                  <PlayerPill key={p.id} name={p.snapshot_player_name} pos={p.snapshot_position} />
                ))}
              </div>
            </div>
            <div style={{ alignSelf: 'center', color: textSecondary, fontSize: '16px', fontWeight: '700' }}>⇄</div>
            <div>
              <div style={{ fontSize: '10px', fontWeight: '700', color: textSecondary, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>
                {proposal.receiver_team_name ?? 'Receiver'} sends
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap' }}>
                {receivePlayers.map(p => (
                  <PlayerPill key={p.id} name={p.snapshot_player_name} pos={p.snapshot_position} />
                ))}
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-end', flexShrink: 0 }}>
          <div style={{ fontSize: '11px', color: '#475569' }}>
            {timeAgo(proposal.created_at)} · expires {timeAgo(proposal.expires_at)}
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            {isReceiver && (
              <>
                <button
                  onClick={handleAccept}
                  disabled={submitting}
                  style={{
                    padding: '5px 14px', borderRadius: '7px', fontSize: '12px', fontWeight: '700',
                    cursor: submitting ? 'not-allowed' : 'pointer', border: 'none',
                    background: green, color: '#fff', opacity: submitting ? 0.6 : 1,
                    transition: 'opacity 0.15s',
                  }}
                >
                  Accept
                </button>
                <button
                  onClick={handleReject}
                  disabled={submitting}
                  style={{
                    padding: '5px 14px', borderRadius: '7px', fontSize: '12px', fontWeight: '700',
                    cursor: submitting ? 'not-allowed' : 'pointer', border: `1px solid ${red}`,
                    background: 'transparent', color: red, opacity: submitting ? 0.6 : 1,
                    transition: 'opacity 0.15s',
                  }}
                >
                  Reject
                </button>
              </>
            )}
            {canCancel && (
              <button
                onClick={handleCancelProposal}
                disabled={submitting}
                style={{
                  padding: '5px 14px', borderRadius: '7px', fontSize: '12px', fontWeight: '600',
                  cursor: submitting ? 'not-allowed' : 'pointer', border: `1px solid ${border}`,
                  background: 'transparent', color: textSecondary, opacity: submitting ? 0.6 : 1,
                  transition: 'opacity 0.15s',
                }}
              >
                {isLeagueOwner && !isProposer ? 'Cancel (Comm.)' : 'Cancel'}
              </button>
            )}
          </div>
        </div>
      </div>

      {confirmPending && (
        <ConfirmModal
          {...confirmPending.options}
          onConfirm={handleConfirm}
          onCancel={handleConfirmCancel}
        />
      )}
    </div>
  );
}

export default function PendingTradesCard({ leagueId: _leagueId, userId, isLeagueOwner, pending, recent, onTradeAction }: Props) {
  const myPending     = pending.filter(p => p.proposer_user_id === userId || p.proposer_user_id !== userId);
  const hasPending    = myPending.length > 0;
  const [showRecent, setShowRecent] = useState(false);

  if (!hasPending && recent.length === 0) return null;

  return (
    <div style={{ marginTop: '16px', background: card, border: `1px solid ${border}`, borderRadius: '10px', overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px', borderBottom: hasPending || showRecent ? `1px solid ${border}` : 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '14px', fontWeight: '700', color: textPrimary }}>Trades</span>
          {hasPending && (
            <span style={{ fontSize: '11px', fontWeight: '700', padding: '2px 7px', borderRadius: '9999px', background: 'rgba(59,130,246,0.15)', color: blue }}>
              {myPending.length} pending
            </span>
          )}
        </div>
        {recent.length > 0 && (
          <button
            onClick={() => setShowRecent(v => !v)}
            style={{
              fontSize: '12px', color: textSecondary, background: 'none', border: 'none',
              cursor: 'pointer', padding: '2px 6px',
            }}
          >
            {showRecent ? 'Hide history' : 'Show history'}
          </button>
        )}
      </div>

      {hasPending && myPending.map(p => (
        <TradeRow
          key={p.id}
          proposal={p}
          userId={userId}
          isLeagueOwner={isLeagueOwner}
          onAction={onTradeAction}
        />
      ))}

      {showRecent && recent.map((p, i) => {
        const sendPlayers    = p.players.filter(pl => pl.direction === 'send');
        const receivePlayers = p.players.filter(pl => pl.direction === 'receive');
        const statusColor = p.status === 'accepted' ? green : p.status === 'rejected' ? red : textSecondary;
        return (
          <div
            key={p.id}
            style={{
              padding: '10px 16px', display: 'flex', alignItems: 'flex-start', gap: '10px',
              borderBottom: i < recent.length - 1 ? `1px solid ${border}` : 'none',
              opacity: 0.75,
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '12px', color: textSecondary }}>
                <span style={{ fontWeight: '600', color: textPrimary }}>{p.proposer_team_name ?? 'Unknown'}</span>
                {' → '}
                <span style={{ fontWeight: '600', color: textPrimary }}>{p.receiver_team_name ?? 'Unknown'}</span>
                {' · '}
                {sendPlayers.map(pl => pl.snapshot_player_name).join(', ')}
                {' for '}
                {receivePlayers.map(pl => pl.snapshot_player_name).join(', ')}
                {p.commissioner_action && (
                  <span style={{ marginLeft: '6px', fontSize: '10px', padding: '1px 5px', borderRadius: '4px', background: 'rgba(251,191,36,0.12)', color: amber }}>
                    Commissioner
                  </span>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px', flexShrink: 0 }}>
              <span style={{ fontSize: '11px', fontWeight: '700', color: statusColor, textTransform: 'capitalize' }}>
                {p.status}
              </span>
              <span style={{ fontSize: '11px', color: '#475569' }}>{timeAgo(p.updated_at)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
