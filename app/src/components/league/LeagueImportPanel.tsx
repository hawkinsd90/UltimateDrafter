import { useState } from 'react';
import { supabase } from '../../lib/supabase';

interface ImportResult {
  displayName: string;
  teamsImported: number;
  rosterPlayersImported: number;
  matchedPlayers: number;
  unresolvedPlayers: number;
  scoringType: string;
  warnings: string[];
}

interface Props {
  leagueId: string;
  onImportComplete: () => void;
}

const CURRENT_YEAR = new Date().getFullYear();

export default function LeagueImportPanel({ leagueId, onImportComplete }: Props) {
  const [provider, setProvider]         = useState<'espn' | 'sleeper'>('espn');
  const [externalId, setExternalId]     = useState('');
  const [season, setSeason]             = useState(String(CURRENT_YEAR));
  const [importMode, setImportMode]     = useState<string>('reference_only');
  const [isPrivate, setIsPrivate]       = useState(false);
  const [swid, setSwid]                 = useState('');
  const [espnS2, setEspnS2]             = useState('');
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState('');
  const [result, setResult]             = useState<ImportResult | null>(null);

  async function handleImport() {
    setError('');
    setResult(null);

    const seasonNum = Number(season);
    if (!externalId.trim()) { setError('External league ID is required.'); return; }
    if (!Number.isInteger(seasonNum) || seasonNum < 2000 || seasonNum > 2100) {
      setError('Season must be a valid year (e.g. 2025).');
      return;
    }
    if (provider === 'espn' && isPrivate) {
      if (!swid.trim())   { setError('SWID is required for private ESPN leagues.'); return; }
      if (!espnS2.trim()) { setError('espn_s2 is required for private ESPN leagues.'); return; }
    }

    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setError('You must be signed in to import.'); return; }

      const body: Record<string, unknown> = {
        leagueDbId: leagueId,
        provider,
        leagueId: externalId.trim(),
        season: seasonNum,
        importMode,
      };
      if (provider === 'espn') {
        body.isPrivate = isPrivate;
        if (isPrivate) {
          body.swid    = swid.trim();
          body.espnS2  = espnS2.trim();
        }
      }

      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/import-external-league`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
            'Apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify(body),
        }
      );

      const json = await resp.json();
      if (!resp.ok) {
        setError(json?.error ?? `Import failed (HTTP ${resp.status}).`);
        return;
      }

      setResult({
        displayName:            json.displayName,
        teamsImported:          json.teamsImported,
        rosterPlayersImported:  json.rosterPlayersImported,
        matchedPlayers:         json.matchedPlayers,
        unresolvedPlayers:      json.unresolvedPlayers,
        scoringType:            json.scoringType,
        warnings:               json.warnings ?? [],
      });

      // Clear credentials from state immediately after a successful import
      setSwid('');
      setEspnS2('');

      onImportComplete();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unexpected error during import.');
    } finally {
      setLoading(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '8px 10px', border: '1px solid #d1d5db',
    borderRadius: '6px', fontSize: '14px', boxSizing: 'border-box',
  };
  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: '13px', fontWeight: '500',
    color: '#374151', marginBottom: '4px',
  };
  const fieldStyle: React.CSSProperties = { marginBottom: '16px' };

  return (
    <div style={{ marginTop: '40px', borderTop: '1px solid #e5e7eb', paddingTop: '32px' }}>
      <h3 style={{ margin: '0 0 6px 0', fontSize: '16px', fontWeight: '600', color: '#111827' }}>
        Import External League Roster
      </h3>
      <p style={{ margin: '0 0 24px 0', fontSize: '14px', color: '#6b7280', lineHeight: '1.5' }}>
        Import teams and rosters from ESPN or Sleeper. The League Roster tab will show imported
        players after this completes. You can re-run this import at any time to refresh roster data.
      </p>

      {result ? (
        <div>
          <div style={{
            background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '8px',
            padding: '16px 20px', marginBottom: '20px',
          }}>
            <p style={{ margin: '0 0 8px 0', fontWeight: '600', color: '#166534', fontSize: '15px' }}>
              Import complete — {result.displayName}
            </p>
            <div style={{ fontSize: '13px', color: '#15803d', lineHeight: '1.8' }}>
              <div>{result.teamsImported} teams imported</div>
              <div>{result.rosterPlayersImported} roster players imported</div>
              <div>{result.matchedPlayers} matched to player database · {result.unresolvedPlayers} unresolved</div>
              <div>Scoring: {result.scoringType}</div>
            </div>
            {result.warnings.length > 0 && (
              <div style={{ marginTop: '10px' }}>
                <p style={{ margin: '0 0 4px 0', fontSize: '12px', fontWeight: '600', color: '#92400e' }}>Warnings:</p>
                {result.warnings.map((w, i) => (
                  <p key={i} style={{ margin: '0', fontSize: '12px', color: '#92400e' }}>{w}</p>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={() => setResult(null)}
            style={{
              padding: '8px 16px', fontSize: '13px', background: 'none',
              border: '1px solid #d1d5db', borderRadius: '6px',
              cursor: 'pointer', color: '#374151',
            }}
          >
            Import again
          </button>
        </div>
      ) : (
        <div style={{ maxWidth: '480px' }}>
          {/* Provider */}
          <div style={fieldStyle}>
            <label style={labelStyle}>Provider</label>
            <select
              value={provider}
              onChange={e => { setProvider(e.target.value as 'espn' | 'sleeper'); setIsPrivate(false); }}
              style={inputStyle}
            >
              <option value="espn">ESPN</option>
              <option value="sleeper">Sleeper</option>
            </select>
          </div>

          {/* External League ID */}
          <div style={fieldStyle}>
            <label style={labelStyle}>
              {provider === 'espn' ? 'ESPN League ID' : 'Sleeper League ID'}
            </label>
            <input
              type="text"
              value={externalId}
              onChange={e => setExternalId(e.target.value)}
              placeholder={provider === 'espn' ? 'e.g. 1523679' : 'e.g. 651893269764411392'}
              style={inputStyle}
            />
            {provider === 'espn' && (
              <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#6b7280' }}>
                Found in your ESPN league URL: fantasy.espn.com/football/league?leagueId=<strong>XXXXXXX</strong>
              </p>
            )}
          </div>

          {/* Season */}
          <div style={fieldStyle}>
            <label style={labelStyle}>Season Year</label>
            <input
              type="number"
              value={season}
              onChange={e => setSeason(e.target.value)}
              min={2000}
              max={2100}
              style={{ ...inputStyle, width: '120px' }}
            />
          </div>

          {/* Import mode */}
          <div style={fieldStyle}>
            <label style={labelStyle}>Import Mode</label>
            <select value={importMode} onChange={e => setImportMode(e.target.value)} style={inputStyle}>
              <option value="reference_only">Reference Only — import for roster reference, no keeper logic</option>
              <option value="all_rostered_as_keepers">All Rostered as Keepers — treat current rosters as keepers</option>
              <option value="manual_keeper_select">Manual Keeper Select — import then select keepers manually</option>
            </select>
          </div>

          {/* ESPN private league */}
          {provider === 'espn' && (
            <div style={fieldStyle}>
              <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={isPrivate}
                  onChange={e => setIsPrivate(e.target.checked)}
                />
                Private ESPN league (requires credentials)
              </label>
            </div>
          )}

          {provider === 'espn' && isPrivate && (
            <>
              <div style={{ background: '#fefce8', border: '1px solid #fde047', borderRadius: '6px', padding: '10px 14px', marginBottom: '16px', fontSize: '12px', color: '#854d0e', lineHeight: '1.5' }}>
                Credentials are sent directly to ESPN and are never stored in the database, logs, or any response.
              </div>
              <div style={fieldStyle}>
                <label style={labelStyle}>SWID</label>
                <input
                  type="password"
                  value={swid}
                  onChange={e => setSwid(e.target.value)}
                  placeholder="{xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx}"
                  autoComplete="off"
                  style={inputStyle}
                />
                <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#6b7280' }}>
                  Found in your ESPN browser cookies as "SWID"
                </p>
              </div>
              <div style={fieldStyle}>
                <label style={labelStyle}>espn_s2</label>
                <input
                  type="password"
                  value={espnS2}
                  onChange={e => setEspnS2(e.target.value)}
                  placeholder="Long alphanumeric cookie value"
                  autoComplete="off"
                  style={inputStyle}
                />
                <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#6b7280' }}>
                  Found in your ESPN browser cookies as "espn_s2"
                </p>
              </div>
            </>
          )}

          {error && (
            <div style={{ marginBottom: '16px', padding: '10px 14px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '6px', fontSize: '13px', color: '#dc2626' }}>
              {error}
            </div>
          )}

          <button
            onClick={handleImport}
            disabled={loading}
            style={{
              padding: '10px 24px', fontSize: '14px', fontWeight: '600',
              background: loading ? '#9ca3af' : '#2563eb', color: '#fff',
              border: 'none', borderRadius: '6px', cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? 'Importing...' : 'Import League Roster'}
          </button>
        </div>
      )}
    </div>
  );
}
