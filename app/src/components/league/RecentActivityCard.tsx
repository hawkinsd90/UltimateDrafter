import type { ReactNode } from 'react';
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
  const rows = group.rows;
  if (rows.length === 0) return null;

  const isComm = rows.some(r => r.metadata?.commissioner_action === true);

  // Build a map of team → players they sent (i.e. players that left that team)
  // Each transaction row represents one player moving from from_team to to_team.
  // We want to display: "Team A sent X and Y to Team B for Z."
  // Collect unique team pairs and group players per "from → to" direction.
  const teamGroups = new Map<string, { fromTeam: string; toTeam: string; players: Array<{ name: string; pos: string | null }> }>();

  for (const r of rows) {
    const fromTeam = (r.metadata?.from_team as string) ?? 'Unknown';
    const toTeam   = (r.metadata?.to_team   as string) ?? 'Unknown';
    const key = `${fromTeam}|||${toTeam}`;
    if (!teamGroups.has(key)) teamGroups.set(key, { fromTeam, toTeam, players: [] });
    teamGroups.get(key)!.players.push({
      name: (r.metadata?.player_name as string) ?? r.external_player_name ?? 'Unknown',
      pos:  (r.metadata?.position   as string) ?? r.external_position ?? null,
    });
  }

  const groups = Array.from(teamGroups.values());

  // Build "Team A sent X to Team B for Y" when there are exactly two directions.
  // For more complex cases, fall back to listing each direction separately.
  let summary: ReactNode;

  if (groups.length === 2) {
    const [a, b] = groups;
    const aList = a.players.map((p, i) => {
      const c = posColor(p.pos);
      return (
        <span key={i}>
          {i > 0 && (i === a.players.length - 1 ? ' and ' : ', ')}
          <span style={{ fontWeight: '700', color: textPrimary }}>{p.name}</span>
          {p.pos && <span style={{ marginLeft: '3px', fontSize: '10px', fontWeight: '700', padding: '1px 4px', borderRadius: '3px', background: c.bg, color: c.text }}>{p.pos}</span>}
        </span>
      );
    });
    const bList = b.players.map((p, i) => {
      const c = posColor(p.pos);
      return (
        <span key={i}>
          {i > 0 && (i === b.players.length - 1 ? ' and ' : ', ')}
          <span style={{ fontWeight: '700', color: textPrimary }}>{p.name}</span>
          {p.pos && <span style={{ marginLeft: '3px', fontSize: '10px', fontWeight: '700', padding: '1px 4px', borderRadius: '3px', background: c.bg, color: c.text }}>{p.pos}</span>}
        </span>
      );
    });
    summary = (
      <>
        <span style={{ fontWeight: '700' }}>Trade accepted: </span>
        <span style={{ color: textSecondary }}>{a.fromTeam} </span>
        sent {aList}
        <span style={{ color: textSecondary }}> to {a.toTeam}</span>
        {' for '}
        {bList}
      </>
    );
  } else {
    // Fallback: list each direction as its own line
    summary = (
      <>
        <span style={{ fontWeight: '700' }}>Trade accepted: </span>
        {groups.map((g, gi) => {
          const list = g.players.map((p, i) => {
            const c = posColor(p.pos);
            return (
              <span key={i}>
                {i > 0 && ', '}
                <span style={{ fontWeight: '700', color: textPrimary }}>{p.name}</span>
                {p.pos && <span style={{ marginLeft: '3px', fontSize: '10px', fontWeight: '700', padding: '1px 4px', borderRadius: '3px', background: c.bg, color: c.text }}>{p.pos}</span>}
              </span>
            );
          });
          return (
            <span key={gi}>
              {gi > 0 && '; '}
              <span style={{ color: textSecondary }}>{g.fromTeam}</span>
              {' sent '}
              {list}
              <span style={{ color: textSecondary }}> to {g.toTeam}</span>
            </span>
          );
        })}
      </>
    );
  }

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
          {summary}
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
