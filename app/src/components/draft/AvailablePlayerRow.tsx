import type { AvailablePlayer, RankingSource, SortByMode } from '../../hooks/draft/draftTypes';
import { INJURY_COLORS, RANKING_SOURCE_LABELS, dt } from '../../hooks/draft/draftTypes';
import { positionBadgeBg, positionBadgeColor } from './positionBadge';

interface Props {
  player: AvailablePlayer;
  isPicked: boolean;
  isOnBoard: boolean;
  canPick: boolean;
  sortByMode: SortByMode;
  rankingSource: RankingSource;
  onAdd: (id: string) => void;
  onPick: (id: string) => void;
}

function primaryStatLabel(player: AvailablePlayer, sortByMode: SortByMode, rankingSource: RankingSource): string | null {
  const src = RANKING_SOURCE_LABELS[rankingSource];
  if (sortByMode === 'relevance' || sortByMode === 'overall_rank') {
    if (player.overall_rank != null) return `${src} #${player.overall_rank}`;
  }
  if (sortByMode === 'position_rank') {
    if (player.position_rank_label) return `${src} ${player.position_rank_label}`;
    if (player.position_rank != null) {
      const pos = player.fantasy_position ?? player.nfl_position ?? '';
      return `${src} ${pos}#${player.position_rank}`;
    }
  }
  if (sortByMode === 'adp' && player.adp != null) {
    return `ADP ${player.adp.toFixed(1)}`;
  }
  if (sortByMode === 'fantasy_points' && player.fantasy_points != null) {
    return `${player.fantasy_points.toFixed(1)} pts`;
  }
  return null;
}

// Secondary context shown regardless of sort mode: position rank or points
function secondaryStatLabel(player: AvailablePlayer, sortByMode: SortByMode, rankingSource: RankingSource): string | null {
  // Don't double-show what's already the primary label
  if (sortByMode === 'fantasy_points') {
    // Show position rank as secondary
    if (player.position_rank_label) return player.position_rank_label;
    if (player.position_rank != null) {
      const pos = player.fantasy_position ?? player.nfl_position ?? '';
      return `${pos}${player.position_rank}`;
    }
    return null;
  }
  if (sortByMode === 'position_rank' || sortByMode === 'overall_rank' || sortByMode === 'relevance') {
    // Show points as secondary for last_season; position rank for others when showing overall
    if (rankingSource === 'last_season' && player.fantasy_points != null) {
      return `${player.fantasy_points.toFixed(1)} pts`;
    }
    return null;
  }
  return null;
}

export default function AvailablePlayerRow({
  player, isPicked, isOnBoard, canPick, sortByMode, rankingSource, onAdd, onPick,
}: Props) {
  const injuryLabel  = player.injury_status;
  const injuryColor  = injuryLabel ? (INJURY_COLORS[injuryLabel] ?? '#64748b') : null;
  const primaryLabel = primaryStatLabel(player, sortByMode, rankingSource);
  const secondLabel  = secondaryStatLabel(player, sortByMode, rankingSource);

  // Ownership / trend — only show when data exists
  const showOwnership = player.percent_owned != null && player.percent_owned > 0;
  const showTrend     = player.trend_count != null && player.trend_count !== 0;

  return (
    <div style={{
      padding: '9px 10px', borderRadius: '7px', border: `1px solid ${dt.border}`,
      background: dt.cardInner, opacity: isPicked ? 0.45 : 1,
      display: 'flex', alignItems: 'center', gap: '8px',
    }}>

      {/* Action button — leftmost, fixed width */}
      <div style={{ flexShrink: 0, width: '52px' }}>
        {!isPicked && !isOnBoard && (
          <button
            onClick={() => onAdd(player.id)}
            style={{
              width: '100%', padding: '5px 0', fontSize: '12px', fontWeight: '600',
              background: 'transparent', color: dt.blue,
              border: `1px solid ${dt.blue}`, borderRadius: '5px', cursor: 'pointer',
            }}
          >
            + Add
          </button>
        )}
        {!isPicked && isOnBoard && canPick && (
          <button
            onClick={() => onPick(player.id)}
            style={{
              width: '100%', padding: '5px 0', fontSize: '12px', fontWeight: '700',
              background: '#14532d', color: dt.green,
              border: `1px solid ${dt.greenDark}`, borderRadius: '5px', cursor: 'pointer',
            }}
          >
            Pick
          </button>
        )}
        {!isPicked && isOnBoard && !canPick && (
          <span style={{ fontSize: '11px', color: '#6ee7b7', display: 'block', textAlign: 'center' }}>On Board</span>
        )}
        {isPicked && (
          <span style={{ fontSize: '11px', color: dt.textSecondary, display: 'block', textAlign: 'center' }}>Drafted</span>
        )}
      </div>

      {/* Player info — main column */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Name row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: '600', fontSize: '13px', color: dt.textPrimary, lineHeight: 1.2 }}>
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

        {/* Meta row: team · position · rank label */}
        <div style={{ fontSize: '11px', color: dt.textSecondary, marginTop: '2px', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px' }}>
          <span>{player.team_abbr ? `${player.team_abbr} ·` : ''} {player.fantasy_position ?? player.nfl_position ?? '—'}</span>
          {primaryLabel && (
            <span style={{ color: '#60a5fa', fontWeight: '500' }}>{primaryLabel}</span>
          )}
          {secondLabel && (
            <span style={{ color: '#94a3b8' }}>{secondLabel}</span>
          )}
        </div>

        {/* Ownership / trend row */}
        {(showOwnership || showTrend) && (
          <div style={{ fontSize: '10px', color: dt.textSecondary, marginTop: '2px', display: 'flex', gap: '8px' }}>
            {showOwnership && (
              <span style={{ color: '#94a3b8' }}>{player.percent_owned!.toFixed(0)}% Rost</span>
            )}
            {showTrend && (
              <span style={{ color: player.trend_count! > 0 ? '#4ade80' : '#f87171' }}>
                {player.trend_count! > 0 ? '+' : ''}{player.trend_count!.toFixed(1)}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Position badge — right */}
      <span style={{
        padding: '2px 7px', borderRadius: '4px', fontSize: '11px', fontWeight: '700',
        background: positionBadgeBg(player.fantasy_position),
        color: positionBadgeColor(player.fantasy_position),
        flexShrink: 0,
      }}>
        {player.fantasy_position ?? player.nfl_position ?? '—'}
      </span>

    </div>
  );
}
