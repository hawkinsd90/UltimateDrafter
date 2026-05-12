import { useEffect } from 'react';
import type { PlayerDetail, PlayerSeasonStats } from '../../hooks/draft/usePlayerDetail';
import { INJURY_COLORS, dt } from '../../hooks/draft/draftTypes';
import { positionBadgeBg, positionBadgeColor } from './positionBadge';

interface Props {
  detail: PlayerDetail | null;
  loading: boolean;
  isOnBoard: boolean;
  isPicked: boolean;
  canPick: boolean;
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
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: `1px solid ${dt.border}` }}>
      <span style={{ fontSize: '12px', color: dt.textSecondary }}>{label}</span>
      <span style={{ fontSize: '12px', fontWeight: '600', color: value === '—' ? '#475569' : dt.textPrimary }}>{value}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '18px' }}>
      <div style={{ fontSize: '10px', fontWeight: '700', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '8px' }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function RankingCard({ label, ranking }: { label: string; ranking: { overall_rank: number | null; position_rank_label: string | null; position_rank: number | null; fantasy_points: number | null; adp: number | null; percent_owned: number | null; auction_value: number | null } }) {
  const hasAny = ranking.overall_rank != null || ranking.fantasy_points != null || ranking.adp != null;
  if (!hasAny) return null;
  return (
    <div style={{ background: dt.bg, border: `1px solid ${dt.border}`, borderRadius: '7px', padding: '10px 12px', marginBottom: '6px' }}>
      <div style={{ fontSize: '11px', fontWeight: '700', color: dt.textSecondary, marginBottom: '6px' }}>{label}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
        {ranking.overall_rank != null && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '16px', fontWeight: '700', color: dt.textPrimary }}>#{ranking.overall_rank}</div>
            <div style={{ fontSize: '10px', color: dt.textSecondary }}>Overall</div>
          </div>
        )}
        {(ranking.position_rank_label || ranking.position_rank != null) && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '16px', fontWeight: '700', color: '#60a5fa' }}>
              {ranking.position_rank_label ?? `#${ranking.position_rank}`}
            </div>
            <div style={{ fontSize: '10px', color: dt.textSecondary }}>Pos Rank</div>
          </div>
        )}
        {ranking.fantasy_points != null && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '16px', fontWeight: '700', color: dt.green }}>{ranking.fantasy_points.toFixed(1)}</div>
            <div style={{ fontSize: '10px', color: dt.textSecondary }}>Proj Pts</div>
          </div>
        )}
        {ranking.adp != null && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '16px', fontWeight: '700', color: dt.textPrimary }}>{ranking.adp.toFixed(1)}</div>
            <div style={{ fontSize: '10px', color: dt.textSecondary }}>ADP</div>
          </div>
        )}
        {ranking.percent_owned != null && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '16px', fontWeight: '700', color: dt.textPrimary }}>{ranking.percent_owned.toFixed(0)}%</div>
            <div style={{ fontSize: '10px', color: dt.textSecondary }}>Owned</div>
          </div>
        )}
        {ranking.auction_value != null && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '16px', fontWeight: '700', color: dt.amber }}>${ranking.auction_value.toFixed(0)}</div>
            <div style={{ fontSize: '10px', color: dt.textSecondary }}>Auction</div>
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

export default function PlayerDetailModal({
  detail, loading, isOnBoard, isPicked, canPick, onAdd, onRemove, onPick, onClose,
}: Props) {
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
  const espnPpr = detail?.rankings.find(r => r.scoring_format === 'ppr');
  const hasEspn = espnStandard != null || espnPpr != null;

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

      {/* Modal panel */}
      <div style={{
        position: 'fixed',
        top: 0, right: 0, bottom: 0,
        width: 'min(420px, 100vw)',
        background: dt.card,
        borderLeft: `1px solid ${dt.border}`,
        zIndex: 1001,
        display: 'flex', flexDirection: 'column',
        overflowY: 'auto',
      }}>
        {/* Header bar */}
        <div style={{
          padding: '16px 20px',
          borderBottom: `1px solid ${dt.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          position: 'sticky', top: 0, background: dt.card, zIndex: 1,
        }}>
          <span style={{ fontSize: '13px', fontWeight: '700', color: dt.textSecondary, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Player Detail
          </span>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: dt.textSecondary, fontSize: '20px', cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}
          >
            ×
          </button>
        </div>

        {/* Loading state */}
        {loading && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ color: dt.textSecondary, fontSize: '14px' }}>Loading…</span>
          </div>
        )}

        {/* Detail content */}
        {!loading && detail && (
          <div style={{ padding: '20px', flex: 1 }}>

            {/* Player header */}
            <div style={{ marginBottom: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', marginBottom: '8px' }}>
                <span style={{
                  padding: '3px 8px', borderRadius: '5px', fontSize: '11px', fontWeight: '700',
                  background: positionBadgeBg(detail.fantasy_position),
                  color: positionBadgeColor(detail.fantasy_position),
                  flexShrink: 0, marginTop: '2px',
                }}>
                  {detail.fantasy_position ?? detail.nfl_position ?? '—'}
                </span>
                <div>
                  <div style={{ fontSize: '18px', fontWeight: '700', color: dt.textPrimary, lineHeight: 1.2 }}>
                    {detail.display_name}
                  </div>
                  <div style={{ fontSize: '12px', color: dt.textSecondary, marginTop: '3px' }}>
                    {detail.team_name ?? detail.team_abbr ?? 'Unknown Team'}
                  </div>
                </div>
              </div>

              {/* Status badges */}
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '12px' }}>
                {isPicked && (
                  <span style={{ fontSize: '11px', fontWeight: '700', padding: '2px 8px', borderRadius: '4px', background: '#1e3a8a', color: '#93c5fd' }}>
                    Drafted{detail.draftPickRound != null ? ` — Rd ${detail.draftPickRound}, Pick ${detail.draftPickNumber}` : ''}
                    {detail.draftPickTeamName ? ` by ${detail.draftPickTeamName}` : ''}
                  </span>
                )}
                {!isPicked && isOnBoard && (
                  <span style={{ fontSize: '11px', fontWeight: '700', padding: '2px 8px', borderRadius: '4px', background: '#064e3b', color: '#6ee7b7' }}>
                    On Board{detail.boardRank != null ? ` — Rank #${detail.boardRank}` : ''}
                  </span>
                )}
                {injuryLabel && injuryColor && (
                  <span style={{ fontSize: '11px', fontWeight: '600', padding: '2px 8px', borderRadius: '4px', background: '#1c0a0a', color: injuryColor, border: `1px solid ${injuryColor}` }}>
                    {injuryLabel}
                  </span>
                )}
              </div>

              {/* Action buttons */}
              {!isPicked && (
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {canPick && (
                    <button
                      onClick={() => { onPick(detail.id); onClose(); }}
                      style={{ padding: '8px 16px', fontSize: '13px', fontWeight: '700', background: '#14532d', color: dt.green, border: `1px solid ${dt.greenDark}`, borderRadius: '7px', cursor: 'pointer' }}
                    >
                      Pick
                    </button>
                  )}
                  {!isOnBoard && (
                    <button
                      onClick={() => { onAdd(detail.id); onClose(); }}
                      style={{ padding: '8px 16px', fontSize: '13px', fontWeight: '700', background: 'transparent', color: dt.blue, border: `1px solid ${dt.blue}`, borderRadius: '7px', cursor: 'pointer' }}
                    >
                      + Add to My Rankings
                    </button>
                  )}
                  {isOnBoard && detail.boardRankingId && (
                    <button
                      onClick={() => { onRemove(detail.boardRankingId!); onClose(); }}
                      style={{ padding: '8px 16px', fontSize: '13px', fontWeight: '600', background: 'transparent', color: '#ef4444', border: '1px solid #ef4444', borderRadius: '7px', cursor: 'pointer' }}
                    >
                      Remove from Board
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Rankings section */}
            <Section title="2026 Rankings">
              {hasEspn ? (
                <>
                  {espnStandard && <RankingCard label="ESPN Standard" ranking={espnStandard} />}
                  {espnPpr && <RankingCard label="ESPN PPR" ranking={espnPpr} />}
                </>
              ) : (
                <div style={{ fontSize: '12px', color: '#475569', padding: '8px 0' }}>No ESPN rankings available.</div>
              )}
              <div style={{ fontSize: '11px', color: '#475569', padding: '4px 0' }}>
                FantasyPros — not synced yet
              </div>
            </Section>

            {/* Last Season ranking */}
            {detail.lastSeasonRanking && (
              <Section title="Last Season (2025) — League Scoring">
                <RankingCard label="Last Season" ranking={detail.lastSeasonRanking} />
              </Section>
            )}

            {/* 2025 season stats */}
            {detail.stats ? (
              <Section title="2025 Season Stats">
                <StatsSection stats={detail.stats} position={detail.fantasy_position} />
              </Section>
            ) : (
              <Section title="2025 Season Stats">
                <div style={{ fontSize: '12px', color: '#475569', padding: '8px 0' }}>No stats on record.</div>
              </Section>
            )}

          </div>
        )}
      </div>
    </>
  );
}
