import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

interface DraftPick {
  id: string;
  overall_pick_number: number;
  round_number: number;
  round_pick_number: number | null;
  external_team_id: string | null;
  player_name: string | null;
  external_player_id: string | null;
  is_keeper: boolean;
  auction_bid_amount: number | null;
}

interface DraftInfo {
  id: string;
  draft_type: string;
  num_rounds: number;
  num_picks: number;
  completed_at: string | null;
}

interface SeasonTeam {
  id: string;
  external_team_id: string;
  team_name: string;
  team_abbrev: string | null;
}

interface TeamManager {
  season_team_id: string;
  manager_id: string;
  display_name: string;
  role: string;
}

interface DraftViewerProps {
  seasonId: string;
}

type ViewMode = 'round' | 'team';

export default function HistoricalDraftViewer({ seasonId }: DraftViewerProps) {
  const [draft, setDraft] = useState<DraftInfo | null>(null);
  const [picks, setPicks] = useState<DraftPick[]>([]);
  const [teams, setTeams] = useState<SeasonTeam[]>([]);
  const [managers, setManagers] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('round');
  const [selectedRound, setSelectedRound] = useState(1);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);

  const loadDraft = useCallback(async () => {
    setLoading(true);
    try {
      const [draftRes, picksRes, teamsRes, tmRes] = await Promise.all([
        supabase
          .from('league_history_drafts')
          .select('id, draft_type, num_rounds, num_picks, completed_at')
          .eq('season_id', seasonId)
          .maybeSingle(),
        supabase
          .from('league_history_draft_picks')
          .select('id, overall_pick_number, round_number, round_pick_number, external_team_id, player_name, external_player_id, is_keeper, auction_bid_amount')
          .eq('season_id', seasonId)
          .order('overall_pick_number', { ascending: true }),
        supabase
          .from('league_history_season_teams')
          .select('id, external_team_id, team_name, team_abbrev')
          .eq('season_id', seasonId),
        supabase
          .from('league_history_team_managers')
          .select('season_team_id, manager_id, role'),
      ]);

      if (draftRes.error) throw draftRes.error;

      setDraft((draftRes.data as DraftInfo | null) ?? null);
      setPicks((picksRes.data ?? []) as DraftPick[]);

      const teamList = (teamsRes.data ?? []) as SeasonTeam[];
      setTeams(teamList);

      // Build manager name map
      const managerIds = new Set<string>();
      for (const tm of (tmRes.data ?? []) as TeamManager[]) {
        managerIds.add(tm.manager_id);
      }
      const managerNames = new Map<string, string>();
      if (managerIds.size > 0) {
        const { data: mgrData } = await supabase
          .from('league_history_managers')
          .select('id, display_name')
          .in('id', Array.from(managerIds));
        for (const m of (mgrData ?? []) as { id: string; display_name: string }[]) {
          managerNames.set(m.id, m.display_name);
        }
      }

      // Build team_id → primary manager name map
      const teamManagerMap = new Map<string, string>();
      for (const tm of (tmRes.data ?? []) as TeamManager[]) {
        if (tm.role === 'primary') {
          teamManagerMap.set(tm.season_team_id, managerNames.get(tm.manager_id) ?? 'Unknown');
        }
      }
      setManagers(teamManagerMap);

      // Set defaults
      if (draftRes.data) {
        setSelectedRound(1);
      }
      if (teamList.length > 0) {
        setSelectedTeamId(teamList[0].id);
      }
    } catch {
      // silent fail — draft viewer is non-critical
    } finally {
      setLoading(false);
    }
  }, [seasonId]);

  useEffect(() => {
    loadDraft();
  }, [loadDraft]);

  if (loading) {
    return <div style={{ padding: '20px', color: '#6b7280' }}>Loading draft...</div>;
  }

  if (!draft || picks.length === 0) {
    return (
      <div style={{ padding: '20px', color: '#6b7280', fontSize: '14px' }}>
        No draft data available for this season.
      </div>
    );
  }

  const teamByExtId = new Map<string, SeasonTeam>();
  const teamByUuid = new Map<string, SeasonTeam>();
  for (const t of teams) {
    teamByExtId.set(t.external_team_id, t);
    teamByUuid.set(t.id, t);
  }

  const completedDate = draft.completed_at
    ? new Date(draft.completed_at).toLocaleDateString()
    : 'Unknown';

  const rounds = Array.from({ length: draft.num_rounds }, (_, i) => i + 1);

  // Filter picks by view mode
  const filteredPicks = viewMode === 'round'
    ? picks.filter((p) => p.round_number === selectedRound)
    : picks.filter((p) => {
        const team = p.external_team_id ? teamByExtId.get(p.external_team_id) : null;
        return team?.id === selectedTeamId;
      });

  const isAuction = draft.draft_type === 'AUCTION' || draft.draft_type === 'auction';

  return (
    <div>
      {/* Draft header */}
      <div style={{ marginBottom: '16px', display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center' }}>
        <div>
          <span style={{ fontSize: '14px', color: '#6b7280' }}>
            {draft.draft_type} draft &middot; {draft.num_picks} picks &middot; {completedDate}
          </span>
        </div>
      </div>

      {/* View toggle */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        <ViewToggle active={viewMode === 'round'} onClick={() => setViewMode('round')}>
          By Round
        </ViewToggle>
        <ViewToggle active={viewMode === 'team'} onClick={() => setViewMode('team')}>
          By Team
        </ViewToggle>
      </div>

      {/* Round or team selector */}
      {viewMode === 'round' ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '16px' }}>
          {rounds.map((r) => (
            <button
              key={r}
              onClick={() => setSelectedRound(r)}
              style={{
                padding: '6px 14px', fontSize: '13px', cursor: 'pointer',
                background: selectedRound === r ? '#2563eb' : '#f3f4f6',
                color: selectedRound === r ? '#fff' : '#374151',
                border: 'none', borderRadius: '6px', fontWeight: '500',
              }}
            >
              Round {r}
            </button>
          ))}
        </div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '16px' }}>
          {teams.map((t) => (
            <button
              key={t.id}
              onClick={() => setSelectedTeamId(t.id)}
              style={{
                padding: '6px 14px', fontSize: '13px', cursor: 'pointer',
                background: selectedTeamId === t.id ? '#2563eb' : '#f3f4f6',
                color: selectedTeamId === t.id ? '#fff' : '#374151',
                border: 'none', borderRadius: '6px', fontWeight: '500',
              }}
            >
              {t.team_name}
            </button>
          ))}
        </div>
      )}

      {/* Picks table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
              {viewMode === 'round' && (
                <th style={{ padding: '8px 12px', fontWeight: '600', color: '#374151' }}>Pick</th>
              )}
              <th style={{ padding: '8px 12px', fontWeight: '600', color: '#374151' }}>Team</th>
              <th style={{ padding: '8px 12px', fontWeight: '600', color: '#374151' }}>Manager</th>
              <th style={{ padding: '8px 12px', fontWeight: '600', color: '#374151' }}>Player</th>
              {isAuction && (
                <th style={{ padding: '8px 12px', fontWeight: '600', color: '#374151', textAlign: 'center' }}>Bid</th>
              )}
              <th style={{ padding: '8px 12px', fontWeight: '600', color: '#374151', textAlign: 'center' }}>Notes</th>
            </tr>
          </thead>
          <tbody>
            {filteredPicks.map((p) => {
              const team = p.external_team_id ? teamByExtId.get(p.external_team_id) : null;
              const managerName = team ? (managers.get(team.id) ?? 'Unknown') : 'Unknown';
              return (
                <tr key={p.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  {viewMode === 'round' && (
                    <td style={{ padding: '8px 12px', fontWeight: '500' }}>
                      {p.overall_pick_number}
                      {p.round_pick_number && (
                        <span style={{ color: '#9ca3af', fontSize: '12px', marginLeft: '4px' }}>
                          ({p.round_pick_number})
                        </span>
                      )}
                    </td>
                  )}
                  <td style={{ padding: '8px 12px' }}>
                    {team?.team_name ?? `Team ${p.external_team_id ?? '?'}`}
                    {team?.team_abbrev && (
                      <span style={{ color: '#9ca3af', fontSize: '12px', marginLeft: '4px' }}>
                        ({team.team_abbrev})
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '8px 12px', color: '#6b7280' }}>{managerName}</td>
                  <td style={{ padding: '8px 12px' }}>
                    {p.player_name ? (
                      p.player_name
                    ) : (
                      <span style={{ color: '#9ca3af', fontStyle: 'italic' }}>
                        ESPN ID: {p.external_player_id || 'Unknown'}
                      </span>
                    )}
                  </td>
                  {isAuction && (
                    <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                      {p.auction_bid_amount != null ? `$${p.auction_bid_amount}` : '-'}
                    </td>
                  )}
                  <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                    {p.is_keeper && (
                      <span style={{
                        padding: '2px 8px', background: '#fef3c7', border: '1px solid #fcd34d',
                        borderRadius: '4px', fontSize: '12px', color: '#92400e',
                      }}>
                        Keeper
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {filteredPicks.length === 0 && (
        <div style={{ padding: '20px', color: '#6b7280', fontSize: '14px' }}>
          No picks in this view.
        </div>
      )}
    </div>
  );
}

function ViewToggle({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '8px 16px', fontSize: '13px', cursor: 'pointer',
        background: active ? '#2563eb' : 'transparent',
        color: active ? '#fff' : '#374151',
        border: active ? '1px solid #2563eb' : '1px solid #d1d5db',
        borderRadius: '8px', fontWeight: '500',
      }}
    >
      {children}
    </button>
  );
}
