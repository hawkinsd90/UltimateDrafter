import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

type DraftOption = {
  draft_id: string;
  draft_name: string;
  league_name: string;
  rule_id: string;
};

type CalcResult = {
  success: boolean;
  draft_id?: string;
  draft_name?: string;
  draft_scoring_rule_id?: string;
  season?: number;
  players_considered?: number;
  players_ranked?: number;
  rows_upserted?: number;
  skipped_tiered_keys?: string[];
  skipped_bonus_keys?: string[];
  top_10_overall?: { rank: number; player: string; position: string; points: number }[];
  top_10_by_position?: Record<string, { rank: number; player: string; points: number }[]>;
  error?: string;
};

export default function AdminLastSeasonRankingsPanel() {
  const [drafts, setDrafts] = useState<DraftOption[]>([]);
  const [selectedDraftId, setSelectedDraftId] = useState('');
  const [season, setSeason] = useState('2025');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<CalcResult | null>(null);
  const [error, setError] = useState('');
  const [loadingDrafts, setLoadingDrafts] = useState(true);

  useEffect(() => {
    async function loadDrafts() {
      const { data: rows } = await supabase
        .from('draft_scoring_rules')
        .select('id, draft_id, drafts(name, leagues(name))')
        .limit(50);
      if (rows) {
        const opts: DraftOption[] = (rows as any[]).map((r: any) => ({
          draft_id: r.draft_id,
          draft_name: r.drafts?.name ?? r.draft_id,
          league_name: r.drafts?.leagues?.name ?? '',
          rule_id: r.id,
        }));
        setDrafts(opts);
        if (opts.length > 0) setSelectedDraftId(opts[0].draft_id);
      }
      setLoadingDrafts(false);
    }
    loadDrafts();
  }, []);

  async function handleCalculate() {
    if (!selectedDraftId) { setError('Select a draft first.'); return; }
    setRunning(true);
    setError('');
    setResult(null);

    const { data, error: rpcErr } = await supabase.rpc('calculate_last_season_fantasy_rankings', {
      p_draft_id: selectedDraftId,
      p_season: Number(season),
    });

    if (rpcErr) {
      setError(rpcErr.message);
    } else {
      const r = data as CalcResult;
      setResult(r);
      if (!r.success) setError(r.error ?? 'Calculation failed.');
    }
    setRunning(false);
  }

  const selectedDraft = drafts.find(d => d.draft_id === selectedDraftId);

  return (
    <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '24px' }}>
      <h2 style={{ margin: '0 0 6px 0', fontSize: '16px', fontWeight: '600', color: '#1e293b' }}>
        Calculate Last Season Rankings
      </h2>
      <p style={{ margin: '0 0 18px 0', fontSize: '13px', color: '#64748b' }}>
        Calculates per-player fantasy points using a draft's imported scoring rules and 2025 Sleeper season stats,
        then upserts results into <code style={{ background: '#f1f5f9', padding: '1px 5px', borderRadius: '3px' }}>player_rankings</code> as{' '}
        <code style={{ background: '#f1f5f9', padding: '1px 5px', borderRadius: '3px' }}>last_season_points</code> rows.
        Requires a draft with imported ESPN scoring rules and a completed stats sync.
      </p>

      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ flex: '1 1 260px', minWidth: '200px' }}>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', color: '#475569', marginBottom: '6px' }}>Draft</label>
          {loadingDrafts ? (
            <div style={{ padding: '9px 12px', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '14px', color: '#94a3b8', background: '#f8fafc' }}>
              Loading drafts…
            </div>
          ) : drafts.length === 0 ? (
            <div style={{ padding: '9px 12px', border: '1px solid #fde68a', borderRadius: '6px', fontSize: '13px', color: '#92400e', background: '#fffbeb' }}>
              No drafts with imported scoring rules found.
            </div>
          ) : (
            <select
              value={selectedDraftId}
              onChange={e => setSelectedDraftId(e.target.value)}
              style={{ width: '100%', padding: '9px 12px', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '14px', color: '#1e293b', background: 'white', boxSizing: 'border-box' }}
            >
              {drafts.map(d => (
                <option key={d.draft_id} value={d.draft_id}>
                  {d.draft_name} ({d.league_name})
                </option>
              ))}
            </select>
          )}
        </div>

        <div style={{ flex: '0 0 120px' }}>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', color: '#475569', marginBottom: '6px' }}>Season</label>
          <input
            type="text"
            value={season}
            onChange={e => setSeason(e.target.value)}
            style={{ width: '100%', padding: '9px 12px', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '14px', color: '#1e293b', boxSizing: 'border-box' }}
          />
        </div>

        <button
          onClick={handleCalculate}
          disabled={running || drafts.length === 0}
          style={{
            padding: '10px 24px',
            background: (running || drafts.length === 0) ? '#94a3b8' : '#0f766e',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            fontWeight: '600',
            fontSize: '14px',
            cursor: (running || drafts.length === 0) ? 'not-allowed' : 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {running ? 'Calculating…' : 'Calculate Last Season Rankings'}
        </button>
      </div>

      {selectedDraft && (
        <div style={{ marginTop: '10px', fontSize: '12px', color: '#94a3b8' }}>
          Rule ID: {selectedDraft.rule_id}
        </div>
      )}

      {error && (
        <div style={{ marginTop: '14px', padding: '12px 14px', background: '#fee2e2', border: '1px solid #ef4444', borderRadius: '6px', fontSize: '13px', color: '#dc2626' }}>
          {error}
        </div>
      )}

      {result && result.success && (
        <div style={{ marginTop: '14px' }}>
          <div style={{ padding: '14px 16px', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '6px', fontSize: '13px', color: '#166534', marginBottom: '16px' }}>
            <div style={{ fontWeight: '600', marginBottom: '8px' }}>
              Calculation complete — {result.draft_name} ({result.season})
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '4px 24px' }}>
              <div>Players considered: <strong>{result.players_considered?.toLocaleString()}</strong></div>
              <div>Players ranked: <strong>{result.players_ranked?.toLocaleString()}</strong></div>
              <div>Rows upserted: <strong>{result.rows_upserted?.toLocaleString()}</strong></div>
            </div>
            {(result.skipped_tiered_keys?.length ?? 0) > 0 && (
              <div style={{ marginTop: '8px', color: '#854d0e' }}>
                Skipped tiered keys (no weekly data): {result.skipped_tiered_keys?.join(', ')}
              </div>
            )}
            {(result.skipped_bonus_keys?.length ?? 0) > 0 && (
              <div style={{ marginTop: '4px', color: '#854d0e' }}>
                Skipped bonus keys (require weekly breakdowns): {result.skipped_bonus_keys?.join(', ')}
              </div>
            )}
          </div>

          {result.top_10_overall && result.top_10_overall.length > 0 && (
            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '13px', fontWeight: '600', color: '#1e293b', marginBottom: '8px' }}>Top 10 Overall</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ background: '#f8fafc' }}>
                    <th style={thStyle}>Rank</th>
                    <th style={thStyle}>Player</th>
                    <th style={thStyle}>Pos</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Pts</th>
                  </tr>
                </thead>
                <tbody>
                  {result.top_10_overall.map(row => (
                    <tr key={row.rank} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={tdStyle}>{row.rank}</td>
                      <td style={tdStyle}>{row.player}</td>
                      <td style={tdStyle}>
                        <span style={{ ...posBadge, ...posColor(row.position) }}>{row.position}</span>
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontWeight: '600' }}>{Number(row.points).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {result.top_10_by_position && (
            <div>
              <div style={{ fontSize: '13px', fontWeight: '600', color: '#1e293b', marginBottom: '8px' }}>Top 5 by Position</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '12px' }}>
                {Object.entries(result.top_10_by_position).sort().map(([pos, players]) => (
                  <div key={pos} style={{ border: '1px solid #e2e8f0', borderRadius: '6px', overflow: 'hidden' }}>
                    <div style={{ background: '#f8fafc', padding: '8px 12px', fontWeight: '600', fontSize: '12px', color: '#475569', borderBottom: '1px solid #e2e8f0' }}>
                      <span style={{ ...posBadge, ...posColor(pos), marginRight: '6px' }}>{pos}</span>
                    </div>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                      <tbody>
                        {(players as any[]).map((p: any) => (
                          <tr key={p.rank} style={{ borderBottom: '1px solid #f8fafc' }}>
                            <td style={{ padding: '6px 12px', color: '#94a3b8', width: '28px' }}>{p.rank}</td>
                            <td style={{ padding: '6px 4px', color: '#1e293b' }}>{p.player}</td>
                            <td style={{ padding: '6px 12px', textAlign: 'right', color: '#475569', fontWeight: '600' }}>{Number(p.points).toFixed(1)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: '8px 12px', textAlign: 'left', fontSize: '11px',
  fontWeight: '600', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em',
};
const tdStyle: React.CSSProperties = { padding: '8px 12px', color: '#1e293b' };
const posBadge: React.CSSProperties = {
  display: 'inline-block', padding: '1px 6px', borderRadius: '3px',
  fontSize: '11px', fontWeight: '700', letterSpacing: '0.03em',
};
function posColor(pos: string): React.CSSProperties {
  const map: Record<string, React.CSSProperties> = {
    QB: { background: '#fef3c7', color: '#92400e' },
    RB: { background: '#dcfce7', color: '#166534' },
    WR: { background: '#dbeafe', color: '#1e40af' },
    TE: { background: '#fce7f3', color: '#9d174d' },
    K:  { background: '#f3f4f6', color: '#374151' },
    DST:{ background: '#ede9fe', color: '#4c1d95' },
  };
  return map[pos] ?? { background: '#f1f5f9', color: '#475569' };
}
