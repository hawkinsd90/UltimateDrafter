import type { PicksState } from '../../hooks/league/useRosterData';

const card          = '#1e293b';
const border        = '#334155';
const textPrimary   = '#f1f5f9';
const textSecondary = '#94a3b8';

interface Props {
  picksState:        PicksState;
  activeDraftStatus: string | null;
}

export default function RosterPicksCard({ picksState, activeDraftStatus }: Props) {
  if (picksState.kind === 'loading' || picksState.kind === 'no_member') return null;

  return (
    <div style={{ marginTop: '16px', background: card, border: `1px solid ${border}`, borderRadius: '10px', overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px', borderBottom: `1px solid ${border}` }}>
        <span style={{ fontSize: '14px', fontWeight: '700', color: textPrimary }}>
          {picksState.kind === 'projected' ? 'Draft Pick Assets' : 'Draft Picks'}
        </span>
        {(picksState.kind === 'projected' || picksState.kind === 'actual') && (
          <div style={{ marginTop: '3px', fontSize: '12px', color: textSecondary }}>
            {picksState.kind === 'projected'
              ? 'Based on current league draft order and league settings. Create a draft to lock these picks in.'
              : activeDraftStatus === 'completed'
                ? `Based on the completed draft's participant order and draft settings.`
                : `Based on this draft's participant order and draft settings.`}
          </div>
        )}
      </div>

      {picksState.kind === 'not_in_league' && (
        <div style={{ padding: '20px 16px', color: textSecondary, fontSize: '13px' }}>This team is not connected to a league member yet.</div>
      )}
      {picksState.kind === 'no_draft_order' && (
        <div style={{ padding: '20px 16px', color: textSecondary, fontSize: '13px' }}>This team does not have a draft order position yet. The commissioner can set draft order from the Members tab.</div>
      )}
      {picksState.kind === 'order_incomplete' && (
        <div style={{ padding: '20px 16px', color: textSecondary, fontSize: '13px' }}>Draft order is incomplete. The commissioner can finish setting draft order from the Members tab.</div>
      )}

      {(picksState.kind === 'projected' || picksState.kind === 'actual') && (() => {
        const years       = Array.from(new Set(picksState.picks.map(p => p.year))).sort((a, b) => a - b);
        const currentYear = years[0];
        const multiYear   = years.length > 1;
        return (
          <div style={{ padding: '12px 16px' }}>
            {years.map((year, yi) => {
              const yearPicks = picksState.picks.filter(p => p.year === year);
              const isCurrent = year === currentYear;
              return (
                <div key={year} style={{ marginBottom: multiYear && yi < years.length - 1 ? '16px' : 0 }}>
                  {multiYear && (
                    <div style={{ fontSize: '11px', fontWeight: '700', color: textSecondary, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px', paddingBottom: '4px', borderBottom: `1px solid ${border}` }}>
                      {year} Picks
                    </div>
                  )}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {yearPicks.map(pick => isCurrent ? (
                      <div key={`${year}-${pick.round}`} style={{ padding: '6px 12px', borderRadius: '7px', background: '#0f172a', border: `1px solid ${picksState.kind === 'projected' ? '#334155' : '#1d4ed8'}`, textAlign: 'center', minWidth: '72px' }}>
                        <div style={{ fontSize: '10px', color: textSecondary, fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Rd {pick.round}</div>
                        <div style={{ fontSize: '16px', fontWeight: '700', color: picksState.kind === 'projected' ? textSecondary : textPrimary }}>#{pick.overall}</div>
                        <div style={{ fontSize: '10px', color: textSecondary }}>Pick {pick.pick}</div>
                      </div>
                    ) : (
                      <div key={`${year}-${pick.round}`} style={{ padding: '6px 12px', borderRadius: '7px', background: '#0f172a', border: '1px solid #1e3a5f', textAlign: 'center', minWidth: '72px' }}>
                        <div style={{ fontSize: '10px', color: '#475569', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{year}</div>
                        <div style={{ fontSize: '16px', fontWeight: '700', color: '#475569' }}>Rd {pick.round}</div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}
    </div>
  );
}
