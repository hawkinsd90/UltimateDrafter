import type { BoardPlayer } from '../../hooks/draft/draftTypes';
import { INJURY_COLORS, dt } from '../../hooks/draft/draftTypes';
import { positionBadgeBg, positionBadgeColor } from './positionBadge';

interface Props {
  player: BoardPlayer;
  index: number;
  totalCount: number;
  isPicked: boolean;
  canPick: boolean;
  onReorder: (from: number, to: number) => void;
  onRemove: (rankingId: string) => void;
  onPick: (playerId: string) => void;
}

export default function BoardPlayerRow({ player, index, totalCount, isPicked, canPick, onReorder, onRemove, onPick }: Props) {
  const injuryLabel = player.injury_status;
  const injuryColor = injuryLabel ? (INJURY_COLORS[injuryLabel] ?? '#64748b') : null;

  return (
    <div style={{
      padding: '10px 12px', borderRadius: '7px',
      border: `1px solid ${isPicked ? '#1e3a5f' : dt.border}`,
      background: isPicked ? '#0c1929' : dt.cardInner,
      opacity: isPicked ? 0.5 : 1,
      display: 'flex', alignItems: 'center', gap: '8px',
    }}>
      {/* Rank + up/down */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1px', minWidth: '28px' }}>
        <span style={{ fontSize: '12px', fontWeight: '700', color: isPicked ? dt.textSecondary : dt.textPrimary, lineHeight: 1 }}>
          {index + 1}
        </span>
        {!isPicked && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
            <button
              onClick={() => index > 0 && onReorder(index, index - 1)}
              disabled={index === 0}
              style={{ padding: '0 4px', lineHeight: '14px', fontSize: '10px', background: 'transparent', color: index === 0 ? dt.border : '#64748b', border: 'none', cursor: index === 0 ? 'default' : 'pointer' }}
            >▲</button>
            <button
              onClick={() => index < totalCount - 1 && onReorder(index, index + 1)}
              disabled={index === totalCount - 1}
              style={{ padding: '0 4px', lineHeight: '14px', fontSize: '10px', background: 'transparent', color: index === totalCount - 1 ? dt.border : '#64748b', border: 'none', cursor: index === totalCount - 1 ? 'default' : 'pointer' }}
            >▼</button>
          </div>
        )}
      </div>

      {/* Info */}
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
      <span style={{ padding: '2px 7px', borderRadius: '4px', fontSize: '11px', fontWeight: '700', background: positionBadgeBg(player.fantasy_position), color: positionBadgeColor(player.fantasy_position), flexShrink: 0 }}>
        {player.fantasy_position ?? player.position ?? '—'}
      </span>

      {/* Actions */}
      <div style={{ display: 'flex', gap: '5px', flexShrink: 0 }}>
        {canPick && !isPicked && (
          <button
            onClick={() => onPick(player.id)}
            style={{ padding: '4px 10px', fontSize: '12px', fontWeight: '700', background: '#14532d', color: dt.green, border: `1px solid ${dt.greenDark}`, borderRadius: '5px', cursor: 'pointer' }}
          >
            Pick
          </button>
        )}
        <button
          onClick={() => player.rankingId && onRemove(player.rankingId)}
          style={{ padding: '4px 8px', fontSize: '14px', background: 'transparent', color: '#64748b', border: 'none', cursor: 'pointer', lineHeight: 1 }}
        >×</button>
      </div>
    </div>
  );
}
