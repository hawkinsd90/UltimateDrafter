import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

type SyncResult = {
  success: boolean;
  season?: number;
  league_id?: string;
  endpoint?: string;
  records_fetched?: number;
  records_matched?: number;
  records_upserted?: number;
  unresolved_count?: number;
  unresolved_sample?: { espnId: string; name: string; position: string }[];
  counts_by_scoring_format?: Record<string, number>;
  fields_detected?: string[];
  ranking_type?: string;
  upsert_errors?: string[] | null;
  error?: string;
  espn_status?: number;
};

export default function AdminEspnRankingsPanel() {
  const [season, setSeason] = useState('2026');
  const [leagueId, setLeagueId] = useState('');
  const [swid, setSwid] = useState('');
  const [espnS2, setEspnS2] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [error, setError] = useState('');
  const [defaultLeagueId, setDefaultLeagueId] = useState('');

  useEffect(() => {
    async function loadDefaultLeague() {
      const { data } = await supabase
        .from('external_league_links')
        .select('external_league_id, display_name, external_season')
        .eq('provider', 'espn')
        .limit(1)
        .maybeSingle();
      if (data) {
        setDefaultLeagueId(data.external_league_id);
      }
    }
    loadDefaultLeague();
  }, []);

  async function handleSync() {
    setRunning(true);
    setError('');
    setResult(null);

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setError('Not authenticated.');
      setRunning(false);
      return;
    }

    const body: Record<string, unknown> = { season: Number(season) };
    if (leagueId.trim()) body.leagueId = leagueId.trim();
    if (swid.trim()) body.swid = swid.trim();
    if (espnS2.trim()) body.espnS2 = espnS2.trim();

    try {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sync-espn-rankings`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      const data: SyncResult = await resp.json();
      setResult(data);
      if (!data.success) setError(data.error ?? 'Sync failed.');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Network error.');
    }

    setRunning(false);
  }

  const resolvedLeagueId = leagueId.trim() || defaultLeagueId;

  return (
    <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '24px' }}>
      <h2 style={{ margin: '0 0 6px 0', fontSize: '16px', fontWeight: '600', color: '#1e293b' }}>
        Sync ESPN Rankings
      </h2>
      <p style={{ margin: '0 0 18px 0', fontSize: '13px', color: '#64748b' }}>
        Fetches ESPN draft rankings and projections via the{' '}
        <code style={{ background: '#f1f5f9', padding: '1px 5px', borderRadius: '3px' }}>kona_player_info</code>{' '}
        API using an imported ESPN league ID. Upserts{' '}
        <code style={{ background: '#f1f5f9', padding: '1px 5px', borderRadius: '3px' }}>player_rankings</code>{' '}
        rows for <strong>standard</strong> and <strong>PPR</strong> scoring formats.
        If the league is private, supply SWID and espn_s2 cookies from your browser.
      </p>

      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ flex: '0 0 100px' }}>
          <label style={labelStyle}>Season</label>
          <input
            type="text"
            value={season}
            onChange={e => setSeason(e.target.value)}
            style={inputStyle}
          />
        </div>

        <div style={{ flex: '1 1 180px' }}>
          <label style={labelStyle}>
            League ID
            {defaultLeagueId && !leagueId.trim() && (
              <span style={{ color: '#94a3b8', fontWeight: '400', marginLeft: '6px' }}>
                (default: {defaultLeagueId})
              </span>
            )}
          </label>
          <input
            type="text"
            value={leagueId}
            onChange={e => setLeagueId(e.target.value)}
            placeholder={defaultLeagueId || 'ESPN league ID'}
            style={inputStyle}
          />
        </div>

        <div style={{ flex: '1 1 180px' }}>
          <label style={labelStyle}>
            SWID <span style={{ color: '#94a3b8', fontWeight: '400' }}>(private leagues only)</span>
          </label>
          <input
            type="text"
            value={swid}
            onChange={e => setSwid(e.target.value)}
            placeholder="{xxxxxxxx-xxxx-...}"
            style={inputStyle}
            autoComplete="off"
          />
        </div>

        <div style={{ flex: '1 1 180px' }}>
          <label style={labelStyle}>
            espn_s2 <span style={{ color: '#94a3b8', fontWeight: '400' }}>(private leagues only)</span>
          </label>
          <input
            type="password"
            value={espnS2}
            onChange={e => setEspnS2(e.target.value)}
            placeholder="espn_s2 cookie value"
            style={inputStyle}
            autoComplete="off"
          />
        </div>

        <button
          onClick={handleSync}
          disabled={running || !resolvedLeagueId}
          style={{
            padding: '10px 24px',
            background: (running || !resolvedLeagueId) ? '#94a3b8' : '#0369a1',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            fontWeight: '600',
            fontSize: '14px',
            cursor: (running || !resolvedLeagueId) ? 'not-allowed' : 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {running ? 'Syncing…' : 'Sync ESPN Rankings'}
        </button>
      </div>

      {!resolvedLeagueId && (
        <div style={{ marginTop: '10px', fontSize: '12px', color: '#f59e0b' }}>
          No ESPN league found. Import an ESPN league first or enter a league ID above.
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
              Sync complete — Season {result.season} · League {result.league_id}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '4px 24px' }}>
              <div>Fetched from ESPN: <strong>{result.records_fetched?.toLocaleString()}</strong></div>
              <div>Matched to players: <strong>{result.records_matched?.toLocaleString()}</strong></div>
              <div>Rows inserted: <strong>{result.records_upserted?.toLocaleString()}</strong></div>
              <div>Unresolved: <strong>{result.unresolved_count?.toLocaleString()}</strong></div>
            </div>
            {result.counts_by_scoring_format && (
              <div style={{ marginTop: '8px', display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                {Object.entries(result.counts_by_scoring_format).map(([fmt, count]) => (
                  <span key={fmt} style={{ background: '#dcfce7', padding: '2px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: '600' }}>
                    {fmt}: {count}
                  </span>
                ))}
              </div>
            )}
            {result.fields_detected && (
              <div style={{ marginTop: '8px', fontSize: '12px', color: '#166534' }}>
                Fields: {result.fields_detected.join(', ')}
              </div>
            )}
          </div>

          {result.unresolved_sample && result.unresolved_sample.length > 0 && (
            <div style={{ marginBottom: '12px' }}>
              <div style={{ fontSize: '13px', fontWeight: '600', color: '#92400e', marginBottom: '6px' }}>
                Unresolved players (no mapping found) — sample of {result.unresolved_sample.length}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {result.unresolved_sample.map(p => (
                  <span key={p.espnId} style={{ background: '#fef3c7', border: '1px solid #fde68a', padding: '2px 8px', borderRadius: '4px', fontSize: '12px', color: '#92400e' }}>
                    {p.name} ({p.position}) #{p.espnId}
                  </span>
                ))}
              </div>
            </div>
          )}

          {result.upsert_errors && result.upsert_errors.length > 0 && (
            <div style={{ padding: '10px 14px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '6px', fontSize: '12px', color: '#dc2626' }}>
              <div style={{ fontWeight: '600', marginBottom: '4px' }}>Insert errors:</div>
              {result.upsert_errors.map((e, i) => <div key={i}>{e}</div>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '13px', fontWeight: '500', color: '#475569', marginBottom: '6px',
};
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px 12px', border: '1px solid #cbd5e1',
  borderRadius: '6px', fontSize: '14px', color: '#1e293b', boxSizing: 'border-box',
};
