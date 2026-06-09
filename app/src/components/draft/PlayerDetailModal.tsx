import { useEffect } from 'react';
import type { PlayerDetail, PlayerSeasonStats } from '../../hooks/draft/usePlayerDetail';
import { INJURY_COLORS, dt } from '../../hooks/draft/draftTypes';
import { positionBadgeBg, positionBadgeColor } from './positionBadge';

// Responsive layout injected once into <head>. The panel is a right-side drawer on
// desktop and full-screen on mobile (≤640px).
const PANEL_STYLE_ID = 'player-detail-panel-styles';
function ensureStyles() {
  if (document.getElementById(PANEL_STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = PANEL_STYLE_ID;
  el.textContent = `
    .player-detail-panel {
      position: fixed;
      top: 0; right: 0; bottom: 0;
      width: min(440px, 100vw);
      background: ${dt.card};
      border-left: 1px solid ${dt.border};
      z-index: 1001;
      display: flex;
      flex-direction: column;
      overflow-y: auto;
    }
    .player-detail-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .player-detail-action-btn {
      flex: 1 1 auto;
    }
    @media (max-width: 640px) {
      .player-detail-panel {
        left: 0;
        right: 0;
        top: 0;
        bottom: 0;
        width: 100vw;
        height: 100dvh;
        border-left: none;
        border-top: 1px solid ${dt.border};
      }
      .player-detail-actions {
        flex-direction: column;
      }
      .player-detail-action-btn {
        width: 100%;
      }
    }
  `;
  document.head.appendChild(el);
}

export interface PlayerDetailModalProps {
  detail: PlayerDetail | null;
  loading: boolean;
  isOnBoard: boolean;
  isPicked: boolean;
  canPick: boolean;
  // Pass false to hide board/pick actions (e.g. when opened from My Team read-only)
  showBoardActions?: boolean;
  // Optional override badge shown in the header (e.g. 'Imported' from My Team)
  sourceBadge?: 'Drafted' | 'Imported' | null;
  // Roster drop — only shown on the league roster tab for active players
  canDrop?: boolean;
  onDrop?: () => void;
  onAdd: (id: string) => void;
  onRemove: (rankingId: string) => void;
  onPick: (id: string) => void;
  onClose: () => void;
}

function fmt(v: number | null | undefined, decimals = 0): string {
  if (v == null) return '—';
  return decimals > 0 ? v.toFixed(decimals) : String(Math.round(v));
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '7px 0', borderBottom: `1px solid ${dt.border}`,
      minHeight: '36px',
    }}>
      <span style={{ fontSize: '13px', color: dt.textSecondary }}>{label}</span>
      <span style={{ fontSize: '13px', fontWeight: '600', color: value === '—' ? '#475569' : dt.textPrimary }}>{value}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '20px' }}>
      <div style={{
        fontSize: '10px', fontWeight: '700', color: '#475569',
        textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px',
      }}>
        {title}
      </div>
      {children}
    </div>
  );
}

type RankingLike = {
  overall_rank: number | null;
  position_rank_label: string | null;
  position_rank: number | null;
  fantasy_points: number | null;
  adp: number | null;
  percent_owned: number | null;
  auction_value: number | null;
};

function RankingCard({ label, ranking, pointsLabel = 'Proj Pts' }: {
  label: string;
  ranking: RankingLike;
  pointsLabel?: string;
}) {
  const hasAny = ranking.overall_rank != null || ranking.fantasy_points != null || ranking.adp != null;
  if (!hasAny) return null;
  return (
    <div style={{
      background: dt.bg, border: `1px solid ${dt.border}`,
      borderRadius: '7px', padding: '10px 12px', marginBottom: '6px',
    }}>
      <div style={{ fontSize: '11px', fontWeight: '700', color: dt.textSecondary, marginBottom: '8px' }}>{label}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px' }}>
        {ranking.overall_rank != null && (
          <div style={{ textAlign: 'center', minWidth: '40px' }}>
            <div style={{ fontSize: '17px', fontWeight: '700', color: dt.textPrimary }}>#{ranking.overall_rank}</div>
            <div style={{ fontSize: '10px', color: dt.textSecondary, marginTop: '2px' }}>Overall</div>
          </div>
        )}
        {(ranking.position_rank_label || ranking.position_rank != null) && (
          <div style={{ textAlign: 'center', minWidth: '40px' }}>
            <div style={{ fontSize: '17px', fontWeight: '700', color: '#60a5fa' }}>
              {ranking.position_rank_label ?? `#${ranking.position_rank}`}
            </div>
            <div style={{ fontSize: '10px', color: dt.textSecondary, marginTop: '2px' }}>Pos Rank</div>
          </div>
        )}
        {ranking.fantasy_points != null && (
          <div style={{ textAlign: 'center', minWidth: '40px' }}>
            <div style={{ fontSize: '17px', fontWeight: '700', color: dt.green }}>{ranking.fantasy_points.toFixed(1)}</div>
            <div style={{ fontSize: '10px', color: dt.textSecondary, marginTop: '2px' }}>{pointsLabel}</div>
          </div>
        )}
        {ranking.adp != null && (
          <div style={{ textAlign: 'center', minWidth: '40px' }}>
            <div style={{ fontSize: '17px', fontWeight: '700', color: dt.textPrimary }}>{ranking.adp.toFixed(1)}</div>
            <div style={{ fontSize: '10px', color: dt.textSecondary, marginTop: '2px' }}>ADP</div>
          </div>
        )}
        {ranking.percent_owned != null && (
          <div style={{ textAlign: 'center', minWidth: '40px' }}>
            <div style={{ fontSize: '17px', fontWeight: '700', color: dt.textPrimary }}>{ranking.percent_owned.toFixed(0)}%</div>
            <div style={{ fontSize: '10px', color: dt.textSecondary, marginTop: '2px' }}>Owned</div>
          </div>
        )}
        {ranking.auction_value != null && (
          <div style={{ textAlign: 'center', minWidth: '40px' }}>
            <div style={{ fontSize: '17px', fontWeight: '700', color: dt.amber }}>${ranking.auction_value.toFixed(0)}</div>
            <div style={{ fontSize: '10px', color: dt.textSecondary, marginTop: '2px' }}>Auction</div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatsSection({ stats, position }: { stats: PlayerSeasonStats; position: string | null }) {
  const pos = position ?? '';

  if (pos === 'QB') {
    return (
      <>
        <StatRow label="Passing Yards" value={fmt(stats.passing_yards)} />
        <StatRow label="Passing TDs" value={fmt(stats.passing_tds)} />
        <StatRow label="Interceptions" value={fmt(stats.passing_ints)} />
        <StatRow label="Rushing Yards" value={fmt(stats.rushing_yards)} />
        <StatRow label="Rushing TDs" value={fmt(stats.rushing_tds)} />
        <StatRow label="Fumbles Lost" value={fmt(stats.fumbles_lost)} />
        <StatRow label="Games" value={fmt(stats.games)} />
      </>
    );
  }

  if (pos === 'K') {
    return (
      <>
        <StatRow label="FG Made (0–39)" value={fmt(stats.fg_made_0_39)} />
        <StatRow label="FG Made (40–49)" value={fmt(stats.fg_made_40_49)} />
        <StatRow label="FG Made (50+)" value={fmt(stats.fg_made_50_plus)} />
        <StatRow label="FG Missed" value={fmt(stats.fg_missed)} />
        <StatRow label="XP Made" value={fmt(stats.xp_made)} />
        <StatRow label="XP Missed" value={fmt(stats.xp_missed)} />
        <StatRow label="Games" value={fmt(stats.games)} />
      </>
    );
  }

  if (pos === 'DST') {
    return (
      <>
        <StatRow label="Sacks" value={fmt(stats.sacks)} />
        <StatRow label="Interceptions" value={fmt(stats.def_interceptions)} />
        <StatRow label="Fumble Recoveries" value={fmt(stats.fumble_recoveries)} />
        <StatRow label="Defensive TDs" value={fmt(stats.def_tds)} />
        <StatRow label="Safeties" value={fmt(stats.safeties)} />
        <StatRow label="Blocked Kicks" value={fmt(stats.blocks)} />
        <StatRow label="Games" value={fmt(stats.games)} />
      </>
    );
  }

  // RB / WR / TE
  return (
    <>
      <StatRow label="Rushing Yards" value={fmt(stats.rushing_yards)} />
      <StatRow label="Rushing TDs" value={fmt(stats.rushing_tds)} />
      <StatRow label="Receptions" value={fmt(stats.receptions)} />
      <StatRow label="Receiving Yards" value={fmt(stats.receiving_yards)} />
      <StatRow label="Receiving TDs" value={fmt(stats.receiving_tds)} />
      <StatRow label="Fumbles Lost" value={fmt(stats.fumbles_lost)} />
      <StatRow label="Games" value={fmt(stats.games)} />
    </>
  );
}

function Initials({ name, position }: { name: string; position: string | null }) {
  const parts = name.trim().split(/\s+/);
  const initials = parts.length >= 2
    ? `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
    : name.slice(0, 2).toUpperCase();
  return (
    <div style={{
      width: '52px', height: '52px', borderRadius: '50%', flexShrink: 0,
      background: positionBadgeBg(position),
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: '17px', fontWeight: '700', color: positionBadgeColor(position),
    }}>
      {initials}
    </div>
  );
}

function Avatar({ url, name, position }: { url: string | null; name: string; position: string | null }) {
  if (!url) return <Initials name={name} position={position} />;
  return (
    <img
      src={url}
      alt=""
      width={52}
      height={52}
      style={{ width: '52px', height: '52px', borderRadius: '50%', objectFit: 'cover', flexShrink: 0, background: dt.bg }}
      onError={e => {
        // Replace broken image with initials fallback
        const parent = (e.target as HTMLImageElement).parentElement;
        if (parent) {
          (e.target as HTMLImageElement).style.display = 'none';
          const initDiv = document.createElement('div');
          const parts = name.trim().split(/\s+/);
          const text = parts.length >= 2
            ? `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
            : name.slice(0, 2).toUpperCase();
          initDiv.textContent = text;
          initDiv.style.cssText = `width:52px;height:52px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:17px;font-weight:700;background:${positionBadgeBg(position)};color:${positionBadgeColor(position)};flex-shrink:0`;
          parent.appendChild(initDiv);
        }
      }}
    />
  );
}

export default function PlayerDetailModal({
  detail, loading, isOnBoard, isPicked, canPick,
  showBoardActions = true,
  sourceBadge,
  canDrop,
  onDrop,
  onAdd, onRemove, onPick, onClose,
}: PlayerDetailModalProps) {
  useEffect(() => { ensureStyles(); }, []);

  // Close on Escape key
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  if (!loading && !detail) return null;

  const injuryLabel = detail?.injury_status;
  const injuryColor = injuryLabel ? (INJURY_COLORS[injuryLabel] ?? '#64748b') : null;

  const espnStandard = detail?.rankings.find(r => r.scoring_format === 'standard');
  const espnPpr     = detail?.rankings.find(r => r.scoring_format === 'ppr');
  const hasEspn     = espnStandard != null || espnPpr != null;

  // Determine effective source badge: caller-provided > drafted pick > on board
  const effectiveBadge: 'Drafted' | 'Imported' | null =
    sourceBadge ?? (isPicked ? 'Drafted' : null);

  // Pick label: "Rd 2, Pick 5 (#17 overall)"
  function pickLabel(d: PlayerDetail): string {
    const parts: string[] = [];
    if (d.draftPickRound != null) parts.push(`Rd ${d.draftPickRound}`);
    if (d.draftPickInRound != null) parts.push(`Pick ${d.draftPickInRound}`);
    if (d.draftPickNumber != null && (d.draftPickRound != null || d.draftPickInRound != null)) {
      parts.push(`(#${d.draftPickNumber} overall)`);
    } else if (d.draftPickNumber != null) {
      parts.push(`Pick #${d.draftPickNumber}`);
    }
    return parts.length > 0 ? ` — ${parts.join(', ')}` : '';
  }

  const btnBase: React.CSSProperties = {
    padding: '10px 18px', fontSize: '13px', fontWeight: '700',
    borderRadius: '7px', cursor: 'pointer', textAlign: 'center',
  };

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
          zIndex: 1000, backdropFilter: 'blur(2px)',
        }}
      />

      {/* Panel — responsive via CSS class */}
      <div className="player-detail-panel">

        {/* Sticky header */}
        <div style={{
          padding: '14px 16px',
          borderBottom: `1px solid ${dt.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          position: 'sticky', top: 0, background: dt.card, zIndex: 1, flexShrink: 0,
        }}>
          <span style={{ fontSize: '12px', fontWeight: '700', color: dt.textSecondary, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
            Player Profile
          </span>
          <button
            onClick={onClose}
            aria-label="Close player profile"
            style={{
              background: 'transparent', border: `1px solid ${dt.border}`,
              color: dt.textSecondary, fontSize: '18px', cursor: 'pointer',
              lineHeight: 1, padding: '4px 10px', borderRadius: '5px',
              minWidth: '36px', minHeight: '36px',
            }}
          >
            ×
          </button>
        </div>

        {/* Loading */}
        {loading && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px' }}>
            <span style={{ color: dt.textSecondary, fontSize: '14px' }}>Loading…</span>
          </div>
        )}

        {/* Content */}
        {!loading && detail && (
          <div style={{ padding: '16px', flex: 1 }}>

            {/* Player header: avatar + name + meta */}
            <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', marginBottom: '14px' }}>
              <Avatar url={detail.headshot_url} name={detail.display_name} position={detail.fantasy_position} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '20px', fontWeight: '700', color: dt.textPrimary, lineHeight: 1.15 }}>
                  {detail.jersey_number ? `#${detail.jersey_number} ` : ''}{detail.display_name}
                </div>
                <div style={{ fontSize: '13px', color: dt.textSecondary, marginTop: '3px' }}>
                  {detail.team_name ?? detail.team_abbr ?? 'Unknown Team'}
                  {' · '}
                  <span style={{ padding: '1px 5px', borderRadius: '3px', fontSize: '11px', fontWeight: '700', background: positionBadgeBg(detail.fantasy_position), color: positionBadgeColor(detail.fantasy_position) }}>
                    {detail.fantasy_position ?? detail.nfl_position ?? '—'}
                  </span>
                </div>
              </div>
            </div>

            {/* Status badges row */}
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '14px' }}>
              {effectiveBadge === 'Drafted' && (
                <span style={{ fontSize: '11px', fontWeight: '700', padding: '3px 8px', borderRadius: '4px', background: '#1e3a8a', color: '#93c5fd' }}>
                  Drafted{pickLabel(detail)}
                  {detail.draftPickTeamName ? ` by ${detail.draftPickTeamName}` : ''}
                </span>
              )}
              {effectiveBadge === 'Imported' && (
                <span style={{ fontSize: '11px', fontWeight: '700', padding: '3px 8px', borderRadius: '4px', background: '#1c3340', color: '#67e8f9' }}>
                  Imported
                </span>
              )}
              {!effectiveBadge && isOnBoard && (
                <span style={{ fontSize: '11px', fontWeight: '700', padding: '3px 8px', borderRadius: '4px', background: '#064e3b', color: '#6ee7b7' }}>
                  On Board{detail.boardRank != null ? ` — Rank #${detail.boardRank}` : ''}
                </span>
              )}
              {injuryLabel && injuryColor && (
                <span style={{ fontSize: '11px', fontWeight: '600', padding: '3px 8px', borderRadius: '4px', background: '#1c0a0a', color: injuryColor, border: `1px solid ${injuryColor}` }}>
                  {injuryLabel}
                </span>
              )}
            </div>

            {/* Action buttons — only shown when showBoardActions=true and not drafted */}
            {showBoardActions && !isPicked && !sourceBadge && (
              <div className="player-detail-actions" style={{ marginBottom: '20px' }}>
                {canPick && (
                  <button
                    className="player-detail-action-btn"
                    onClick={() => { onPick(detail.id); onClose(); }}
                    style={{ ...btnBase, background: '#14532d', color: dt.green, border: `1px solid ${dt.greenDark}` }}
                  >
                    Pick
                  </button>
                )}
                {!isOnBoard && (
                  <button
                    className="player-detail-action-btn"
                    onClick={() => { onAdd(detail.id); onClose(); }}
                    style={{ ...btnBase, background: 'transparent', color: dt.blue, border: `1px solid ${dt.blue}` }}
                  >
                    + Add to My Rankings
                  </button>
                )}
                {isOnBoard && detail.boardRankingId && (
                  <button
                    className="player-detail-action-btn"
                    onClick={() => { onRemove(detail.boardRankingId!); onClose(); }}
                    style={{ ...btnBase, background: 'transparent', color: '#ef4444', border: '1px solid #ef4444' }}
                  >
                    Remove from Board
                  </button>
                )}
              </div>
            )}

            {/* Drop button — shown independently of board actions, only when canDrop */}
            {canDrop && onDrop && (
              <div style={{ marginBottom: '20px' }}>
                <button
                  className="player-detail-action-btn"
                  onClick={onDrop}
                  style={{
                    ...btnBase,
                    width: '100%',
                    background: 'rgba(239,68,68,0.08)',
                    color: '#ef4444',
                    border: '1px solid #ef4444',
                  }}
                >
                  Drop Player
                </button>
              </div>
            )}

            {/* Bio section */}
            {(detail.years_exp != null || detail.college || detail.height_inches != null || detail.weight_lbs != null || detail.age != null) && (
              <Section title="Bio">
                {detail.age != null && <StatRow label="Age" value={String(detail.age)} />}
                {detail.height_inches != null && (
                  <StatRow
                    label="Height"
                    value={`${Math.floor(detail.height_inches / 12)}'${detail.height_inches % 12}"`}
                  />
                )}
                {detail.weight_lbs != null && <StatRow label="Weight" value={`${detail.weight_lbs} lbs`} />}
                {detail.years_exp != null && (
                  <StatRow
                    label="Experience"
                    value={detail.years_exp === 0 ? 'Rookie' : `${detail.years_exp} yr${detail.years_exp !== 1 ? 's' : ''}`}
                  />
                )}
                {detail.college && <StatRow label="College" value={detail.college} />}
                {detail.depth_chart_position && detail.depth_chart_order != null && (
                  <StatRow
                    label="Depth Chart"
                    value={`${detail.depth_chart_position} #${detail.depth_chart_order}`}
                  />
                )}
              </Section>
            )}

            {/* 2026 Rankings */}
            <Section title="2026 Rankings">
              {hasEspn ? (
                <>
                  {espnStandard && <RankingCard label="ESPN Standard" ranking={espnStandard} pointsLabel="Proj Pts" />}
                  {espnPpr      && <RankingCard label="ESPN PPR"      ranking={espnPpr}      pointsLabel="Proj Pts" />}
                </>
              ) : (
                <div style={{ fontSize: '12px', color: '#475569', padding: '4px 0 8px' }}>No ESPN rankings available.</div>
              )}

              {detail.sleeperRanking ? (
                <RankingCard label="Sleeper Relevance" ranking={detail.sleeperRanking} pointsLabel="Proj Pts" />
              ) : (
                <div style={{ fontSize: '11px', color: '#475569', padding: '2px 0 4px' }}>Sleeper — no rank data</div>
              )}

              <div style={{ fontSize: '11px', color: '#475569', padding: '2px 0' }}>
                FantasyPros rankings are not synced yet. Use ESPN, Sleeper, or Last Season for now.
              </div>
            </Section>

            {/* Last Season ranking */}
            {detail.lastSeasonRanking && (
              <Section title="Last Season (2025) — League Scoring">
                <RankingCard label="Last Season" ranking={detail.lastSeasonRanking} pointsLabel="2025 Pts" />
              </Section>
            )}

            {/* 2025 season stats */}
            <Section title="2025 Season Stats">
              {detail.stats ? (
                <StatsSection stats={detail.stats} position={detail.fantasy_position} />
              ) : (
                <div style={{ fontSize: '12px', color: '#475569', padding: '8px 0' }}>No stats on record.</div>
              )}
            </Section>

          </div>
        )}
      </div>
    </>
  );
}
