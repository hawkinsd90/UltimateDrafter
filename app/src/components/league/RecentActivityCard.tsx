import { posColor } from '../../utils/positionColors';
import { timeAgo } from '../../utils/time';
import type { ActivityItem, TransactionRow, TradeGroup } from '../../hooks/league/useTransactions';
import { isTradeGroup } from '../../hooks/league/useTransactions';

const card          = '#1e293b';
const border        = '#334155';
const textPrimary   = '#f1f5f9';
const textSecondary = '#94a3b8';
const green         = '#22c55e';

interface Props {
  activity: ActivityItem[];
  userId:   string;
}

function DropRow({ tx, userId, isLast }: { tx: TransactionRow; userId: string; isLast: boolean }) {
  const isMe      = tx.actor_user_id === userId;
  const isComm    = tx.metadata?.commissioner_action === true;
  const isCleanup = tx.metadata?.post_draft_cleanup === true;
  const team      = (tx.league_imported_members?.[0])?.team_name ?? null;
  const player    = tx.external_player_name ?? 'Unknown player';
  const pos       = tx.external_position;
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: '10px',
        padding: '10px 16px',
        borderBottom: !isLast ? `1px solid ${border}` : 'none',
      }}
    >
      <div style={{
        width: '28px', height: '28px', borderRadius: '50%', flexShrink: 0,
        background: 'rgba(239,68,68,0.15)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '12px', color: '#ef4444', fontWeight: '700',
      }}>
        ↓
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
          Dropped{team && ` from ${team}`}
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
}

function TradeGroupRow({ group, isLast }: { group: TradeGroup; isLast: boolean }) {
  // Build human-readable "Team A sent X for Y from Team B"
  const rows = group.rows;
  if (rows.length === 0) return null;

  // Identify the two teams from metadata
  const firstRow = rows[0];
  const fromTeam = (firstRow.metadata?.from_team as string) ?? null;
  const toTeam   = (firstRow.metadata?.to_team   as string) ?? null;
  const isComm   = rows.some(r => r.metadata?.commissioner_action === true);

  // Players moving from->to
  const sentPlayers     = rows.map(r => {
    const name = (r.metadata?.player_name as string) ?? r.external_player_name ?? 'Unknown';
    const pos  = (r.metadata?.position   as string) ?? r.external_position ?? null;
    return { name, pos };
  });

  // Build description: "Team A sent X and Y to Team B"
  const playerList = sentPlayers.map((p, i) => {
    const c = posColor(p.pos);
    return (
      <span key={i}>
        {i > 0 && (i === sentPlayers.length - 1 ? ' and ' : ', ')}
        <span style={{ fontWeight: '700', color: textPrimary }}>{p.name}</span>
        {p.pos && (
          <span style={{ marginLeft: '3px', fontSize: '10px', fontWeight: '700', padding: '1px 4px', borderRadius: '3px', background: c.bg, color: c.text }}>{p.pos}</span>
        )}
      </span>
    );
  });

  return (
    <div
      style={{
        display: 'flex', alignItems: 'flex-start', gap: '10px',
        padding: '10px 16px',
        borderBottom: !isLast ? `1px solid ${border}` : 'none',
      }}
    >
      <div style={{
        width: '28px', height: '28px', borderRadius: '50%', flexShrink: 0,
        background: 'rgba(34,197,94,0.12)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '12px', color: green, fontWeight: '700', marginTop: '1px',
      }}>
        ⇄
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '13px', color: textPrimary, lineHeight: '1.4' }}>
          <span style={{ fontWeight: '700' }}>Trade accepted: </span>
          {fromTeam && <span style={{ color: textSecondary }}>{fromTeam} </span>}
          sent {playerList}
          {toTeam && <> to <span style={{ color: textSecondary, fontWeight: '600' }}>{toTeam}</span></>}
          {isComm && (
            <span style={{ marginLeft: '6px', fontSize: '10px', fontWeight: '700', padding: '1px 6px', borderRadius: '4px', background: 'rgba(251,191,36,0.12)', color: '#fbbf24' }}>
              Commissioner
            </span>
          )}
        </div>
      </div>
      <div style={{ fontSize: '11px', color: '#475569', flexShrink: 0, marginTop: '2px' }}>
        {timeAgo(group.created_at)}
      </div>
    </div>
  );
}

export default function RecentActivityCard({ activity, userId }: Props) {
  if (activity.length === 0) return null;

  return (
    <div style={{ marginTop: '16px', background: card, border: `1px solid ${border}`, borderRadius: '10px', overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px', borderBottom: `1px solid ${border}` }}>
        <span style={{ fontSize: '14px', fontWeight: '700', color: textPrimary }}>Recent Activity</span>
      </div>
      {activity.map((item, i) => {
        const isLast = i === activity.length - 1;
        if (isTradeGroup(item)) {
          return <TradeGroupRow key={item.trade_proposal_id} group={item} isLast={isLast} />;
        }
        const tx = item as TransactionRow;
        return <DropRow key={tx.id} tx={tx} userId={userId} isLast={isLast} />;
      })}
    </div>
  );
}
