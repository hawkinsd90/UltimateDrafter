import type { PicksState, DraftPickAsset } from '../../hooks/league/useRosterData';

const card          = '#1e293b';
const border        = '#334155';
const textPrimary   = '#f1f5f9';
const textSecondary = '#94a3b8';

interface Props {
  picksState:        PicksState;
  activeDraftStatus: string | null;
}

function PickAssetRow({ asset }: { asset: DraftPickAsset }) {
  const isUsed = asset.status === 'used';
  const wasTraded = asset.originalTeamName !== asset.currentTeamName;

  return (
    <div style={{
      padding: '6px 12px',
      borderRadius: '7px',
      background: '#0f172a',
      border: `1px solid ${isUsed ? '#475569' : '#6366f1'}`,
      textAlign: 'center',
      minWidth: '110px',
      opacity: isUsed ? 0.5 : 1,
    }}>
      <div style={{ fontSize: '10px', color: textSecondary, fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {asset.seasonYear}
      </div>
      <div style={{ fontSize: '16px', fontWeight: '700', color: isUsed ? '#475569' : textPrimary }}>
        Rd {asset.roundNumber}
      </div>
      <div style={{ fontSize: '9px', color: textSecondary, marginTop: '2px' }}>
        {isUsed ? 'Used' : 'Tradeable'}
      </div>
      <div style={{ fontSize: '9px', color: wasTraded ? '#6366f1' : textSecondary, marginTop: '1px' }}>
        originally {asset.originalTeamName ?? 'original'}
      </div>
    </div>
  );
}

export default function RosterPicksCard({ picksState, activeDraftStatus }: Props) {
  if (picksState.kind === 'loading' || picksState.kind === 'no_member') return null;

  const pickAssets = (picksState.kind === 'projected' || picksState.kind === 'actual') ? picksState.pickAssets : [];

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
        return (
          <div style={{ padding: '12px 16px' }}>
            {/* Current-season picks — calculated from draft order */}
            {years.map(year => {
              const yearPicks = picksState.picks.filter(p => p.year === year);
              return (
                <div key={year} style={{ marginBottom: '16px' }}>
                  <div style={{ fontSize: '11px', fontWeight: '700', color: textSecondary, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px', paddingBottom: '4px', borderBottom: `1px solid ${border}` }}>
                    {year} Picks
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {yearPicks.map(pick => (
                      <div key={`${year}-${pick.round}`} style={{ padding: '6px 12px', borderRadius: '7px', background: '#0f172a', border: `1px solid ${picksState.kind === 'projected' ? '#334155' : '#1d4ed8'}`, textAlign: 'center', minWidth: '72px' }}>
                        <div style={{ fontSize: '10px', color: textSecondary, fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Rd {pick.round}</div>
                        <div style={{ fontSize: '16px', fontWeight: '700', color: picksState.kind === 'projected' ? textSecondary : textPrimary }}>#{pick.overall}</div>
                        <div style={{ fontSize: '10px', color: textSecondary }}>Pick {pick.pick}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize: '10px', color: textSecondary, marginTop: '6px', fontStyle: 'italic' }}>
                    Current-season picks cannot be traded yet.
                  </div>
                </div>
              );
            })}

            {/* Future pick assets — database-backed ownership */}
            {pickAssets.length > 0 && (
              <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: `1px solid ${border}` }}>
                <div style={{ fontSize: '11px', fontWeight: '700', color: textSecondary, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>
                  Owned Future Pick Assets
                </div>
                {Array.from(new Set(pickAssets.map(a => a.seasonYear))).sort().map(seasonYear => {
                  const seasonAssets = pickAssets.filter(a => a.seasonYear === seasonYear);
                  return (
                    <div key={seasonYear} style={{ marginBottom: '10px' }}>
                      <div style={{ fontSize: '10px', fontWeight: '700', color: textSecondary, marginBottom: '6px' }}>{seasonYear} Picks</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {seasonAssets.map(asset => (
                          <PickAssetRow
                            key={asset.id}
                            asset={asset}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
