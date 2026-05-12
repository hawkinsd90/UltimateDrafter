import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

type ImportRun = {
  id: string;
  provider: string;
  season: string;
  status: string;
  teams_seen: number | null;
  players_seen: number | null;
  players_upserted: number | null;
  fantasy_relevant_count: number | null;
  errors: string[] | null;
  started_at: string;
  completed_at: string | null;
};

type DraftPoolCounts = {
  QB: number;
  RB: number;
  WR: number;
  TE: number;
  K: number;
  DST: number;
};

// Mock provider is only shown in local dev — it inserts hardcoded test players
// that must not appear in a real draft pool.
const PROVIDERS = [
  ...(import.meta.env.DEV ? [{ value: 'mock', label: 'Mock — dev only (no credentials needed)' }] : []),
  { value: 'sleeper',      label: 'Sleeper (free public API)' },
  { value: 'sportsdataio', label: 'SportsDataIO (requires API key)' },
];

const POSITION_ORDER: (keyof DraftPoolCounts)[] = ['QB', 'RB', 'WR', 'TE', 'K', 'DST'];
const currentYear = new Date().getFullYear().toString();

// Draft pool sanity thresholds
const DST_EXPECTED = 32;
const POOL_MAX = 2000;
const POOL_MIN_TOTAL = 200;

export default function AdminNFLRosterImportPanel() {
  const [provider, setProvider] = useState(import.meta.env.DEV ? 'mock' : 'sleeper');
  const [season, setSeason] = useState(currentYear);
  const [importing, setImporting] = useState(false);
  const [lastResult, setLastResult] = useState<Record<string, unknown> | null>(null);
  const [importRuns, setImportRuns] = useState<ImportRun[]>([]);
  const [totalPlayers, setTotalPlayers] = useState<number | null>(null);
  const [fantasyRelevantCount, setFantasyRelevantCount] = useState<number | null>(null);
  const [draftPoolCounts, setDraftPoolCounts] = useState<DraftPoolCounts | null>(null);
  const [loadingStats, setLoadingStats] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadStats();
    loadImportRuns();
  }, []);

  async function loadStats() {
    setLoadingStats(true);
    const [totalRes, fantasyRes, poolRes] = await Promise.all([
      supabase
        .from('sports_players')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'Active'),
      supabase
        .from('sports_players')
        .select('id', { count: 'exact', head: true })
        .eq('is_fantasy_relevant', true),
      supabase
        .from('nfl_draft_player_pool')
        .select('fantasy_position')
        .limit(2000),
    ]);

    setTotalPlayers(totalRes.count ?? 0);
    setFantasyRelevantCount(fantasyRes.count ?? 0);

    if (poolRes.data) {
      const counts: DraftPoolCounts = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DST: 0 };
      for (const row of poolRes.data) {
        const pos = row.fantasy_position as keyof DraftPoolCounts;
        if (pos in counts) counts[pos]++;
      }
      setDraftPoolCounts(counts);
    }

    setLoadingStats(false);
  }

  async function loadImportRuns() {
    const { data } = await supabase
      .from('roster_import_runs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(20);
    setImportRuns(data ?? []);
  }

  async function handleImport() {
    setImporting(true);
    setError('');
    setLastResult(null);

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setError('Not authenticated.');
      setImporting(false);
      return;
    }

    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/import-nfl-rosters`;
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ provider, season }),
      });

      const json = await resp.json();
      setLastResult(json);
      if (!resp.ok || !json.success) {
        setError(json.error ?? JSON.stringify(json.errors));
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }

    setImporting(false);
    await loadStats();
    await loadImportRuns();
  }

  function formatDate(iso: string | null) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString();
  }

  function statusColor(status: string) {
    if (status === 'success') return '#059669';
    if (status === 'failed') return '#dc2626';
    return '#d97706';
  }

  // Compute warnings for the draft pool
  const draftPoolWarnings: string[] = [];
  if (draftPoolCounts) {
    const total = Object.values(draftPoolCounts).reduce((a, b) => a + b, 0);
    if (draftPoolCounts.DST !== DST_EXPECTED) {
      draftPoolWarnings.push(`DST count is ${draftPoolCounts.DST} — expected exactly ${DST_EXPECTED} (one per NFL team).`);
    }
    if (total > POOL_MAX) {
      draftPoolWarnings.push(`Draft pool total (${total}) is unusually high — may include too many fringe players.`);
    }
    if (total > 0 && total < POOL_MIN_TOTAL) {
      draftPoolWarnings.push(`Draft pool total (${total}) is unusually low — import may not have run yet.`);
    }
    for (const pos of POSITION_ORDER) {
      if (draftPoolCounts[pos] === 0) {
        draftPoolWarnings.push(`${pos} count is zero — check import data.`);
      }
    }
  }

  const draftPoolTotal = draftPoolCounts
    ? Object.values(draftPoolCounts).reduce((a, b) => a + b, 0)
    : null;

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif' }}>

      {/* Raw import stats */}
      <div style={{ display: 'flex', gap: '16px', marginBottom: '20px', flexWrap: 'wrap' }}>
        {[
          { label: 'Total Active NFL Players (raw)', value: loadingStats ? '…' : (totalPlayers ?? 0) },
          { label: 'Fantasy-Relevant Flag (raw)',    value: loadingStats ? '…' : (fantasyRelevantCount ?? 0) },
        ].map(s => (
          <div key={s.label} style={{ flex: '1 1 200px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '16px 20px' }}>
            <div style={{ fontSize: '28px', fontWeight: '700', color: '#1e293b' }}>{s.value}</div>
            <div style={{ fontSize: '13px', color: '#64748b', marginTop: '4px' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Draft pool counts */}
      <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '20px', marginBottom: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
          <h2 style={{ margin: 0, fontSize: '16px', fontWeight: '600', color: '#1e293b' }}>
            Draft Pool — <code style={{ fontSize: '13px', background: '#f1f5f9', padding: '2px 6px', borderRadius: '4px' }}>nfl_draft_player_pool</code>
          </h2>
          {draftPoolTotal !== null && (
            <span style={{ fontSize: '13px', color: '#64748b' }}>Total: <strong style={{ color: '#1e293b' }}>{draftPoolTotal}</strong></span>
          )}
        </div>

        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          {POSITION_ORDER.map(pos => {
            const count = draftPoolCounts ? draftPoolCounts[pos] : null;
            const isWarn = draftPoolCounts && count === 0;
            const isDSTWarn = pos === 'DST' && draftPoolCounts && draftPoolCounts.DST !== DST_EXPECTED && draftPoolCounts.DST !== 0;
            return (
              <div
                key={pos}
                style={{
                  flex: '1 1 80px',
                  background: isWarn ? '#fee2e2' : isDSTWarn ? '#fef9c3' : '#f8fafc',
                  border: `1px solid ${isWarn ? '#ef4444' : isDSTWarn ? '#fde047' : '#e2e8f0'}`,
                  borderRadius: '8px',
                  padding: '14px 16px',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: '22px', fontWeight: '700', color: isWarn ? '#dc2626' : '#1e293b' }}>
                  {loadingStats ? '…' : (count ?? 0)}
                </div>
                <div style={{ fontSize: '12px', fontWeight: '600', color: '#64748b', marginTop: '2px' }}>{pos}</div>
              </div>
            );
          })}
        </div>

        {draftPoolWarnings.length > 0 && (
          <div style={{ marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {draftPoolWarnings.map((w, i) => (
              <div key={i} style={{ padding: '8px 12px', background: '#fef9c3', border: '1px solid #fde047', borderRadius: '6px', fontSize: '13px', color: '#713f12' }}>
                Warning: {w}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Import controls */}
      <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '24px', marginBottom: '24px' }}>
        <h2 style={{ margin: '0 0 16px 0', fontSize: '16px', fontWeight: '600', color: '#1e293b' }}>Run NFL Roster Import</h2>

        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 220px' }}>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', color: '#475569', marginBottom: '6px' }}>Provider</label>
            <select
              value={provider}
              onChange={e => setProvider(e.target.value)}
              style={{ width: '100%', padding: '9px 12px', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '14px', color: '#1e293b', background: 'white' }}
            >
              {PROVIDERS.map(p => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>
          <div style={{ flex: '0 0 120px' }}>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', color: '#475569', marginBottom: '6px' }}>Season</label>
            <input
              type="text"
              value={season}
              onChange={e => setSeason(e.target.value)}
              placeholder="e.g. 2026"
              style={{ width: '100%', padding: '9px 12px', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '14px', color: '#1e293b', boxSizing: 'border-box' }}
            />
          </div>
          <button
            onClick={handleImport}
            disabled={importing}
            style={{
              padding: '10px 24px',
              background: importing ? '#94a3b8' : '#2563eb',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              fontWeight: '600',
              fontSize: '14px',
              cursor: importing ? 'not-allowed' : 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {importing ? 'Importing…' : 'Run Import'}
          </button>
        </div>

        {provider === 'sleeper' && (
          <div style={{ marginTop: '12px', padding: '10px 14px', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '6px', fontSize: '13px', color: '#166534' }}>
            Sleeper is the recommended provider — free public API, no credentials required.
          </div>
        )}

        {provider === 'sportsdataio' && (
          <div style={{ marginTop: '12px', padding: '10px 14px', background: '#fef9c3', border: '1px solid #fde047', borderRadius: '6px', fontSize: '13px', color: '#713f12' }}>
            SportsDataIO requires the <code>SPORTSDATAIO_NFL_API_KEY</code> secret to be configured.
          </div>
        )}

        {error && (
          <div style={{ marginTop: '14px', padding: '12px 14px', background: '#fee2e2', border: '1px solid #ef4444', borderRadius: '6px', fontSize: '13px', color: '#dc2626' }}>
            {error}
          </div>
        )}

        {lastResult && !error && (
          <div style={{ marginTop: '14px', padding: '12px 14px', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '6px', fontSize: '13px', color: '#166534' }}>
            Import complete — {lastResult.playersSeen as number} players seen, {lastResult.playersUpserted as number} upserted, {lastResult.fantasyRelevantCount as number} fantasy-relevant.
          </div>
        )}
      </div>

      {/* Import runs table */}
      <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
          <h2 style={{ margin: 0, fontSize: '16px', fontWeight: '600', color: '#1e293b' }}>Recent Import Runs</h2>
        </div>

        {importRuns.length === 0 ? (
          <div style={{ padding: '32px', textAlign: 'center', color: '#94a3b8', fontSize: '14px' }}>
            No imports have been run yet.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ background: '#f8fafc' }}>
                  {['Provider', 'Season', 'Status', 'Teams', 'Players', 'Fantasy', 'Started', 'Completed'].map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: 'left', color: '#64748b', fontWeight: '600', borderBottom: '1px solid #e2e8f0', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {importRuns.map((run, i) => (
                  <tr key={run.id} style={{ background: i % 2 === 0 ? 'white' : '#f8fafc' }}>
                    <td style={{ padding: '10px 14px', color: '#1e293b' }}>{run.provider}</td>
                    <td style={{ padding: '10px 14px', color: '#1e293b' }}>{run.season}</td>
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{
                        display: 'inline-block',
                        padding: '2px 8px',
                        borderRadius: '9999px',
                        background: run.status === 'success' ? '#dcfce7' : run.status === 'failed' ? '#fee2e2' : '#fef9c3',
                        color: statusColor(run.status),
                        fontWeight: '600',
                        fontSize: '12px',
                      }}>
                        {run.status}
                      </span>
                    </td>
                    <td style={{ padding: '10px 14px', color: '#475569' }}>{run.teams_seen ?? '—'}</td>
                    <td style={{ padding: '10px 14px', color: '#475569' }}>{run.players_seen ?? '—'}</td>
                    <td style={{ padding: '10px 14px', color: '#475569' }}>{run.fantasy_relevant_count ?? '—'}</td>
                    <td style={{ padding: '10px 14px', color: '#475569', whiteSpace: 'nowrap' }}>{formatDate(run.started_at)}</td>
                    <td style={{ padding: '10px 14px', color: '#475569', whiteSpace: 'nowrap' }}>{formatDate(run.completed_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
