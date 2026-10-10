import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import {
  type LegacyManager,
  type LegacySeasonTeam,
  type LegacyMatchup,
  type CareerStats,
  type H2HStats,
  type ChampionshipEntry,
  type SingleSeasonRecord,
  type MatchupRecord,
  type RecordEntry,
  calculateCareerStats,
  calculateH2H,
  calculateCareerRecords,
  calculateSingleSeasonRecords,
  calculateMatchupRecords,
  buildChampionshipHistory,
  calculateRivals,
} from '../../utils/legacyStats';

// ── Props ───────────────────────────────────────────────────────────────────

interface LeagueLegacyDashboardProps {
  leagueId: string;
}

type LegacyView = 'overview' | 'recordbook' | 'managers' | 'h2h' | 'championships';

// ── Main Component ──────────────────────────────────────────────────────────

export default function LeagueLegacyDashboard({ leagueId }: LeagueLegacyDashboardProps) {
  const [managers, setManagers] = useState<LegacyManager[]>([]);
  const [teams, setTeams] = useState<LegacySeasonTeam[]>([]);
  const [matchups, setMatchups] = useState<LegacyMatchup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<LegacyView>('overview');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [managersRes, teamsRes, matchupsRes, seasonsRes] = await Promise.all([
        supabase
          .from('league_history_managers')
          .select('id, display_name, linked_user_id')
          .eq('league_id', leagueId)
          .order('display_name'),
        supabase
          .from('league_history_season_teams')
          .select(`
            id, season_id, league_id, external_team_id, team_name, team_abbrev,
            wins, losses, ties, points_for, points_against,
            playoff_seed, final_standing, is_champion, is_runner_up,
            primary_manager_id,
            season:league_history_seasons!inner(season_year)
          `)
          .eq('league_id', leagueId),
        supabase
          .from('league_history_matchups')
          .select(`
            id, season_id, league_id, matchup_period, classification,
            home_team_id, away_team_id, home_score, away_score, winner,
            season:league_history_seasons!inner(season_year)
          `)
          .eq('league_id', leagueId)
          .order('matchup_period', { ascending: true }),
        supabase
          .from('league_history_seasons')
          .select('id, season_year, raw_settings, import_status, import_completeness')
          .eq('league_id', leagueId),
      ]);

      // Fetch imported member names to resolve ESPN GUID display names.
      // manager_aliases stores the ESPN owner GUID as display_name, which is
      // not human-readable. league_imported_members has the actual ESPN
      // username in external_owner_name. We fetch across all leagues since
      // the same ESPN owner GUID may have been imported under a different
      // league's import run.
      const aliasOwnerIds = (managersRes.data ?? []).length > 0
        ? await supabase
            .from('league_history_manager_aliases')
            .select('manager_id, external_owner_id')
            .in('manager_id', (managersRes.data ?? []).map((m: any) => m.id))
        : { data: [], error: null };
      if (aliasOwnerIds.error) throw aliasOwnerIds.error;

      const externalOwnerIds = (aliasOwnerIds.data ?? []).map((a: any) => a.external_owner_id).filter(Boolean);
      const ownerNameMap: Record<string, string> = {};
      if (externalOwnerIds.length > 0) {
        const { data: importedMembers, error: imErr } = await supabase
          .from('league_imported_members')
          .select('external_owner_id, external_owner_name')
          .in('external_owner_id', externalOwnerIds);
        if (imErr) throw imErr;
        for (const im of (importedMembers ?? [])) {
          if (im.external_owner_name && !ownerNameMap[im.external_owner_id]) {
            ownerNameMap[im.external_owner_id] = im.external_owner_name;
          }
        }
      }

      // Build manager_id → human-readable name using imported member names
      const managerIdToOwnerId = new Map<string, string>();
      for (const a of (aliasOwnerIds.data ?? [])) {
        managerIdToOwnerId.set(a.manager_id, a.external_owner_id);
      }

      // Fetch aliases for each manager (for profile display)
      const managerIds = (managersRes.data ?? []).map((m: any) => m.id);
      let aliasesMap: Record<string, any[]> = {};
      if (managerIds.length > 0) {
        const { data: aliasData, error: aliasErr } = await supabase
          .from('league_history_manager_aliases')
          .select('manager_id, provider, external_owner_id, display_name')
          .in('manager_id', managerIds);
        if (aliasErr) throw aliasErr;
        for (const a of (aliasData ?? [])) {
          if (!aliasesMap[a.manager_id]) aliasesMap[a.manager_id] = [];
          aliasesMap[a.manager_id].push(a);
        }
      }

      // Fetch co-managers for each team
      const teamIds = (teamsRes.data ?? []).map((t: any) => t.id);
      let coManagersMap: Record<string, { id: string; name: string }[]> = {};
      if (teamIds.length > 0) {
        const { data: tmData, error: tmErr } = await supabase
          .from('league_history_team_managers')
          .select(`
            season_team_id, manager_id, role,
            manager:league_history_managers!inner(display_name)
          `)
          .in('season_team_id', teamIds)
          .eq('role', 'co_manager');
        if (tmErr) throw tmErr;
        for (const tm of (tmData ?? [])) {
          const tid = tm.season_team_id;
          if (!coManagersMap[tid]) coManagersMap[tid] = [];
          coManagersMap[tid].push({ id: tm.manager_id, name: (tm.manager as any)?.display_name ?? 'Unknown' });
        }
      }

      // Resolve human-readable display name: prefer imported member name,
      // fall back to manager display_name (may still be a GUID if no
      // imported member record exists).
      const managerNameMap = new Map<string, string>();
      for (const m of (managersRes.data ?? [])) {
        const ownerId = managerIdToOwnerId.get(m.id);
        const humanName = ownerId ? ownerNameMap[ownerId] : undefined;
        managerNameMap.set(m.id, humanName ?? m.display_name);
      }

      // Extract playoffTeamCount and season finality from season data.
      // import_status === 'complete' means data ingestion succeeded, NOT
      // that the fantasy season is over. We use import_completeness to
      // verify all data types were fetched, and final_standing on teams
      // to verify the season is actually finalized.
      const playoffTeamCountMap = new Map<number, number | null>();
      const seasonImportedMap = new Map<number, boolean>();
      for (const s of (seasonsRes.data ?? [])) {
        const rawSettings = s.raw_settings as any;
        const scheduleSettings = rawSettings?.scheduleSettings;
        const ptc = typeof scheduleSettings?.playoffTeamCount === 'number' && scheduleSettings.playoffTeamCount > 0
          ? scheduleSettings.playoffTeamCount
          : null;
        playoffTeamCountMap.set(s.season_year, ptc);
        // A season is "imported" when import_status is complete AND all
        // data types (matchups, standings) are marked as fetched.
        const completeness = s.import_completeness as any;
        const allDataFetched = s.import_status === 'complete' &&
          completeness?.matchups === true && completeness?.standings === true;
        seasonImportedMap.set(s.season_year, allDataFetched);
      }

      const formattedManagers: LegacyManager[] = (managersRes.data ?? []).map((m: any) => ({
        id: m.id,
        display_name: managerNameMap.get(m.id) ?? m.display_name,
        linked_user_id: m.linked_user_id,
        seasons: 0,
        aliases: (aliasesMap[m.id] ?? []).map((a) => ({
          provider: a.provider,
          external_owner_id: a.external_owner_id,
          display_name: a.display_name,
        })),
      }));

      const formattedTeams: LegacySeasonTeam[] = (teamsRes.data ?? []).map((t: any) => {
        const coMgrs = coManagersMap[t.id] ?? [];
        const seasonYear = (t.season as any)?.season_year ?? 0;
        return {
          id: t.id,
          season_year: seasonYear,
          external_team_id: t.external_team_id,
          team_name: t.team_name,
          team_abbrev: t.team_abbrev,
          wins: t.wins ?? 0,
          losses: t.losses ?? 0,
          ties: t.ties ?? 0,
          // Preserve null from DB — Number(null) returns 0 which would
          // silently convert missing data to zero.
          points_for: t.points_for !== null ? Number(t.points_for) : null,
          points_against: t.points_against !== null ? Number(t.points_against) : null,
          playoff_seed: t.playoff_seed,
          playoff_team_count: playoffTeamCountMap.get(seasonYear) ?? null,
          final_standing: t.final_standing,
          is_champion: t.is_champion ?? false,
          is_runner_up: t.is_runner_up ?? false,
          primary_manager_id: t.primary_manager_id,
          primary_manager_name: t.primary_manager_id ? (managerNameMap.get(t.primary_manager_id) ?? null) : null,
          co_manager_ids: coMgrs.map((c) => c.id),
          co_manager_names: coMgrs.map((c) => managerNameMap.get(c.id) ?? c.name),
          // is_season_complete reflects import success, not season finality.
          // The isSeasonComplete() helper in legacyStats.ts combines this
          // with final_standing !== null to determine true finality.
          is_season_complete: seasonImportedMap.get(seasonYear) ?? false,
        };
      });

      // Build matchup data with team and manager info
      const teamMap = new Map<string, LegacySeasonTeam>();
      for (const t of formattedTeams) teamMap.set(t.id, t);

      const formattedMatchups: LegacyMatchup[] = (matchupsRes.data ?? []).map((m: any) => {
        const home = teamMap.get(m.home_team_id);
        const away = m.away_team_id ? teamMap.get(m.away_team_id) : undefined;
        return {
          id: m.id,
          season_year: (m.season as any)?.season_year ?? 0,
          matchup_period: m.matchup_period,
          classification: m.classification,
          home_team_id: m.home_team_id,
          away_team_id: m.away_team_id,
          home_score: m.home_score !== null ? Number(m.home_score) : null,
          away_score: m.away_score !== null ? Number(m.away_score) : null,
          winner: m.winner,
          home_team_name: home?.team_name ?? 'Unknown',
          away_team_name: away?.team_name ?? null,
          home_manager_id: home?.primary_manager_id ?? null,
          away_manager_id: away?.primary_manager_id ?? null,
          home_manager_name: home?.primary_manager_name ?? null,
          away_manager_name: away?.primary_manager_name ?? null,
        };
      });

      // Count seasons per manager
      const seasonCounts = new Map<string, Set<number>>();
      for (const t of formattedTeams) {
        if (!t.primary_manager_id) continue;
        if (!seasonCounts.has(t.primary_manager_id)) seasonCounts.set(t.primary_manager_id, new Set());
        seasonCounts.get(t.primary_manager_id)!.add(t.season_year);
      }
      for (const m of formattedManagers) {
        m.seasons = seasonCounts.get(m.id)?.size ?? 0;
      }

      setManagers(formattedManagers);
      setTeams(formattedTeams);
      setMatchups(formattedMatchups);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load legacy data');
    } finally {
      setLoading(false);
    }
  }, [leagueId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Memoized computed statistics
  const careers = useMemo(() => calculateCareerStats(teams, managers), [teams, managers]);
  const careerRecords = useMemo(() => calculateCareerRecords(careers), [careers]);
  const seasonRecords = useMemo(() => calculateSingleSeasonRecords(teams), [teams]);
  const matchupRecords = useMemo(() => calculateMatchupRecords(matchups), [matchups]);
  const championships = useMemo(() => buildChampionshipHistory(teams, matchups), [teams, matchups]);

  if (loading) {
    return <div style={{ padding: '20px', color: '#6b7280', fontSize: '14px' }}>Loading legacy data...</div>;
  }

  if (error) {
    return (
      <div style={{ padding: '16px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '8px', color: '#991b1b', fontSize: '14px' }}>
        {error}
        <button
          onClick={() => { setError(null); loadData(); }}
          style={{ marginLeft: '12px', padding: '4px 12px', fontSize: '13px', background: 'transparent', color: '#991b1b', border: '1px solid #fca5a5', borderRadius: '6px', cursor: 'pointer' }}
        >
          Retry
        </button>
      </div>
    );
  }

  if (teams.length === 0) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', background: '#f9fafb', borderRadius: '12px' }}>
        <p style={{ color: '#6b7280', fontSize: '15px', margin: 0 }}>No historical data available yet. Import seasons to see legacy records.</p>
      </div>
    );
  }

  return (
    <div>
      {/* Legacy sub-navigation */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '24px', flexWrap: 'wrap' }}>
        <LegacyTabButton active={view === 'overview'} onClick={() => setView('overview')}>Overview</LegacyTabButton>
        <LegacyTabButton active={view === 'recordbook'} onClick={() => setView('recordbook')}>Record Book</LegacyTabButton>
        <LegacyTabButton active={view === 'managers'} onClick={() => setView('managers')}>Managers</LegacyTabButton>
        <LegacyTabButton active={view === 'h2h'} onClick={() => setView('h2h')}>Head-to-Head</LegacyTabButton>
        <LegacyTabButton active={view === 'championships'} onClick={() => setView('championships')}>Championships</LegacyTabButton>
      </div>

      {view === 'overview' && (
        <OverviewPanel
          careers={careers}
          championships={championships}
          matchupRecords={matchupRecords}
          totalSeasons={new Set(teams.map((t) => t.season_year)).size}
          totalMatchups={matchups.filter((m) => m.classification !== 'bye').length}
          totalManagers={managers.length}
        />
      )}

      {view === 'recordbook' && (
        <RecordBook
          careerRecords={careerRecords}
          seasonRecords={seasonRecords}
          matchupRecords={matchupRecords}
        />
      )}

      {view === 'managers' && (
        <ManagerList careers={careers} matchups={matchups} />
      )}

      {view === 'h2h' && (
        <HeadToHead matchups={matchups} managers={managers} careers={careers} />
      )}

      {view === 'championships' && (
        <ChampionshipHistory championships={championships} />
      )}
    </div>
  );
}

// ── Tab Button ──────────────────────────────────────────────────────────────

function LegacyTabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '8px 16px', fontSize: '13px', fontWeight: active ? '600' : '500',
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

// ── Overview Panel ──────────────────────────────────────────────────────────

function OverviewPanel({
  careers, championships, matchupRecords, totalSeasons, totalMatchups, totalManagers,
}: {
  careers: CareerStats[];
  championships: ChampionshipEntry[];
  matchupRecords: ReturnType<typeof calculateMatchupRecords>;
  totalSeasons: number;
  totalMatchups: number;
  totalManagers: number;
}) {
  const topManager = [...careers].sort((a, b) => b.wins - a.wins)[0];
  const highestScorer = matchupRecords.highest_score[0];
  const latestChampion = championships[0];

  return (
    <div>
      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px', marginBottom: '24px' }}>
        <StatCard label="Seasons" value={totalSeasons} />
        <StatCard label="Managers" value={totalManagers} />
        <StatCard label="Matchups" value={totalMatchups} />
        <StatCard label="Champions" value={championships.length} />
      </div>

      {/* Reigning Champion */}
      {latestChampion && (
        <div style={{ padding: '20px', background: 'linear-gradient(135deg, #1e3a8a, #2563eb)', borderRadius: '12px', color: '#fff', marginBottom: '20px' }}>
          <div style={{ fontSize: '12px', opacity: 0.85, marginBottom: '4px' }}>REIGNING CHAMPION {latestChampion.season_year}</div>
          <div style={{ fontSize: '20px', fontWeight: '700' }}>{latestChampion.champion_team_name}</div>
          <div style={{ fontSize: '14px', opacity: 0.9, marginTop: '4px' }}>
            {latestChampion.champion_manager_name}
            {latestChampion.champion_score !== null && latestChampion.runner_up_score !== null && (
              <span style={{ marginLeft: '12px', opacity: 0.8 }}>
                {latestChampion.champion_score.toFixed(2)} - {latestChampion.runner_up_score.toFixed(2)}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Career leader + single game record */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '16px' }}>
        {topManager && (
          <div style={{ padding: '16px', background: '#f9fafb', borderRadius: '10px', border: '1px solid #e5e7eb' }}>
            <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '8px' }}>CAREER WINS LEADER</div>
            <div style={{ fontSize: '16px', fontWeight: '600', color: '#1f2937' }}>{topManager.display_name}</div>
            <div style={{ fontSize: '14px', color: '#6b7280', marginTop: '4px' }}>
              {topManager.wins}-{topManager.losses}-{topManager.ties}
              <span style={{ marginLeft: '8px' }}>({(topManager.win_pct * 100).toFixed(1)}%)</span>
            </div>
          </div>
        )}
        {highestScorer && (
          <div style={{ padding: '16px', background: '#f9fafb', borderRadius: '10px', border: '1px solid #e5e7eb' }}>
            <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '8px' }}>HIGHEST SINGLE-GAME SCORE</div>
            <div style={{ fontSize: '16px', fontWeight: '600', color: '#1f2937' }}>{highestScorer.display_value} pts</div>
            <div style={{ fontSize: '14px', color: '#6b7280', marginTop: '4px' }}>
              {highestScorer.manager_name} ({highestScorer.season_year} W{highestScorer.matchup_period})
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div style={{ padding: '16px', background: '#fff', borderRadius: '10px', border: '1px solid #e5e7eb', textAlign: 'center' }}>
      <div style={{ fontSize: '24px', fontWeight: '700', color: '#2563eb' }}>{value}</div>
      <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>{label}</div>
    </div>
  );
}

// ── Record Book ─────────────────────────────────────────────────────────────

function RecordBook({
  careerRecords, seasonRecords, matchupRecords,
}: {
  careerRecords: ReturnType<typeof calculateCareerRecords>;
  seasonRecords: ReturnType<typeof calculateSingleSeasonRecords>;
  matchupRecords: ReturnType<typeof calculateMatchupRecords>;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
      <RecordSection title="Career Records">
        <RecordList title="Most Wins" records={careerRecords.most_wins} />
        <RecordList title="Most Losses" records={careerRecords.most_losses} />
        <RecordList title="Best Win %" records={careerRecords.highest_win_pct} />
        <RecordList title="Most Points For" records={careerRecords.most_points} />
        <RecordList title="Most Championships" records={careerRecords.most_championships} />
        <RecordList title="Most Championship Appearances" records={careerRecords.most_champ_appearances} />
        <RecordList title="Most Playoff Appearances" records={careerRecords.most_playoff_appearances} />
      </RecordSection>

      <RecordSection title="Single-Season Records">
        <RecordList title="Most Wins (Season)" records={seasonRecords.most_wins} />
        <RecordList title="Fewest Losses (Season)" records={seasonRecords.fewest_losses} />
        <RecordList title="Most Points (Season)" records={seasonRecords.most_points} />
        <RecordList title="Best Win % (Season)" records={seasonRecords.best_win_pct} />
      </RecordSection>

      <RecordSection title="Single-Game Records">
        <RecordList title="Highest Score" records={matchupRecords.highest_score} />
        <RecordList title="Lowest Score" records={matchupRecords.lowest_score} />
        <RecordList title="Largest Margin of Victory" records={matchupRecords.largest_margin} />
        <RecordList title="Closest Margin" records={matchupRecords.closest_margin} />
        <RecordList title="Highest Combined Score" records={matchupRecords.highest_combined} />
      </RecordSection>
    </div>
  );
}

function RecordSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 style={{ margin: '0 0 16px 0', fontSize: '16px', fontWeight: '600', color: '#1f2937', paddingBottom: '8px', borderBottom: '2px solid #e5e7eb' }}>
        {title}
      </h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
        {children}
      </div>
    </div>
  );
}

function RecordList({ title, records }: { title: string; records: RecordEntry[] | SingleSeasonRecord[] | MatchupRecord[] }) {
  return (
    <div style={{ padding: '14px', background: '#f9fafb', borderRadius: '10px', border: '1px solid #e5e7eb' }}>
      <div style={{ fontSize: '12px', fontWeight: '600', color: '#374151', marginBottom: '10px' }}>{title}</div>
      {records.length === 0 ? (
        <div style={{ fontSize: '13px', color: '#9ca3af' }}>No data</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {records.map((r, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
              <span style={{ fontWeight: '700', color: '#2563eb', minWidth: '20px' }}>#{i + 1}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: '500', color: '#1f2937', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.manager_name}
                </div>
                {(r as any).team_name && (
                  <div style={{ fontSize: '11px', color: '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {(r as any).team_name} ({r.season_year})
                    {(r as any).matchup_period ? ` W${(r as any).matchup_period}` : ''}
                  </div>
                )}
              </div>
              <span style={{ fontWeight: '600', color: '#1f2937', fontSize: '13px' }}>{r.display_value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Manager List & Profile ──────────────────────────────────────────────────

function ManagerList({ careers, matchups }: { careers: CareerStats[]; matchups: LegacyMatchup[] }) {
  const [selectedManagerId, setSelectedManagerId] = useState<string | null>(null);

  if (selectedManagerId) {
    const career = careers.find((c) => c.manager_id === selectedManagerId);
    if (!career) {
      setSelectedManagerId(null);
      return null;
    }
    return (
      <ManagerProfile
        career={career}
        matchups={matchups}
        onBack={() => setSelectedManagerId(null)}
      />
    );
  }

  const sorted = [...careers].sort((a, b) => {
    if (b.championships !== a.championships) return b.championships - a.championships;
    return b.wins - a.wins;
  });

  return (
    <div>
      <h3 style={{ margin: '0 0 16px 0', fontSize: '16px', fontWeight: '600', color: '#1f2937' }}>Manager Career Records</h3>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
              <th style={{ padding: '10px 12px', fontWeight: '600', color: '#374151' }}>Manager</th>
              <th style={{ padding: '10px 8px', fontWeight: '600', color: '#374151', textAlign: 'center' }}>Seasons</th>
              <th style={{ padding: '10px 8px', fontWeight: '600', color: '#374151', textAlign: 'center' }}>W</th>
              <th style={{ padding: '10px 8px', fontWeight: '600', color: '#374151', textAlign: 'center' }}>L</th>
              <th style={{ padding: '10px 8px', fontWeight: '600', color: '#374151', textAlign: 'center' }}>T</th>
              <th style={{ padding: '10px 8px', fontWeight: '600', color: '#374151', textAlign: 'center' }}>Win%</th>
              <th style={{ padding: '10px 8px', fontWeight: '600', color: '#374151', textAlign: 'center' }}>PF</th>
              <th style={{ padding: '10px 8px', fontWeight: '600', color: '#374151', textAlign: 'center' }}>Champs</th>
              <th style={{ padding: '10px 8px', fontWeight: '600', color: '#374151', textAlign: 'center' }}>Playoffs</th>
              <th style={{ padding: '10px 12px', fontWeight: '600', color: '#374151', textAlign: 'center' }}>Best</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((c) => (
              <tr
                key={c.manager_id}
                onClick={() => setSelectedManagerId(c.manager_id)}
                style={{ borderBottom: '1px solid #f3f4f6', cursor: 'pointer', transition: 'background 0.1s' }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = '#eff6ff'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = ''; }}
              >
                <td style={{ padding: '10px 12px', fontWeight: '500', color: '#1f2937' }}>{c.display_name}</td>
                <td style={{ padding: '10px 8px', textAlign: 'center', color: '#6b7280' }}>{c.seasons}{c.complete_seasons < c.seasons && <span style={{ fontSize: '10px', color: '#f59e0b' }}> ({c.complete_seasons}c)</span>}</td>
                <td style={{ padding: '10px 8px', textAlign: 'center', fontWeight: '500' }}>{c.wins}</td>
                <td style={{ padding: '10px 8px', textAlign: 'center', color: '#6b7280' }}>{c.losses}</td>
                <td style={{ padding: '10px 8px', textAlign: 'center', color: '#6b7280' }}>{c.ties}</td>
                <td style={{ padding: '10px 8px', textAlign: 'center' }}>{(c.win_pct * 100).toFixed(1)}%</td>
                <td style={{ padding: '10px 8px', textAlign: 'center' }}>{c.points_for.toFixed(0)}</td>
                <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                  {c.championships > 0 ? <span style={{ fontWeight: '700', color: '#2563eb' }}>{c.championships}</span> : <span style={{ color: '#d1d5db' }}>0</span>}
                </td>
                <td style={{ padding: '10px 8px', textAlign: 'center', color: '#6b7280' }}>{c.playoff_appearances === null ? 'N/A' : c.playoff_appearances}</td>
                <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                  {c.best_finish ? (c.best_finish === 1 ? <span style={{ fontWeight: '700', color: '#2563eb' }}>1st</span> : `${c.best_finish}`) : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ManagerProfile({ career, matchups, onBack }: { career: CareerStats; matchups: LegacyMatchup[]; onBack: () => void }) {
  const rivals = useMemo(() => calculateRivals(matchups, career.manager_id, 5), [matchups, career.manager_id]);

  return (
    <div>
      <button onClick={onBack} style={{ marginBottom: '16px', padding: '6px 12px', fontSize: '13px', background: 'transparent', color: '#2563eb', border: '1px solid #2563eb', borderRadius: '6px', cursor: 'pointer' }}>
        All Managers
      </button>

      {/* Profile header */}
      <div style={{ padding: '20px', background: '#f9fafb', borderRadius: '12px', marginBottom: '20px' }}>
        <h2 style={{ margin: '0 0 4px 0', fontSize: '20px', fontWeight: '700', color: '#1f2937' }}>{career.display_name}</h2>
        <div style={{ fontSize: '14px', color: '#6b7280' }}>
          {career.seasons} season{career.seasons !== 1 ? 's' : ''}
          {career.complete_seasons < career.seasons && <span style={{ marginLeft: '8px', fontSize: '12px', color: '#f59e0b' }}>({career.complete_seasons} of {career.seasons} complete)</span>}
          {career.championships > 0 && <span style={{ marginLeft: '12px', color: '#2563eb', fontWeight: '600' }}>{career.championships}x Champion</span>}
        </div>
      </div>

      {/* Career summary stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: '10px', marginBottom: '24px' }}>
        <StatCard label="Wins" value={career.wins} />
        <StatCard label="Losses" value={career.losses} />
        <StatCard label="Ties" value={career.ties} />
        <div style={{ padding: '16px', background: '#fff', borderRadius: '10px', border: '1px solid #e5e7eb', textAlign: 'center' }}>
          <div style={{ fontSize: '24px', fontWeight: '700', color: '#2563eb' }}>{(career.win_pct * 100).toFixed(1)}%</div>
          <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>Win Rate</div>
        </div>
        <StatCard label="Championships" value={career.championships} />
        <StatCard label="Playoff Appearances" value={career.playoff_appearances === null ? 'N/A' : career.playoff_appearances} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', flexWrap: 'wrap' }}>
        {/* Season-by-season */}
        <div>
          <h3 style={{ margin: '0 0 12px 0', fontSize: '15px', fontWeight: '600', color: '#1f2937' }}>Season History</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {career.season_records.sort((a, b) => a.season_year - b.season_year).map((s, i) => (
              <div key={i} style={{ padding: '12px', background: '#f9fafb', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <span style={{ fontSize: '14px', fontWeight: '600', color: '#1f2937' }}>{s.season_year}</span>
                  <span style={{ fontSize: '12px', fontWeight: '600', color: s.is_champion ? '#2563eb' : s.is_runner_up ? '#6b7280' : '#9ca3af' }}>
                    {s.is_champion ? 'Champion' : s.is_runner_up ? 'Runner-up' : s.final_standing ? `#${s.final_standing}` : '-'}
                  </span>
                  {s.is_season_complete === false && <span style={{ marginLeft: '8px', color: '#f59e0b', fontSize: '11px', fontWeight: '600' }}>Incomplete</span>}
                </div>
                <div style={{ fontSize: '13px', color: '#6b7280' }}>
                  {s.team_name}
                </div>
                <div style={{ fontSize: '13px', color: '#374151', marginTop: '4px' }}>
                  {s.wins}-{s.losses}-{s.ties}
                  <span style={{ marginLeft: '8px', color: '#9ca3af' }}>PF {s.points_for.toFixed(0)} PA {s.points_against.toFixed(0)}</span>
                  {s.playoff_seed !== null && <span style={{ marginLeft: '8px', color: '#9ca3af' }}>Seed #{s.playoff_seed}</span>}
                  {s.made_playoffs === true && <span style={{ marginLeft: '8px', color: '#2563eb', fontSize: '11px', fontWeight: '600' }}>Playoffs</span>}
                  {s.made_playoffs === null && s.playoff_seed !== null && <span style={{ marginLeft: '8px', color: '#9ca3af', fontSize: '11px' }}>Seed (bracket unknown)</span>}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Top rivals */}
        <div>
          <h3 style={{ margin: '0 0 12px 0', fontSize: '15px', fontWeight: '600', color: '#1f2937' }}>Top Rivals</h3>
          {rivals.length === 0 ? (
            <div style={{ padding: '16px', color: '#9ca3af', fontSize: '14px' }}>No matchups found.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {rivals.map((r, i) => {
                const totalGames = r.wins + r.losses + r.ties;
                const winPct = totalGames > 0 ? (r.wins / totalGames) * 100 : 0;
                return (
                  <div key={i} style={{ padding: '12px', background: '#f9fafb', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '14px', fontWeight: '500', color: '#1f2937' }}>{r.manager_name}</span>
                      <span style={{ fontSize: '12px', color: '#9ca3af' }}>{r.matchup_count} games</span>
                    </div>
                    <div style={{ fontSize: '13px', color: '#374151', marginTop: '4px' }}>
                      {r.wins}-{r.losses}-{r.ties}
                      <span style={{ marginLeft: '6px', color: '#9ca3af' }}>({winPct.toFixed(0)}%)</span>
                    </div>
                    {/* Win/loss bar */}
                    <div style={{ marginTop: '6px', height: '4px', borderRadius: '2px', overflow: 'hidden', background: '#e5e7eb' }}>
                      <div style={{ height: '100%', width: `${winPct}%`, background: '#2563eb', transition: 'width 0.3s ease' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Head-to-Head ────────────────────────────────────────────────────────────

function HeadToHead({ matchups, managers, careers }: { matchups: LegacyMatchup[]; managers: LegacyManager[]; careers: CareerStats[] }) {
  const [managerAId, setManagerAId] = useState<string>('');
  const [managerBId, setManagerBId] = useState<string>('');

  // Default select top 2 by wins
  useEffect(() => {
    if (!managerAId && !managerBId && careers.length >= 2) {
      const sorted = [...careers].sort((a, b) => b.wins - a.wins);
      setManagerAId(sorted[0].manager_id);
      setManagerBId(sorted[1].manager_id);
    }
  }, [careers, managerAId, managerBId]);

  const eligibleManagers = managers.filter((m) => careers.some((c) => c.manager_id === m.id));
  const h2hStats = useMemo(() => {
    if (!managerAId || !managerBId || managerAId === managerBId) return null;
    return calculateH2H(matchups, managerAId, managerBId);
  }, [matchups, managerAId, managerBId]);

  const mgrA = managers.find((m) => m.id === managerAId);
  const mgrB = managers.find((m) => m.id === managerBId);

  return (
    <div>
      <h3 style={{ margin: '0 0 16px 0', fontSize: '16px', fontWeight: '600', color: '#1f2937' }}>Head-to-Head Comparison</h3>

      {/* Selector */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '24px', flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={managerAId} onChange={(e) => setManagerAId(e.target.value)} style={selectStyle}>
          <option value="">Select Manager A...</option>
          {eligibleManagers.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}
        </select>
        <span style={{ fontSize: '18px', fontWeight: '700', color: '#9ca3af' }}>vs</span>
        <select value={managerBId} onChange={(e) => setManagerBId(e.target.value)} style={selectStyle}>
          <option value="">Select Manager B...</option>
          {eligibleManagers.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}
        </select>
      </div>

      {!h2hStats ? (
        <div style={{ padding: '40px', textAlign: 'center', color: '#9ca3af', fontSize: '14px', background: '#f9fafb', borderRadius: '12px' }}>
          {managerAId === managerBId && managerAId ? 'Select two different managers to compare.' : 'Select two managers to see their head-to-head record.'}
        </div>
      ) : h2hStats.matchups.length === 0 ? (
        <div style={{ padding: '40px', textAlign: 'center', color: '#9ca3af', fontSize: '14px', background: '#f9fafb', borderRadius: '12px' }}>
          These two managers have never faced each other.
        </div>
      ) : (
        <H2HResult stats={h2hStats} mgrAName={mgrA?.display_name ?? 'Manager A'} mgrBName={mgrB?.display_name ?? 'Manager B'} />
      )}
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  padding: '8px 12px', fontSize: '14px', borderRadius: '8px',
  border: '1px solid #d1d5db', background: '#fff', color: '#1f2937', cursor: 'pointer',
};

function H2HResult({ stats, mgrAName, mgrBName }: { stats: H2HStats; mgrAName: string; mgrBName: string }) {
  const totalGames = stats.total.wins + stats.total.losses + stats.total.ties;

  return (
    <div>
      {/* Summary score */}
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '32px', padding: '24px', background: '#f9fafb', borderRadius: '12px', marginBottom: '20px', flexWrap: 'wrap' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '14px', fontWeight: '600', color: '#1f2937', marginBottom: '4px' }}>{mgrAName}</div>
          <div style={{ fontSize: '32px', fontWeight: '800', color: '#2563eb' }}>{stats.total.wins}</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '12px', color: '#9ca3af' }}>TIES</div>
          <div style={{ fontSize: '20px', fontWeight: '700', color: '#6b7280' }}>{stats.total.ties}</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '14px', fontWeight: '600', color: '#1f2937', marginBottom: '4px' }}>{mgrBName}</div>
          <div style={{ fontSize: '32px', fontWeight: '800', color: '#dc2626' }}>{stats.total.losses}</div>
        </div>
      </div>

      {/* Breakdown */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px', marginBottom: '24px' }}>
        <div style={{ padding: '14px', background: '#fff', borderRadius: '10px', border: '1px solid #e5e7eb', textAlign: 'center' }}>
          <div style={{ fontSize: '18px', fontWeight: '700', color: '#1f2937' }}>{totalGames}</div>
          <div style={{ fontSize: '12px', color: '#6b7280' }}>Total Games</div>
        </div>
        <div style={{ padding: '14px', background: '#fff', borderRadius: '10px', border: '1px solid #e5e7eb', textAlign: 'center' }}>
          <div style={{ fontSize: '18px', fontWeight: '700', color: '#1f2937' }}>
            {stats.regular.wins}-{stats.regular.losses}-{stats.regular.ties}
          </div>
          <div style={{ fontSize: '12px', color: '#6b7280' }}>Regular Season</div>
        </div>
        <div style={{ padding: '14px', background: '#fff', borderRadius: '10px', border: '1px solid #e5e7eb', textAlign: 'center' }}>
          <div style={{ fontSize: '18px', fontWeight: '700', color: '#1f2937' }}>
            {stats.playoff.wins}-{stats.playoff.losses}-{stats.playoff.ties}
          </div>
          <div style={{ fontSize: '12px', color: '#6b7280' }}>Playoffs</div>
        </div>
        <div style={{ padding: '14px', background: '#fff', borderRadius: '10px', border: '1px solid #e5e7eb', textAlign: 'center' }}>
          <div style={{ fontSize: '18px', fontWeight: '700', color: '#1f2937' }}>{stats.points_for.toFixed(0)}</div>
          <div style={{ fontSize: '12px', color: '#6b7280' }}>PF (A)</div>
        </div>
        <div style={{ padding: '14px', background: '#fff', borderRadius: '10px', border: '1px solid #e5e7eb', textAlign: 'center' }}>
          <div style={{ fontSize: '18px', fontWeight: '700', color: '#1f2937' }}>{stats.points_against.toFixed(0)}</div>
          <div style={{ fontSize: '12px', color: '#6b7280' }}>PA (A)</div>
        </div>
        {stats.largest_margin !== null && (
          <div style={{ padding: '14px', background: '#fff', borderRadius: '10px', border: '1px solid #e5e7eb', textAlign: 'center' }}>
            <div style={{ fontSize: '18px', fontWeight: '700', color: '#1f2937' }}>{stats.largest_margin.toFixed(2)}</div>
            <div style={{ fontSize: '12px', color: '#6b7280' }}>Largest Margin</div>
          </div>
        )}
      </div>

      {/* Game log */}
      <h4 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: '600', color: '#374151' }}>Game History</h4>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
              <th style={{ padding: '8px 10px', fontWeight: '600', color: '#374151' }}>Season</th>
              <th style={{ padding: '8px 10px', fontWeight: '600', color: '#374151' }}>Week</th>
              <th style={{ padding: '8px 10px', fontWeight: '600', color: '#374151' }}>Type</th>
              <th style={{ padding: '8px 10px', fontWeight: '600', color: '#374151', textAlign: 'right' }}>{mgrAName}</th>
              <th style={{ padding: '8px 10px', fontWeight: '600', color: '#374151', textAlign: 'right' }}>{mgrBName}</th>
              <th style={{ padding: '8px 10px', fontWeight: '600', color: '#374151', textAlign: 'center' }}>Result</th>
            </tr>
          </thead>
          <tbody>
            {stats.matchups.map((m, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={{ padding: '8px 10px' }}>{m.season_year}</td>
                <td style={{ padding: '8px 10px' }}>W{m.matchup_period}</td>
                <td style={{ padding: '8px 10px' }}>
                  <span style={{
                    padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: '600',
                    background: m.classification === 'championship' ? '#fef3c7' : m.classification === 'playoff' ? '#dbeafe' : '#f3f4f6',
                    color: m.classification === 'championship' ? '#92400e' : m.classification === 'playoff' ? '#1e40af' : '#6b7280',
                  }}>
                    {m.classification === 'championship' ? 'Championship' : m.classification === 'playoff' ? 'Playoff' : 'Regular'}
                  </span>
                </td>
                <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: m.manager_a_won ? '700' : '400', color: m.manager_a_won ? '#2563eb' : '#374151' }}>
                  {m.manager_a_score.toFixed(2)}
                </td>
                <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: !m.is_tie && !m.manager_a_won ? '700' : '400', color: !m.is_tie && !m.manager_a_won ? '#dc2626' : '#374151' }}>
                  {m.manager_b_score.toFixed(2)}
                </td>
                <td style={{ padding: '8px 10px', textAlign: 'center', fontWeight: '600' }}>
                  {m.is_tie ? 'Tie' : m.manager_a_won ? 'A' : 'B'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Championship History ────────────────────────────────────────────────────

function ChampionshipHistory({ championships }: { championships: ChampionshipEntry[] }) {
  if (championships.length === 0) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: '#9ca3af', fontSize: '14px', background: '#f9fafb', borderRadius: '12px' }}>
        No championship games recorded yet.
      </div>
    );
  }

  return (
    <div>
      <h3 style={{ margin: '0 0 16px 0', fontSize: '16px', fontWeight: '600', color: '#1f2937' }}>Championship History</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {championships.map((c) => (
          <div key={c.season_year} style={{ display: 'flex', gap: '16px', alignItems: 'center', padding: '20px', background: '#f9fafb', borderRadius: '12px', border: '1px solid #e5e7eb', flexWrap: 'wrap' }}>
            {/* Trophy */}
            <div style={{ fontSize: '36px', flexShrink: 0 }}>&#127942;</div>

            {/* Year */}
            <div style={{ textAlign: 'center', minWidth: '60px' }}>
              <div style={{ fontSize: '20px', fontWeight: '700', color: '#1f2937' }}>{c.season_year}</div>
            </div>

            {/* Champion & Runner-up */}
            <div style={{ flex: 1, minWidth: '200px' }}>
              <div style={{ marginBottom: '8px' }}>
                <div style={{ fontSize: '11px', fontWeight: '600', color: '#2563eb' }}>CHAMPION</div>
                <div style={{ fontSize: '15px', fontWeight: '600', color: '#1f2937' }}>{c.champion_team_name}</div>
                <div style={{ fontSize: '13px', color: '#6b7280' }}>{c.champion_manager_name}</div>
              </div>
              {c.runner_up_team_name && (
                <div>
                  <div style={{ fontSize: '11px', fontWeight: '600', color: '#9ca3af' }}>RUNNER-UP</div>
                  <div style={{ fontSize: '14px', fontWeight: '500', color: '#374151' }}>{c.runner_up_team_name}</div>
                  <div style={{ fontSize: '13px', color: '#9ca3af' }}>{c.runner_up_manager_name}</div>
                </div>
              )}
            </div>

            {/* Score */}
            {c.has_championship_game && c.champion_score !== null && c.runner_up_score !== null && (
              <div style={{ textAlign: 'center', padding: '12px 20px', background: '#fff', borderRadius: '10px', border: '1px solid #e5e7eb' }}>
                <div style={{ fontSize: '20px', fontWeight: '700', color: '#2563eb' }}>{c.champion_score.toFixed(2)}</div>
                <div style={{ fontSize: '11px', color: '#9ca3af', margin: '2px 0' }}>-</div>
                <div style={{ fontSize: '16px', fontWeight: '600', color: '#6b7280' }}>{c.runner_up_score.toFixed(2)}</div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
