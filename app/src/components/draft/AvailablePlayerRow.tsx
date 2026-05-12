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
  onOpenDetail: (id: string) => void;
}

// Returns the primary rank/stat label for the selected source + sort
function rankLabel(player: AvailablePlayer, sortByMode: SortByMode, rankingSource: RankingSource): string | null {
  const src = RANKING_SOURCE_LABELS[rankingSource];
  if (sortByMode === 'relevance' || sortByMode === 'overall_rank') {
    if (player.overall_rank != null) return `${src} #${player.overall_rank}`;
  }
  if (sortByMode === 'position_rank') {
    if (player.position_rank_label) return `${src} ${player.position_rank_label}`;
    if (player.position_rank != null) {
      const pos = player.fantasy_position ?? player.nfl_position ?? '';
      return `${src} ${pos}${player.position_rank}`;
    }
  }
  if (sortByMode === 'adp' && player.adp != null) return `ADP ${player.adp.toFixed(1)}`;
  if (sortByMode === 'fantasy_points' && player.fantasy_points != null) return `${player.fantasy_points.toFixed(1)} pts`;
  return null;
}

// Returns a secondary context line (e.g. position rank when showing points, or points when showing rank)
function secondaryLabel(player: AvailablePlayer, sortByMode: SortByMode, rankingSource: RankingSource): string | null {
  if (sortByMode === 'fantasy_points') {
    if (player.position_rank_label) return player.position_rank_label;
    if (player.position_rank != null) {
      const pos = player.fantasy_position ?? player.nfl_position ?? '';
      return `${pos}${player.position_rank}`;
    }
  }
  if ((sortByMode === 'overall_rank' || sortByMode === 'relevance') && rankingSource === 'last_season') {
    if (player.fantasy_points != null) return `${player.fantasy_points.toFixed(1)} pts`;
  }
  if (sortByMode === 'overall_rank' || sortByMode === 'relevance') {
    if (player.position_rank_label) return player.position_rank_label;
    if (player.position_rank != null) {
      const pos = player.fantasy_position ?? player.nfl_position ?? '';
      return `${pos}${player.position_rank}`;
    }
  }
  return null;
}

// Right-column stat value for the selected sort (compact, numeric)
function rightStatValue(player: AvailablePlayer, sortByMode: SortByMode): string | null {
  if (sortByMode === 'fantasy_points' && player.fantasy_points != null)
    return player.fantasy_points.toFixed(1);
  if ((sortByMode === 'overall_rank' || sortByMode === 'relevance') && player.overall_rank != null)
    return `#${player.overall_rank}`;
  if (sortByMode === 'position_rank' && player.position_rank != null)
    return player.position_rank_label ?? `#${player.position_rank}`;
  if (sortByMode === 'adp' && player.adp != null)
    return player.adp.toFixed(1);
  return null;
}

function rightStatLabel(sortByMode: SortByMode, rankingSource: RankingSource): string {
  if (sortByMode === 'fantasy_points') return 'PTS';
  if (sortByMode === 'adp') return 'ADP';
  if (sortByMode === 'position_rank') return 'POS';
  if (sortByMode === 'relevance') return rankingSource === 'sleeper' ? 'REL' : 'OVR';
  return 'OVR';
}

export default function AvailablePlayerRow({
  player, isPicked, isOnBoard, canPick, sortByMode, rankingSource, onAdd, onPick, onOpenDetail,
}: Props) {
  const injuryLabel  = player.injury_status;
  const injuryColor  = injuryLabel ? (INJURY_COLORS[injuryLabel] ?? '#64748b') : null;
  const primary      = rankLabel(player, sortByMode, rankingSource);
  const secondary    = secondaryLabel(player, sortByMode, rankingSource);
  const rightVal     = rightStatValue(player, sortByMode);
  const rightLbl     = rightStatLabel(sortByMode, rankingSource);
  const showOwnership = (player.percent_owned ?? 0) > 0;
  const showTrend    = player.trend_count != null && player.trend_count !== 0;

  return (
    <div style={{
      display: 'flex', alignItems: 'stretch', gap: '0',
      borderRadius: '7px', border: `1px solid ${dt.border}`,
      background: dt.cardInner, opacity: isPicked ? 0.45 : 1,
      overflow: 'hidden',
    }}>

      {/* Action column — left strip */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: '58px', flexShrink: 0, padding: '0 6px',
        borderRight: `1px solid ${dt.border}`,
        background: isPicked ? 'transparent' : isOnBoard ? '#0a1f10' : 'transparent',
      }}>
        {!isPicked && !isOnBoard && (
          <button
            onClick={e => { e.stopPropagation(); onAdd(player.id); }}
            style={{
              width: '46px', padding: '6px 0', fontSize: '12px', fontWeight: '700',
              background: 'transparent', color: dt.blue,
              border: `1px solid ${dt.blue}`, borderRadius: '5px', cursor: 'pointer',
              letterSpacing: '0.02em',
            }}
          >
            + Add
          </button>
        )}
        {!isPicked && isOnBoard && canPick && (
          <button
            onClick={e => { e.stopPropagation(); onPick(player.id); }}
            style={{
              width: '46px', padding: '6px 0', fontSize: '12px', fontWeight: '700',
              background: '#14532d', color: dt.green,
              border: `1px solid ${dt.greenDark}`, borderRadius: '5px', cursor: 'pointer',
            }}
          >
            Pick
          </button>
        )}
        {!isPicked && isOnBoard && !canPick && (
          <span style={{ fontSize: '10px', color: '#6ee7b7', textAlign: 'center', fontWeight: '600', lineHeight: 1.2 }}>On{'\n'}Board</span>
        )}
        {isPicked && (
          <span style={{ fontSize: '10px', color: dt.textSecondary, textAlign: 'center', lineHeight: 1.2 }}>—</span>
        )}
      </div>

      {/* Main player info — center */}
      <div style={{ flex: 1, minWidth: 0, padding: '8px 10px' }}>
        {/* Row 1: name + status badges */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
          <button
            onClick={e => { e.stopPropagation(); onOpenDetail(player.id); }}
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontWeight: '600', fontSize: '13px', color: isPicked ? dt.textSecondary : dt.textPrimary, lineHeight: 1.3, textAlign: 'left', textDecoration: 'underline', textDecorationColor: 'transparent', transition: 'text-decoration-color 0.12s' }}
            onMouseEnter={e => (e.currentTarget.style.textDecorationColor = '#60a5fa')}
            onMouseLeave={e => (e.currentTarget.style.textDecorationColor = 'transparent')}
          >
            {player.display_name}
          </button>
          {isPicked && (
            <span style={{ fontSize: '10px', fontWeight: '700', padding: '1px 5px', borderRadius: '3px', background: '#1e3a8a', color: '#93c5fd' }}>Drafted</span>
          )}
          {isOnBoard && !isPicked && (
            <span style={{ fontSize: '10px', fontWeight: '700', padding: '1px 5px', borderRadius: '3px', background: '#064e3b', color: '#6ee7b7' }}>On Board</span>
          )}
          {injuryLabel && injuryColor && !isPicked && (
            <span style={{ fontSize: '10px', fontWeight: '600', color: injuryColor }}>{injuryLabel}</span>
          )}
        </div>

        {/* Row 2: team · position · primary rank label */}
        <div style={{ fontSize: '11px', color: dt.textSecondary, marginTop: '2px', display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
          <span>{player.team_abbr ?? '—'} · {player.fantasy_position ?? player.nfl_position ?? '—'}</span>
          {primary && <span style={{ color: '#60a5fa', fontWeight: '500' }}>· {primary}</span>}
          {secondary && !primary && <span style={{ color: '#94a3b8' }}>{secondary}</span>}
        </div>

        {/* Row 3: secondary stat + ownership/trend if available */}
        {(secondary && primary || showOwnership || showTrend) && (
          <div style={{ fontSize: '10px', color: '#64748b', marginTop: '1px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {secondary && primary && <span style={{ color: '#94a3b8' }}>{secondary}</span>}
            {showOwnership && <span>{(player.percent_owned!).toFixed(0)}% Rost</span>}
            {showTrend && (
              <span style={{ color: player.trend_count! > 0 ? '#4ade80' : '#f87171' }}>
                {player.trend_count! > 0 ? '+' : ''}{player.trend_count!.toFixed(1)}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Right stat column — only when ranking data exists */}
      {rightVal && (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          width: '52px', flexShrink: 0, padding: '0 6px',
          borderLeft: `1px solid ${dt.border}`,
        }}>
          <span style={{ fontSize: '13px', fontWeight: '700', color: dt.textPrimary, lineHeight: 1 }}>{rightVal}</span>
          <span style={{ fontSize: '9px', color: dt.textSecondary, marginTop: '2px', fontWeight: '600', letterSpacing: '0.04em' }}>{rightLbl}</span>
        </div>
      )}

      {/* Position badge — far right */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: '38px', flexShrink: 0,
        borderLeft: rightVal ? 'none' : `1px solid ${dt.border}`,
      }}>
        <span style={{
          padding: '2px 5px', borderRadius: '4px', fontSize: '10px', fontWeight: '700',
          background: positionBadgeBg(player.fantasy_position),
          color: positionBadgeColor(player.fantasy_position),
        }}>
          {player.fantasy_position ?? player.nfl_position ?? '—'}
        </span>
      </div>

    </div>
  );
}
