import { posColor } from '../../utils/positionColors';
import { timeAgo } from '../../utils/time';
import type { TransactionRow } from '../../hooks/league/useTransactions';

const card          = '#1e293b';
const border        = '#334155';
const textPrimary   = '#f1f5f9';
const textSecondary = '#94a3b8';

interface Props {
  transactions: TransactionRow[];
  userId:       string;
}

export default function RecentActivityCard({ transactions, userId }: Props) {
  if (transactions.length === 0) return null;

  return (
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
  );
}
