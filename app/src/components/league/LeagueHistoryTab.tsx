import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import HistoricalDraftViewer from './HistoricalDraftViewer.tsx';
import HistoricalManagerPanel from './HistoricalManagerPanel.tsx';
import LeagueLegacyDashboard from './LeagueLegacyDashboard.tsx';

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

type SubTab = 'standings' | 'draft' | 'managers';
type TopView = 'seasons' | 'legacy';

interface DiscoveredSeason {
  year: number;
  status: 'available' | 'imported';
}

interface ImportProgress {
  year: number;
  status: 'pending' | 'importing' | 'success' | 'failed' | 'skipped';
  message?: string;
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
  const [subTab, setSubTab] = useState<SubTab>('standings');
  const [topView, setTopView] = useState<TopView>('seasons');

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

  const handleReimport = async (year: number) => {
    const espnLink = externalLinks.find((l) => l.provider === 'espn');
    if (!espnLink) return;

    const ok = window.confirm(
      `Re-import season ${year}? This will replace all current data for this season. ` +
      'Manager identity corrections will be preserved.'
    );
    if (!ok) return;

    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) {
        setError('Authentication required.');
        return;
      }
      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/import-league-history`;
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'Apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          leagueId,
          seasonYear: year,
          provider: 'espn',
          externalLeagueId: espnLink.external_league_id,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || 'Re-import failed.');
      } else {
        await loadHistory();
        if (selectedSeasonId) loadSeasonTeams(selectedSeasonId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error during re-import.');
    }
  };

  const hasEspnLink = externalLinks.some((l) => l.provider === 'espn');
  const espnLink = externalLinks.find((l) => l.provider === 'espn');
  const selectedSeason = seasons.find((s) => s.id === selectedSeasonId);

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
        <button
          onClick={() => { setError(''); loadHistory(); }}
          style={{
            marginTop: '12px', padding: '8px 16px', fontSize: '13px',
            background: 'transparent', color: '#2563eb',
            border: '1px solid #2563eb', borderRadius: '6px', cursor: 'pointer',
          }}
        >
          Retry
        </button>
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

      {/* Top-level view toggle: Seasons vs Legacy */}
      {seasons.length > 0 && (
        <div style={{ display: 'flex', gap: '8px', marginBottom: '24px' }}>
          <TopViewButton active={topView === 'seasons'} onClick={() => setTopView('seasons')}>
            Seasons
          </TopViewButton>
          <TopViewButton active={topView === 'legacy'} onClick={() => setTopView('legacy')}>
            Legacy
          </TopViewButton>
        </div>
      )}

      {/* Legacy view (all-time stats) */}
      {seasons.length > 0 && topView === 'legacy' && (
        <LeagueLegacyDashboard leagueId={leagueId} />
      )}

      {/* Season list with sub-tabs */}
      {seasons.length > 0 && topView === 'seasons' && (
        <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
          {/* Season selector */}
          <div style={{ flex: '0 0 200px' }}>
            <h3 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: '600', color: '#374151' }}>Seasons</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {seasons.map((s) => (
                <div key={s.id} style={{ position: 'relative' }}>
                  <button
                    onClick={() => handleSeasonSelect(s.id)}
                    style={{
                      width: '100%', padding: '10px 14px', fontSize: '14px', cursor: 'pointer',
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
                  {isOwner && hasEspnLink && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleReimport(s.season_year); }}
                      title={`Re-import ${s.season_year}`}
                      style={{
                        position: 'absolute', top: '8px', right: '8px',
                        padding: '2px 6px', fontSize: '11px', cursor: 'pointer',
                        background: 'transparent', color: '#9ca3af',
                        border: '1px solid #e5e7eb', borderRadius: '4px',
                      }}
                    >
                      Refresh
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Content area */}
          <div style={{ flex: '1', minWidth: '300px' }}>
            {selectedSeasonId ? (
              <>
                {/* Sub-tab navigation */}
                <div style={{ display: 'flex', gap: '16px', marginBottom: '20px', borderBottom: '1px solid #e5e7eb' }}>
                  <SubTabButton active={subTab === 'standings'} onClick={() => setSubTab('standings')}>
                    Standings
                  </SubTabButton>
                  {selectedSeason?.import_completeness?.draft && (
                    <SubTabButton active={subTab === 'draft'} onClick={() => setSubTab('draft')}>
                      Draft
                    </SubTabButton>
                  )}
                  <SubTabButton active={subTab === 'managers'} onClick={() => setSubTab('managers')}>
                    Managers
                  </SubTabButton>
                </div>

                {/* Sub-tab content */}
                {subTab === 'standings' && (
                  <>
                    {loadingTeams ? (
                      <div style={{ padding: '20px', color: '#6b7280' }}>Loading standings...</div>
                    ) : seasonTeams.length === 0 ? (
                      <div style={{ padding: '20px', color: '#6b7280' }}>No team data available.</div>
                    ) : (
                      <StandingsTable teams={seasonTeams} />
                    )}
                  </>
                )}

                {subTab === 'draft' && selectedSeason?.import_completeness?.draft && (
                  <HistoricalDraftViewer seasonId={selectedSeasonId} />
                )}

                {subTab === 'managers' && (
                  <HistoricalManagerPanel
                    leagueId={leagueId}
                    isOwner={isOwner}
                  />
                )}
              </>
            ) : (
              <div style={{ padding: '40px', textAlign: 'center', color: '#9ca3af', fontSize: '14px' }}>
                Select a season to view its history
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
          onComplete={handleImportComplete}
          onCancel={() => setShowImportModal(false)}
        />
      )}
    </div>
  );
}

// ── Top-View Button ───────────────────────────────────────────────────────────

function TopViewButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '8px 18px', fontSize: '14px', fontWeight: active ? '600' : '500',
        cursor: 'pointer',
        background: active ? '#2563eb' : '#fff',
        color: active ? '#fff' : '#374151',
        border: active ? '1px solid #2563eb' : '1px solid #d1d5db',
        borderRadius: '8px',
        transition: 'all 0.15s ease',
      }}
    >
      {children}
    </button>
  );
}

// ── Sub-Tab Button ────────────────────────────────────────────────────────────

function SubTabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '8px 0', fontSize: '14px', cursor: 'pointer',
        background: 'none', border: 'none',
        fontWeight: active ? '600' : '400',
        color: active ? '#2563eb' : '#6b7280',
        borderBottom: active ? '2px solid #2563eb' : '2px solid transparent',
      }}
    >
      {children}
    </button>
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
            <tr key={t.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
              <td style={{ padding: '8px 12px' }}>
                {t.is_champion && <span style={{ fontSize: '16px', marginRight: '4px' }}>&#127942;</span>}
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

// ── Import Modal (with discovery + multi-season) ──────────────────────────────

interface HistoryImportModalProps {
  leagueId: string;
  externalLeagueId: string;
  provider: string;
  onComplete: () => void;
  onCancel: () => void;
}

function HistoryImportModal({
  leagueId,
  externalLeagueId,
  provider,
  onComplete,
  onCancel,
}: HistoryImportModalProps) {
  const [discoveredSeasons, setDiscoveredSeasons] = useState<DiscoveredSeason[]>([]);
  const [selectedYears, setSelectedYears] = useState<Set<number>>(new Set());
  const [isPrivate, setIsPrivate] = useState(false);
  const [swid, setSwid] = useState('');
  const [espnS2, setEspnS2] = useState('');
  const [discovering, setDiscovering] = useState(true);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [requiresAuth, setRequiresAuth] = useState(false);
  const [manualYear, setManualYear] = useState('');
  const [importProgress, setImportProgress] = useState<ImportProgress[]>([]);
  const [importing, setImporting] = useState(false);
  const [importDone, setImportDone] = useState(false);

  // Discover available seasons from ESPN
  const discoverSeasons = useCallback(async () => {
    setDiscovering(true);
    setDiscoveryError(null);
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) {
        setDiscoveryError('Authentication required.');
        return;
      }
      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/import-league-history`;
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'Apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          action: 'discover',
          leagueId,
          provider,
          externalLeagueId,
          isPrivate,
          swid: isPrivate ? swid : undefined,
          espnS2: isPrivate ? espnS2 : undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setDiscoveryError(data.error || 'Discovery failed.');
      } else {
        setDiscoveredSeasons(data.discoveredSeasons ?? []);
        setRequiresAuth(Boolean(data.requiresAuth));
        if (data.error) setDiscoveryError(data.error);
      }
    } catch (err) {
      setDiscoveryError(err instanceof Error ? err.message : 'Network error during discovery.');
    } finally {
      setDiscovering(false);
    }
  }, [leagueId, provider, externalLeagueId, isPrivate, swid, espnS2]);

  useEffect(() => {
    discoverSeasons();
  }, [discoverSeasons]);

  const toggleYear = (year: number) => {
    setSelectedYears((prev) => {
      const next = new Set(prev);
      if (next.has(year)) next.delete(year);
      else next.add(year);
      return next;
    });
  };

  const selectAllAvailable = () => {
    setSelectedYears(new Set(
      discoveredSeasons.filter((s) => s.status === 'available').map((s) => s.year)
    ));
  };

  const addManualYear = () => {
    const year = parseInt(manualYear, 10);
    if (year >= 2000 && year <= new Date().getFullYear()) {
      const exists = discoveredSeasons.find((s) => s.year === year);
      if (!exists) {
        setDiscoveredSeasons((prev) => [...prev, { year, status: 'available' }]);
      }
      setSelectedYears((prev) => new Set(prev).add(year));
      setManualYear('');
    }
  };

  // Sequential multi-season import
  const handleMultiImport = async () => {
    const yearsToImport = Array.from(selectedYears).sort((a, b) => a - b);
    if (yearsToImport.length === 0 || importing) return;

    setImporting(true);
    setImportDone(false);
    const progress: ImportProgress[] = yearsToImport.map((year) => ({
      year, status: 'pending',
    }));
    setImportProgress(progress);

    let session: { data: { session: { access_token: string } | null } };
    try {
      session = await supabase.auth.getSession();
    } catch {
      setImportDone(true);
      setImporting(false);
      return;
    }
    const token = session.data.session?.access_token;
    if (!token) {
      setImportDone(true);
      setImporting(false);
      return;
    }

    const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/import-league-history`;

    // Track results in a local array to avoid stale state reads
    const results = [...progress];

    for (let i = 0; i < yearsToImport.length; i++) {
      const year = yearsToImport[i];
      results[i] = { ...results[i], status: 'importing' };
      setImportProgress([...results]);

      try {
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            'Apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({
            leagueId,
            seasonYear: year,
            provider,
            externalLeagueId,
            isPrivate,
            swid: isPrivate ? swid : undefined,
            espnS2: isPrivate ? espnS2 : undefined,
          }),
        });
        const data = await response.json();
        if (!response.ok) {
          results[i] = { ...results[i], status: 'failed', message: data.error };
        } else {
          results[i] = {
            ...results[i],
            status: 'success',
            message: `${data.teamsImported}t ${data.matchupsImported}m ${data.draftPicksImported}p`,
          };
        }
      } catch (err) {
        results[i] = {
          ...results[i],
          status: 'failed',
          message: err instanceof Error ? err.message : 'Network error',
        };
      }
      setImportProgress([...results]);
    }

    setImportDone(true);
    setImporting(false);
    // No auto-close — commissioner reviews results and clicks Done
  };

  const retryFailed = () => {
    const failedYears = importProgress.filter((p) => p.status === 'failed').map((p) => p.year);
    if (failedYears.length === 0) return;
    setSelectedYears(new Set(failedYears));
    setImportDone(false);
    setImportProgress([]);
  };

  const availableSeasons = discoveredSeasons.filter((s) => s.status === 'available');
  const importedSeasons = discoveredSeasons.filter((s) => s.status === 'imported');
  const successCount = importProgress.filter((p) => p.status === 'success').length;
  const failedCount = importProgress.filter((p) => p.status === 'failed').length;

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
          maxWidth: '560px', width: '90%', maxHeight: '85vh', overflowY: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ margin: '0 0 8px 0', fontSize: '20px', fontWeight: '600' }}>Import Historical Seasons</h2>
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
              <button
                onClick={discoverSeasons}
                disabled={discovering}
                style={{
                  padding: '8px 16px', fontSize: '13px', fontWeight: '500',
                  background: '#2563eb', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer',
                }}
              >
                {discovering ? 'Re-discovering...' : 'Re-discover with credentials'}
              </button>
            </div>
          )}
        </div>

        {/* Discovery status */}
        {discovering && (
          <div style={{ color: '#6b7280', fontSize: '14px', marginBottom: '16px' }}>
            Discovering available seasons from ESPN...
          </div>
        )}

        {discoveryError && !discovering && (
          <div style={{
            padding: '12px 16px', marginBottom: '16px', borderRadius: '8px', fontSize: '13px',
            background: requiresAuth ? '#fffbeb' : '#fef2f2',
            border: `1px solid ${requiresAuth ? '#fcd34d' : '#fca5a5'}`,
            color: requiresAuth ? '#92400e' : '#991b1b',
          }}>
            {discoveryError}
          </div>
        )}

        {/* Already imported seasons */}
        {importedSeasons.length > 0 && !importing && !importDone && (
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '13px', fontWeight: '600', color: '#374151', marginBottom: '8px' }}>
              Already Imported
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {importedSeasons.map((s) => (
                <span key={s.year} style={{
                  padding: '4px 10px', fontSize: '13px', borderRadius: '6px',
                  background: '#f0fdf4', border: '1px solid #86efac', color: '#166534',
                }}>
                  {s.year}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Available seasons */}
        {availableSeasons.length > 0 && !importing && !importDone && (
          <div style={{ marginBottom: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <label style={{ fontSize: '14px', fontWeight: '500' }}>Available Seasons</label>
              <button
                onClick={selectAllAvailable}
                style={{
                  padding: '4px 10px', fontSize: '12px', cursor: 'pointer',
                  background: 'transparent', color: '#2563eb',
                  border: '1px solid #2563eb', borderRadius: '4px',
                }}
              >
                Select All
              </button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {availableSeasons.map((s) => (
                <button
                  key={s.year}
                  onClick={() => toggleYear(s.year)}
                  style={{
                    padding: '8px 16px', fontSize: '14px', cursor: 'pointer',
                    background: selectedYears.has(s.year) ? '#2563eb' : '#f3f4f6',
                    color: selectedYears.has(s.year) ? '#fff' : '#374151',
                    border: 'none', borderRadius: '6px', fontWeight: '500',
                  }}
                >
                  {s.year}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Manual year entry */}
        {!importing && !importDone && (
          <div style={{ marginBottom: '20px' }}>
            <div style={{ fontSize: '13px', fontWeight: '500', color: '#374151', marginBottom: '8px' }}>
              Can't find a season? Enter it manually:
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="number"
                placeholder="Year (e.g. 2018)"
                value={manualYear}
                onChange={(e) => setManualYear(e.target.value)}
                style={{
                  padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px', width: '120px',
                }}
              />
              <button
                onClick={addManualYear}
                style={{
                  padding: '8px 14px', fontSize: '13px', fontWeight: '500',
                  background: '#f3f4f6', color: '#374151',
                  border: '1px solid #d1d5db', borderRadius: '6px', cursor: 'pointer',
                }}
              >
                Add Year
              </button>
            </div>
          </div>
        )}

        {/* Import progress */}
        {importProgress.length > 0 && (
          <div style={{ marginBottom: '20px' }}>
            <div style={{ fontSize: '14px', fontWeight: '600', color: '#374151', marginBottom: '12px' }}>
              Import Progress {importDone && `(${successCount} success, ${failedCount} failed)`}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {importProgress.map((p) => (
                <div
                  key={p.year}
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '8px 12px', borderRadius: '6px', fontSize: '13px',
                    background: p.status === 'success' ? '#f0fdf4' :
                                p.status === 'failed' ? '#fef2f2' :
                                p.status === 'importing' ? '#eff6ff' : '#f9fafb',
                    border: `1px solid ${
                      p.status === 'success' ? '#86efac' :
                      p.status === 'failed' ? '#fca5a5' :
                      p.status === 'importing' ? '#93c5fd' : '#e5e7eb'
                    }`,
                  }}
                >
                  <span style={{ fontWeight: '500' }}>{p.year}</span>
                  <span style={{ color: '#6b7280' }}>
                    {p.status === 'pending' && 'Waiting...'}
                    {p.status === 'importing' && 'Importing...'}
                    {p.status === 'success' && `Done — ${p.message}`}
                    {p.status === 'failed' && `Failed — ${p.message}`}
                    {p.status === 'skipped' && 'Skipped'}
                  </span>
                </div>
              ))}
            </div>
            {importDone && failedCount > 0 && (
              <button
                onClick={retryFailed}
                style={{
                  marginTop: '12px', padding: '8px 16px', fontSize: '13px', fontWeight: '500',
                  background: '#2563eb', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer',
                }}
              >
                Retry Failed Seasons
              </button>
            )}
          </div>
        )}

        {/* Actions */}
        {!importDone && (
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
              onClick={handleMultiImport}
              disabled={selectedYears.size === 0 || importing}
              style={{
                padding: '10px 20px', fontSize: '14px', fontWeight: '500',
                background: selectedYears.size > 0 && !importing ? '#2563eb' : '#9ca3af',
                color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer',
                opacity: selectedYears.size > 0 && !importing ? 1 : 0.6,
              }}
            >
              {importing ? 'Importing...' : `Import ${selectedYears.size} Season${selectedYears.size !== 1 ? 's' : ''}`}
            </button>
          </div>
        )}

        {importDone && (
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              onClick={onComplete}
              style={{
                padding: '10px 20px', fontSize: '14px', fontWeight: '500',
                background: '#2563eb', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer',
              }}
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
