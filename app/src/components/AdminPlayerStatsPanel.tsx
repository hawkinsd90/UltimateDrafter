import { useState } from 'react';
import { supabase } from '../lib/supabase';

type SyncResult = {
  success: boolean;
  season: number;
  provider: string;
  stat_type: string;
  records_fetched: number;
  players_with_stats: number;
  records_matched: number;
  records_upserted: number;
  unmatched_player_ids_count: number;
  unmatched_player_ids_sample: string[];
  unknown_stat_keys: string[];
  upsert_errors: string[] | null;
  started_at: string;
  completed_at: string;
  error?: string;
};

const currentYear = new Date().getFullYear();

export default function AdminPlayerStatsPanel() {
  const [season, setSeason] = useState(String(currentYear - 1));
  const [syncing, setSyncing] = useState(false);
  const [lastResult, setLastResult] = useState<SyncResult | null>(null);
  const [error, setError] = useState('');

  async function handleSync() {
    setSyncing(true);
    setError('');
    setLastResult(null);

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setError('Not authenticated.');
      setSyncing(false);
      return;
    }

    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sync-player-season-stats`;
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ season: Number(season), provider: 'sleeper', stat_type: 'regular_season' }),
      });

      const json: SyncResult = await resp.json();
      setLastResult(json);
      if (!resp.ok || !json.success) {
        setError(json.error ?? (json.upsert_errors ? json.upsert_errors.join('; ') : 'Sync failed.'));
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }

    setSyncing(false);
  }

  function formatDate(iso: string | null | undefined) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString();
  }

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '24px', marginBottom: '24px' }}>
        <h2 style={{ margin: '0 0 6px 0', fontSize: '16px', fontWeight: '600', color: '#1e293b' }}>Sync Player Season Stats</h2>
        <p style={{ margin: '0 0 18px 0', fontSize: '13px', color: '#64748b' }}>
          Pulls all 18 regular-season weeks from the Sleeper stats API and aggregates season totals
          per player into <code style={{ background: '#f1f5f9', padding: '1px 5px', borderRadius: '3px' }}>player_season_stats</code>.
          Required for Last Season fantasy point calculation. Provider: Sleeper (free, no key needed).
        </p>

        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '0 0 120px' }}>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', color: '#475569', marginBottom: '6px' }}>Season</label>
            <input
              type="text"
              value={season}
              onChange={e => setSeason(e.target.value)}
              placeholder="e.g. 2025"
              style={{ width: '100%', padding: '9px 12px', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '14px', color: '#1e293b', boxSizing: 'border-box' }}
            />
          </div>
          <div style={{ flex: '0 0 160px' }}>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', color: '#475569', marginBottom: '6px' }}>Provider</label>
            <input
              type="text"
              value="Sleeper"
              disabled
              style={{ width: '100%', padding: '9px 12px', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '14px', color: '#94a3b8', background: '#f8fafc', boxSizing: 'border-box' }}
            />
          </div>
          <button
            onClick={handleSync}
            disabled={syncing}
            style={{
              padding: '10px 24px',
              background: syncing ? '#94a3b8' : '#0f766e',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              fontWeight: '600',
              fontSize: '14px',
              cursor: syncing ? 'not-allowed' : 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {syncing ? 'Syncing… (fetches 18 weeks, may take ~30s)' : 'Sync Player Season Stats'}
          </button>
        </div>

        {error && (
          <div style={{ marginTop: '14px', padding: '12px 14px', background: '#fee2e2', border: '1px solid #ef4444', borderRadius: '6px', fontSize: '13px', color: '#dc2626' }}>
            {error}
          </div>
        )}

        {lastResult && !error && (
          <div style={{ marginTop: '14px', padding: '14px 16px', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '6px', fontSize: '13px', color: '#166534' }}>
            <div style={{ fontWeight: '600', marginBottom: '6px' }}>Sync complete for {lastResult.season} {lastResult.stat_type}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '4px 24px' }}>
              <div>Weekly stat entries fetched: <strong>{lastResult.records_fetched.toLocaleString()}</strong></div>
              <div>Players with any stats: <strong>{lastResult.players_with_stats.toLocaleString()}</strong></div>
              <div>Matched to DB players: <strong>{lastResult.records_matched.toLocaleString()}</strong></div>
              <div>Rows upserted: <strong>{lastResult.records_upserted.toLocaleString()}</strong></div>
              <div>Unmatched player IDs: <strong>{lastResult.unmatched_player_ids_count.toLocaleString()}</strong></div>
              <div>Started: <strong>{formatDate(lastResult.started_at)}</strong></div>
              <div>Completed: <strong>{formatDate(lastResult.completed_at)}</strong></div>
            </div>
            {lastResult.unmatched_player_ids_sample.length > 0 && (
              <div style={{ marginTop: '8px', color: '#854d0e' }}>
                Unmatched sample: {lastResult.unmatched_player_ids_sample.slice(0, 10).join(', ')}{lastResult.unmatched_player_ids_sample.length > 10 ? '…' : ''}
              </div>
            )}
            {lastResult.unknown_stat_keys.length > 0 && (
              <div style={{ marginTop: '8px', color: '#854d0e' }}>
                Unknown stat keys: {lastResult.unknown_stat_keys.join(', ')}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
