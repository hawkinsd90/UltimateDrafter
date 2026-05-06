import type { AvailablePlayer, SortMode } from '../../hooks/draft/draftTypes';
import { INJURY_COLORS, dt } from '../../hooks/draft/draftTypes';
import { positionBadgeBg, positionBadgeColor } from './positionBadge';

interface Props {
  player: AvailablePlayer;
  isPicked: boolean;
  isOnBoard: boolean;
  canPick: boolean;
  sortMode: SortMode;
  onAdd: (id: string) => void;
  onPick: (id: string) => void;
}

export default function AvailablePlayerRow({ player, isPicked, isOnBoard, canPick, sortMode, onAdd, onPick }: Props) {
  const injuryLabel = player.injury_status;
  const injuryColor = injuryLabel ? (INJURY_COLORS[injuryLabel] ?? '#64748b') : null;

  return (
    <div style={{
      padding: '10px 12px', borderRadius: '7px', border: `1px solid ${dt.border}`,
      background: dt.cardInner, opacity: isPicked ? 0.45 : 1,
      display: 'flex', alignItems: 'center', gap: '10px',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: '600', fontSize: '13px', color: dt.textPrimary }}>
            {player.display_name}
          </span>
          {isPicked && (
            <span style={{ fontSize: '10px', fontWeight: '700', padding: '1px 5px', borderRadius: '4px', background: '#1e3a8a', color: '#93c5fd' }}>
              Drafted
            </span>
          )}
          {isOnBoard && !isPicked && (
            <span style={{ fontSize: '10px', fontWeight: '700', padding: '1px 5px', borderRadius: '4px', background: '#064e3b', color: '#6ee7b7' }}>
              On Board
            </span>
          )}
          {injuryLabel && injuryColor && !isPicked && (
            <span style={{ fontSize: '10px', fontWeight: '600', color: injuryColor }}>{injuryLabel}</span>
          )}
        </div>
        <div style={{ fontSize: '11px', color: dt.textSecondary }}>
          {player.team_abbr ? `${player.team_abbr} · ` : ''}{player.fantasy_position ?? player.position ?? '—'}
          {sortMode === 'espn' && player.espn_rank != null && (
            <span style={{ marginLeft: '6px', color: '#60a5fa' }}>ESPN #{player.espn_rank}</span>
          )}
          {sortMode === 'sleeper' && player.sleeper_rank != null && (
            <span style={{ marginLeft: '6px', color: '#34d399' }}>Sleeper #{player.sleeper_rank}</span>
          )}
        </div>
      </div>

      <span style={{ padding: '2px 7px', borderRadius: '4px', fontSize: '11px', fontWeight: '700', background: positionBadgeBg(player.fantasy_position), color: positionBadgeColor(player.fantasy_position), flexShrink: 0 }}>
        {player.fantasy_position ?? player.position ?? '—'}
      </span>

      {!isPicked && !isOnBoard && (
        <button
          onClick={() => onAdd(player.id)}
          style={{ padding: '4px 10px', fontSize: '12px', fontWeight: '600', background: 'transparent', color: dt.blue, border: `1px solid ${dt.blue}`, borderRadius: '5px', cursor: 'pointer', flexShrink: 0 }}
        >
          + Add
        </button>
      )}
      {!isPicked && isOnBoard && canPick && (
        <button
          onClick={() => onPick(player.id)}
          style={{ padding: '4px 10px', fontSize: '12px', fontWeight: '700', background: '#14532d', color: dt.green, border: `1px solid ${dt.greenDark}`, borderRadius: '5px', cursor: 'pointer', flexShrink: 0 }}
        >
          Pick
        </button>
      )}
      {!isPicked && isOnBoard && !canPick && (
        <span style={{ fontSize: '11px', color: '#6ee7b7', flexShrink: 0 }}>On Board</span>
      )}
      {isPicked && (
        <span style={{ fontSize: '12px', color: dt.textSecondary, flexShrink: 0 }}>Drafted</span>
      )}
    </div>
  );
}
