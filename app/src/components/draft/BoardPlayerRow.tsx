import { useState } from 'react';
import type { BoardPlayer } from '../../hooks/draft/draftTypes';
import { INJURY_COLORS, dt } from '../../hooks/draft/draftTypes';
import { positionBadgeBg, positionBadgeColor } from './positionBadge';

interface Props {
  player: BoardPlayer;
  index: number;
  totalCount: number;
  isPicked: boolean;
  canPick: boolean;
  isMoveOpen: boolean;
  onToggleMove: (id: string | null) => void;
  onReorder: (from: number, to: number) => void;
  onRemove: (rankingId: string) => void;
  onPick: (playerId: string) => void;
}

export default function BoardPlayerRow({
  player, index, totalCount, isPicked, canPick,
  isMoveOpen, onToggleMove,
  onReorder, onRemove, onPick,
}: Props) {
  const [rankInput, setRankInput] = useState('');
  const [rankError, setRankError] = useState('');

  const injuryLabel = player.injury_status;
  const injuryColor = injuryLabel ? (INJURY_COLORS[injuryLabel] ?? '#64748b') : null;

  function move(toIndex: number) {
    const clamped = Math.max(0, Math.min(totalCount - 1, toIndex));
    if (clamped !== index) onReorder(index, clamped);
    onToggleMove(null);
  }

  function handleMoveToRank() {
    const n = parseInt(rankInput, 10);
    if (isNaN(n) || n < 1 || n > totalCount) {
      setRankError(`Enter a number between 1 and ${totalCount}.`);
      return;
    }
    setRankError('');
    setRankInput('');
    move(n - 1);
  }

  return (
    <div>
      {/* Main row */}
      <div style={{
        padding: '10px 12px', borderRadius: isMoveOpen ? '7px 7px 0 0' : '7px',
        border: `1px solid ${isMoveOpen ? dt.blue : isPicked ? '#1e3a5f' : dt.border}`,
        borderBottom: isMoveOpen ? 'none' : undefined,
        background: isPicked ? '#0c1929' : dt.cardInner,
        opacity: isPicked ? 0.5 : 1,
        display: 'flex', alignItems: 'center', gap: '8px',
      }}>
        {/* Rank number */}
        <div style={{ minWidth: '28px', textAlign: 'center' }}>
          <span style={{ fontSize: '12px', fontWeight: '700', color: isPicked ? dt.textSecondary : dt.textPrimary }}>
            {index + 1}
          </span>
        </div>

        {/* Player info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: '600', fontSize: '13px', color: isPicked ? dt.textSecondary : dt.textPrimary }}>
              {player.display_name}
            </span>
            {isPicked && (
              <span style={{ fontSize: '10px', fontWeight: '700', padding: '1px 5px', borderRadius: '4px', background: '#1e3a8a', color: '#93c5fd' }}>
                Drafted
              </span>
            )}
            {injuryLabel && injuryColor && !isPicked && (
              <span style={{ fontSize: '10px', fontWeight: '600', color: injuryColor }}>{injuryLabel}</span>
            )}
          </div>
          <div style={{ fontSize: '11px', color: dt.textSecondary }}>
            {player.team_abbr ? `${player.team_abbr} · ` : ''}{player.fantasy_position ?? player.position ?? '—'}
          </div>
        </div>

        {/* Position badge */}
        <span style={{
          padding: '2px 7px', borderRadius: '4px', fontSize: '11px', fontWeight: '700',
          background: positionBadgeBg(player.fantasy_position),
          color: positionBadgeColor(player.fantasy_position),
          flexShrink: 0,
        }}>
          {player.fantasy_position ?? player.position ?? '—'}
        </span>

        {/* Actions */}
        <div style={{ display: 'flex', gap: '4px', flexShrink: 0, alignItems: 'center' }}>
          {canPick && !isPicked && (
            <button
              onClick={() => onPick(player.id)}
              style={{ padding: '4px 10px', fontSize: '12px', fontWeight: '700', background: '#14532d', color: dt.green, border: `1px solid ${dt.greenDark}`, borderRadius: '5px', cursor: 'pointer' }}
            >
              Pick
            </button>
          )}
          {!isPicked && (
            <button
              onClick={() => onToggleMove(isMoveOpen ? null : player.id)}
              title="Move"
              style={{
                padding: '4px 7px', fontSize: '13px', lineHeight: 1, fontWeight: '700',
                background: isMoveOpen ? dt.blue : 'transparent',
                color: isMoveOpen ? '#fff' : '#64748b',
                border: `1px solid ${isMoveOpen ? dt.blue : dt.border}`,
                borderRadius: '5px', cursor: 'pointer',
                transition: 'background 0.12s, color 0.12s',
              }}
            >
              ⇅ Move
            </button>
          )}
          <button
            onClick={() => player.rankingId && onRemove(player.rankingId)}
            style={{ padding: '4px 8px', fontSize: '14px', background: 'transparent', color: '#64748b', border: 'none', cursor: 'pointer', lineHeight: 1 }}
          >×</button>
        </div>
      </div>

      {/* Inline move panel */}
      {isMoveOpen && !isPicked && (
        <div style={{
          padding: '10px 12px',
          border: `1px solid ${dt.blue}`,
          borderTop: `1px solid ${dt.border}`,
          borderRadius: '0 0 7px 7px',
          background: '#0d1e35',
          display: 'flex', flexDirection: 'column', gap: '8px',
        }}>
          {/* Quick move buttons */}
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {[
              { label: '⇈ Top',    action: () => move(0) },
              { label: '↑ 5',      action: () => move(index - 5) },
              { label: '↑ 1',      action: () => move(index - 1) },
              { label: '↓ 1',      action: () => move(index + 1) },
              { label: '↓ 5',      action: () => move(index + 5) },
              { label: '⇊ Bottom', action: () => move(totalCount - 1) },
            ].map(({ label, action }) => (
              <button
                key={label}
                onClick={action}
                style={{
                  padding: '5px 11px', fontSize: '12px', fontWeight: '600',
                  background: 'transparent', color: dt.textPrimary,
                  border: `1px solid ${dt.border}`, borderRadius: '5px',
                  cursor: 'pointer',
                  transition: 'border-color 0.1s',
                }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = dt.blue)}
                onMouseLeave={e => (e.currentTarget.style.borderColor = dt.border)}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Move to rank # */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '12px', color: dt.textSecondary, whiteSpace: 'nowrap' }}>Move to rank</span>
            <input
              type="number"
              min={1}
              max={totalCount}
              value={rankInput}
              onChange={e => { setRankInput(e.target.value); setRankError(''); }}
              onKeyDown={e => e.key === 'Enter' && handleMoveToRank()}
              placeholder={`1–${totalCount}`}
              style={{
                width: '72px', padding: '4px 8px', fontSize: '13px',
                background: dt.cardInner, color: dt.textPrimary,
                border: `1px solid ${rankError ? '#ef4444' : dt.border}`,
                borderRadius: '5px', outline: 'none',
              }}
            />
            <button
              onClick={handleMoveToRank}
              style={{
                padding: '4px 12px', fontSize: '12px', fontWeight: '600',
                background: dt.blue, color: '#fff',
                border: 'none', borderRadius: '5px', cursor: 'pointer',
              }}
            >
              Go
            </button>
            <button
              onClick={() => { onToggleMove(null); setRankInput(''); setRankError(''); }}
              style={{ padding: '4px 8px', fontSize: '12px', background: 'transparent', color: dt.textSecondary, border: `1px solid ${dt.border}`, borderRadius: '5px', cursor: 'pointer' }}
            >
              Close
            </button>
          </div>

          {rankError && (
            <span style={{ fontSize: '11px', color: '#ef4444' }}>{rankError}</span>
          )}
        </div>
      )}
    </div>
  );
}
