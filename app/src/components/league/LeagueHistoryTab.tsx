import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

// ── Types ────────────────────────────────────────────────────────────────────

interface HistorySeason {
  id: string;
  season_year: number;
  display_name: string;
  num_teams: number;
  scoring_type: string;
  import_status: string;
  import_completeness: {
    standings: boolean;
    matchups: boolean;
    draft: boolean;
  } | null;
  imported_at: string | null;
}

interface SeasonTeam {
  id: string;
  external_team_id: string;
  team_name: string;
  team_abbrev: string | null;
  wins: number;
  losses: number;
  ties: number;
  points_for: number;
  points_against: number;
  playoff_seed: number | null;
  final_standing: number | null;
  is_champion: boolean;
  is_runner_up: boolean;
}

interface ExternalLink {
  id: string;
  provider: string;
  external_league_id: string;
  external_season: number;
  display_name: string | null;
}

interface HistoryTabProps {
  leagueId: string;
  isOwner: boolean;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function LeagueHistoryTab({ leagueId, isOwner }: HistoryTabProps) {
  const [seasons, setSeasons] = useState<HistorySeason[]>([]);
  const [selectedSeasonId, setSelectedSeasonId] = useState<string | null>(null);
  const [seasonTeams, setSeasonTeams] = useState<SeasonTeam[]>([]);
  const [externalLinks, setExternalLinks] = useState<ExternalLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingTeams, setLoadingTeams] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [error, setError] = useState('');

  const loadHistory = useCallback(async () => {
    try {
      const [seasonsRes, linksRes] = await Promise.all([
        supabase
          .from('league_history_seasons')
          .select('id, season_year, display_name, num_teams, scoring_type, import_status, import_completeness, imported_at')
          .eq('league_id', leagueId)
          .order('season_year', { ascending: false }),
        supabase
          .from('external_league_links')
          .select('id, provider, external_league_id, external_season, display_name')
          .eq('league_id', leagueId)
          .is('draft_id', null)
          .order('provider'),
      ]);

      if (seasonsRes.error) throw seasonsRes.error;
      if (linksRes.error) throw linksRes.error;

      setSeasons((seasonsRes.data ?? []) as HistorySeason[]);
      setExternalLinks((linksRes.data ?? []) as ExternalLink[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load history');
    } finally {
      setLoading(false);
    }
  }, [leagueId]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const loadSeasonTeams = useCallback(async (seasonId: string) => {
    setLoadingTeams(true);
    try {
      const { data, error: err } = await supabase
        .from('league_history_season_teams')
        .select('id, external_team_id, team_name, team_abbrev, wins, losses, ties, points_for, points_against, playoff_seed, final_standing, is_champion, is_runner_up')
        .eq('season_id', seasonId)
        .order('final_standing', { ascending: true, nullsFirst: false });

      if (err) throw err;
      setSeasonTeams((data ?? []) as SeasonTeam[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load standings');
    } finally {
      setLoadingTeams(false);
    }
  }, []);

  const handleSeasonSelect = (seasonId: string) => {
    setSelectedSeasonId(seasonId);
    loadSeasonTeams(seasonId);
  };

  const handleImportComplete = () => {
    setShowImportModal(false);
    loadHistory();
  };

  const hasEspnLink = externalLinks.some((l) => l.provider === 'espn');
  const espnLink = externalLinks.find((l) => l.provider === 'espn');

  // ── Loading ──────────────────────────────────────────────────────────────
  if (loading) {
    return <div style={{ padding: '20px', color: '#6b7280' }}>Loading history...</div>;
  }

  // ── Error ────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div style={{ padding: '20px' }}>
        <div style={{ padding: '12px 16px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '8px', color: '#991b1b', fontSize: '14px' }}>
          {error}
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Header with Import button */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: '0 0 4px 0', fontSize: '20px', fontWeight: '600' }}>League History</h2>
          <p style={{ margin: 0, color: '#6b7280', fontSize: '14px' }}>
            {seasons.length > 0
              ? `${seasons.length} season${seasons.length !== 1 ? 's' : ''} imported`
              : 'No history imported yet'}
          </p>
        </div>
        {isOwner && hasEspnLink && (
          <button
            onClick={() => setShowImportModal(true)}
            style={{
              padding: '10px 20px', fontSize: '14px', fontWeight: '500',
              background: '#2563eb', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer',
            }}
          >
            Import History
          </button>
        )}
      </div>

      {/* No ESPN link and no history */}
      {!hasEspnLink && seasons.length === 0 && (
        <div style={{ padding: '40px', textAlign: 'center', background: '#f9fafb', borderRadius: '12px' }}>
          <p style={{ color: '#6b7280', fontSize: '15px', margin: 0 }}>
            Connect an ESPN league in Settings to import historical seasons.
          </p>
        </div>
      )}

      {/* ESPN link but no history imported */}
      {hasEspnLink && seasons.length === 0 && (
        <div style={{ padding: '40px', textAlign: 'center', background: '#f9fafb', borderRadius: '12px' }}>
          <p style={{ color: '#6b7280', fontSize: '15px', margin: '0 0 16px 0' }}>
            No historical seasons imported yet.
          </p>
          {isOwner && (
            <button
              onClick={() => setShowImportModal(true)}
              style={{
                padding: '10px 24px', fontSize: '14px', fontWeight: '500',
                background: '#2563eb', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer',
              }}
            >
              Import First Season
            </button>
          )}
        </div>
      )}

      {/* Season list */}
      {seasons.length > 0 && (
        <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
          {/* Season selector */}
          <div style={{ flex: '0 0 200px' }}>
            <h3 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: '600', color: '#374151' }}>Seasons</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {seasons.map((s) => (
                <button
                  key={s.id}
                  onClick={() => handleSeasonSelect(s.id)}
                  style={{
                    padding: '10px 14px', fontSize: '14px', cursor: 'pointer',
                    background: selectedSeasonId === s.id ? '#eff6ff' : 'transparent',
                    border: selectedSeasonId === s.id ? '1px solid #93c5fd' : '1px solid #e5e7eb',
                    borderRadius: '8px', textAlign: 'left',
                    fontWeight: selectedSeasonId === s.id ? '600' : '400',
                    color: selectedSeasonId === s.id ? '#1e40af' : '#374151',
                  }}
                >
                  <div>{s.season_year}</div>
                  <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '2px' }}>
                    {s.import_completeness?.matchups ? 'Matchups' : 'Standings only'}
                    {s.import_completeness?.draft ? ' + Draft' : ''}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Standings table */}
          <div style={{ flex: '1', minWidth: '300px' }}>
            {selectedSeasonId ? (
              <>
                <h3 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: '600', color: '#374151' }}>
                  Standings
                </h3>
                {loadingTeams ? (
                  <div style={{ padding: '20px', color: '#6b7280' }}>Loading standings...</div>
                ) : seasonTeams.length === 0 ? (
                  <div style={{ padding: '20px', color: '#6b7280' }}>No team data available.</div>
                ) : (
                  <StandingsTable teams={seasonTeams} />
                )}
              </>
            ) : (
              <div style={{ padding: '40px', textAlign: 'center', color: '#9ca3af', fontSize: '14px' }}>
                Select a season to view standings
              </div>
            )}
          </div>
        </div>
      )}

      {/* Import Modal */}
      {showImportModal && espnLink && (
        <HistoryImportModal
          leagueId={leagueId}
          externalLeagueId={espnLink.external_league_id}
          provider={espnLink.provider}
          existingSeasons={seasons.map((s) => s.season_year)}
          onComplete={handleImportComplete}
          onCancel={() => setShowImportModal(false)}
        />
      )}
    </div>
  );
}

// ── Standings Table ───────────────────────────────────────────────────────────

function StandingsTable({ teams }: { teams: SeasonTeam[] }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
            <th style={{ padding: '8px 12px', fontWeight: '600', color: '#374151' }}>Rank</th>
            <th style={{ padding: '8px 12px', fontWeight: '600', color: '#374151' }}>Team</th>
            <th style={{ padding: '8px 12px', fontWeight: '600', color: '#374151', textAlign: 'center' }}>W</th>
            <th style={{ padding: '8px 12px', fontWeight: '600', color: '#374151', textAlign: 'center' }}>L</th>
            <th style={{ padding: '8px 12px', fontWeight: '600', color: '#374151', textAlign: 'center' }}>T</th>
            <th style={{ padding: '8px 12px', fontWeight: '600', color: '#374151', textAlign: 'center' }}>PF</th>
            <th style={{ padding: '8px 12px', fontWeight: '600', color: '#374151', textAlign: 'center' }}>PA</th>
            <th style={{ padding: '8px 12px', fontWeight: '600', color: '#374151', textAlign: 'center' }}>Seed</th>
          </tr>
        </thead>
        <tbody>
          {teams.map((t) => (
            <tr
              key={t.id}
              style={{ borderBottom: '1px solid #f3f4f6' }}
            >
              <td style={{ padding: '8px 12px' }}>
                {t.is_champion && <span style={{ fontSize: '16px' }}></span>}
                {t.final_standing ?? '-'}
              </td>
              <td style={{ padding: '8px 12px', fontWeight: t.is_champion ? '600' : '400' }}>
                {t.team_name}
                {t.team_abbrev && (
                  <span style={{ color: '#9ca3af', fontSize: '12px', marginLeft: '6px' }}>({t.team_abbrev})</span>
                )}
              </td>
              <td style={{ padding: '8px 12px', textAlign: 'center' }}>{t.wins}</td>
              <td style={{ padding: '8px 12px', textAlign: 'center' }}>{t.losses}</td>
              <td style={{ padding: '8px 12px', textAlign: 'center' }}>{t.ties}</td>
              <td style={{ padding: '8px 12px', textAlign: 'center' }}>{t.points_for.toFixed(2)}</td>
              <td style={{ padding: '8px 12px', textAlign: 'center' }}>{t.points_against.toFixed(2)}</td>
              <td style={{ padding: '8px 12px', textAlign: 'center' }}>{t.playoff_seed ?? '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Import Modal ──────────────────────────────────────────────────────────────

interface HistoryImportModalProps {
  leagueId: string;
  externalLeagueId: string;
  provider: string;
  existingSeasons: number[];
  onComplete: () => void;
  onCancel: () => void;
}

function HistoryImportModal({
  leagueId,
  externalLeagueId,
  provider,
  existingSeasons,
  onComplete,
  onCancel,
}: HistoryImportModalProps) {
  const [availableSeasons, setAvailableSeasons] = useState<number[]>([]);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [isPrivate, setIsPrivate] = useState(false);
  const [swid, setSwid] = useState('');
  const [espnS2, setEspnS2] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ success: boolean; message: string; details?: string } | null>(null);
  const [discovering, setDiscovering] = useState(false);

  // Auto-discover available seasons using the current-season ESPN endpoint
  const discoverSeasons = useCallback(async () => {
    setDiscovering(true);
    try {
      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/fetch-league-standings`;
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          provider,
          leagueId: externalLeagueId,
          season: existingSeasons.length > 0
            ? Math.max(...existingSeasons) + 1
            : new Date().getFullYear(),
        }),
      });

      if (!response.ok) {
        throw new Error(`Discovery failed (${response.status})`);
      }

      // The standings function doesn't return previousSeasons, so we use a heuristic:
      // Offer the current year and up to 6 years back (verified range from Phase 0)
      const currentYear = new Date().getFullYear();
      const seasons: number[] = [];
      for (let y = currentYear - 1; y >= 2019; y--) {
        seasons.push(y);
      }
      setAvailableSeasons(seasons);
    } catch {
      // Fallback: offer known range
      const currentYear = new Date().getFullYear();
      const seasons: number[] = [];
      for (let y = currentYear - 1; y >= 2019; y--) {
        seasons.push(y);
      }
      setAvailableSeasons(seasons);
    } finally {
      setDiscovering(false);
    }
  }, [externalLeagueId, provider, existingSeasons]);

  useEffect(() => {
    discoverSeasons();
  }, [discoverSeasons]);

  const handleImport = async () => {
    if (!selectedYear) return;
    setImporting(true);
    setImportResult(null);
    try {
      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/import-league-history`;
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
        },
        body: JSON.stringify({
          leagueId,
          seasonYear: selectedYear,
          provider,
          externalLeagueId,
          isPrivate,
          swid: isPrivate ? swid : undefined,
          espnS2: isPrivate ? espnS2 : undefined,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setImportResult({ success: false, message: data.error || 'Import failed' });
      } else {
        setImportResult({
          success: true,
          message: `Imported ${data.teamsImported} teams, ${data.matchupsImported} matchups, ${data.draftPicksImported} draft picks`,
          details: data.warnings?.length > 0 ? `${data.warnings.length} warnings` : undefined,
        });
        // Auto-close after successful import
        setTimeout(() => onComplete(), 1500);
      }
    } catch (err) {
      setImportResult({
        success: false,
        message: err instanceof Error ? err.message : 'Network error',
      });
    } finally {
      setImporting(false);
    }
  };

  const filteredSeasons = availableSeasons.filter((y) => !existingSeasons.includes(y));

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      }}
      onClick={onCancel}
    >
      <div
        style={{
          background: '#fff', borderRadius: '12px', padding: '32px',
          maxWidth: '520px', width: '90%', maxHeight: '85vh', overflowY: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ margin: '0 0 8px 0', fontSize: '20px', fontWeight: '600' }}>Import Historical Season</h2>
        <p style={{ margin: '0 0 24px 0', color: '#6b7280', fontSize: '14px' }}>
          ESPN League ID: {externalLeagueId}
        </p>

        {/* Private league credentials */}
        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={isPrivate}
              onChange={(e) => setIsPrivate(e.target.checked)}
            />
            Private league (requires credentials)
          </label>
          {isPrivate && (
            <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <input
                type="text"
                placeholder="SWID cookie"
                value={swid}
                onChange={(e) => setSwid(e.target.value)}
                style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px' }}
              />
              <input
                type="password"
                placeholder="espn_s2 cookie"
                value={espnS2}
                onChange={(e) => setEspnS2(e.target.value)}
                style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px' }}
              />
            </div>
          )}
        </div>

        {/* Season selection */}
        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', marginBottom: '8px' }}>
            Select Season
          </label>
          {discovering ? (
            <div style={{ color: '#6b7280', fontSize: '14px' }}>Discovering available seasons...</div>
          ) : filteredSeasons.length === 0 ? (
            <div style={{ color: '#6b7280', fontSize: '14px' }}>
              All available seasons have been imported.
            </div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {filteredSeasons.map((year) => (
                <button
                  key={year}
                  onClick={() => setSelectedYear(year)}
                  style={{
                    padding: '8px 16px', fontSize: '14px', cursor: 'pointer',
                    background: selectedYear === year ? '#2563eb' : '#f3f4f6',
                    color: selectedYear === year ? '#fff' : '#374151',
                    border: 'none', borderRadius: '6px', fontWeight: '500',
                  }}
                >
                  {year}
                </button>
              ))}
            </div>
          )}
          {existingSeasons.length > 0 && (
            <p style={{ margin: '8px 0 0 0', fontSize: '12px', color: '#9ca3af' }}>
              Already imported: {existingSeasons.sort((a, b) => b - a).join(', ')}
            </p>
          )}
        </div>

        {/* Import result */}
        {importResult && (
          <div
            style={{
              padding: '12px 16px', borderRadius: '8px', fontSize: '14px', marginBottom: '20px',
              background: importResult.success ? '#f0fdf4' : '#fef2f2',
              border: `1px solid ${importResult.success ? '#86efac' : '#fca5a5'}`,
              color: importResult.success ? '#166534' : '#991b1b',
            }}
          >
            {importResult.success ? '' : ''} {importResult.message}
            {importResult.details && (
              <div style={{ fontSize: '12px', marginTop: '4px', opacity: 0.8 }}>{importResult.details}</div>
            )}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
          <button
            onClick={onCancel}
            style={{
              padding: '10px 20px', fontSize: '14px', fontWeight: '500',
              background: 'transparent', color: '#374151',
              border: '1px solid #d1d5db', borderRadius: '8px', cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={!selectedYear || importing}
            style={{
              padding: '10px 20px', fontSize: '14px', fontWeight: '500',
              background: selectedYear && !importing ? '#2563eb' : '#9ca3af',
              color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer',
              opacity: selectedYear && !importing ? 1 : 0.6,
            }}
          >
            {importing ? 'Importing...' : 'Import Season'}
          </button>
        </div>
      </div>
    </div>
  );
}
