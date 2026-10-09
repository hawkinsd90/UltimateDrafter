import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { Database } from '../../types/supabase';

type LeagueMember = Database['public']['Tables']['league_members']['Row'];

interface HistoricalManager {
  id: string;
  display_name: string;
  linked_user_id: string | null;
  is_active: boolean;
  notes: string | null;
}

interface ManagerAlias {
  id: string;
  manager_id: string;
  provider: string;
  external_owner_id: string;
  display_name: string | null;
  match_method: string;
  first_season: number | null;
  last_season: number | null;
}

interface TeamManagerRow {
  id: string;
  season_team_id: string;
  manager_id: string;
  role: string;
  team_name: string;
  season_year: number;
}

interface ManagerPanelProps {
  leagueId: string;
  isOwner: boolean;
  espnExternalLeagueId: string | null;
}

export default function HistoricalManagerPanel({ leagueId, isOwner, espnExternalLeagueId }: ManagerPanelProps) {
  const [managers, setManagers] = useState<HistoricalManager[]>([]);
  const [aliases, setAliases] = useState<Map<string, ManagerAlias[]>>(new Map());
  const [teamManagers, setTeamManagers] = useState<Map<string, TeamManagerRow[]>>(new Map());
  const [leagueMembers, setLeagueMembers] = useState<LeagueMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedMgr, setExpandedMgr] = useState<string | null>(null);
  const [editingMgr, setEditingMgr] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [mergeTarget, setMergeTarget] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<{ success: boolean; message: string } | null>(null);
  const [acting, setActing] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [mgrRes, aliasRes, tmRes, membersRes] = await Promise.all([
        supabase
          .from('league_history_managers')
          .select('id, display_name, linked_user_id, is_active, notes')
          .eq('league_id', leagueId)
          .order('display_name', { ascending: true }),
        supabase
          .from('league_history_manager_aliases')
          .select('id, manager_id, provider, external_owner_id, display_name, match_method, first_season, last_season'),
        supabase
          .from('league_history_team_managers')
          .select('id, season_team_id, manager_id, role'),
        supabase
          .from('league_members')
          .select('*')
          .eq('league_id', leagueId),
      ]);

      const mgrList = (mgrRes.data ?? []) as unknown as HistoricalManager[];
      setManagers(mgrList);

      // Group aliases by manager_id
      const aliasMap = new Map<string, ManagerAlias[]>();
      for (const a of (aliasRes.data ?? []) as unknown as ManagerAlias[]) {
        const existing = aliasMap.get(a.manager_id) ?? [];
        existing.push(a);
        aliasMap.set(a.manager_id, existing);
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      setAliases(aliasMap);

      // Need season team info to show team names and years
      const tmRows = (tmRes.data ?? []) as unknown as { id: string; season_team_id: string; manager_id: string; role: string }[];
      const seasonTeamIds = tmRows.map((t) => t.season_team_id);
      let teamInfoMap = new Map<string, { team_name: string; season_year: number }>();
      if (seasonTeamIds.length > 0) {
        const { data: stData } = await supabase
          .from('league_history_season_teams')
          .select('id, team_name, season_id')
          .in('id', seasonTeamIds);
        const seasonIds = (stData ?? []).map((st) => (st as Record<string, unknown>).season_id as string);
        let seasonYearMap = new Map<string, number>();
        if (seasonIds.length > 0) {
          const { data: sData } = await supabase
            .from('league_history_seasons')
            .select('id, season_year')
            .in('id', seasonIds);
          for (const s of (sData ?? []) as { id: string; season_year: number }[]) {
            seasonYearMap.set(s.id, s.season_year);
          }
        }
        for (const st of (stData ?? []) as { id: string; team_name: string; season_id: string }[]) {
          teamInfoMap.set(st.id, { team_name: st.team_name, season_year: seasonYearMap.get(st.season_id) ?? 0 });
        }
      }

      const tmMap = new Map<string, TeamManagerRow[]>();
      for (const tm of tmRows) {
        const info = teamInfoMap.get(tm.season_team_id);
        const row: TeamManagerRow = {
          id: tm.id,
          season_team_id: tm.season_team_id,
          manager_id: tm.manager_id,
          role: tm.role,
          team_name: info?.team_name ?? 'Unknown',
          season_year: info?.season_year ?? 0,
        };
        const existing = tmMap.get(tm.manager_id) ?? [];
        existing.push(row);
        tmMap.set(tm.manager_id, existing);
      }
      setTeamManagers(tmMap);

      setLeagueMembers((membersRes.data ?? []) as LeagueMember[]);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [leagueId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function callManagerAction(action: string, payload: Record<string, unknown>) {
    if (!espnExternalLeagueId) return;
    setActing(true);
    setActionResult(null);
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) {
        setActionResult({ success: false, message: 'Authentication required.' });
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
        body: JSON.stringify({ action, leagueId, ...payload }),
      });
      const data = await response.json();
      if (!response.ok || data.success === false) {
        setActionResult({ success: false, message: data.error || 'Action failed.' });
      } else {
        setActionResult({ success: true, message: 'Success.' });
        await loadData();
        setEditingMgr(null);
        setMergeTarget(null);
      }
    } catch (err) {
      setActionResult({
        success: false,
        message: err instanceof Error ? err.message : 'Network error.',
      });
    } finally {
      setActing(false);
    }
  }

  if (loading) {
    return <div style={{ padding: '20px', color: '#6b7280' }}>Loading managers...</div>;
  }

  if (managers.length === 0) {
    return (
      <div style={{ padding: '20px', color: '#6b7280', fontSize: '14px' }}>
        No historical managers found. Import a season first.
      </div>
    );
  }

  return (
    <div>
      <h3 style={{ margin: '0 0 16px 0', fontSize: '16px', fontWeight: '600' }}>
        Historical Managers
      </h3>
      <p style={{ margin: '0 0 20px 0', fontSize: '13px', color: '#6b7280' }}>
        {managers.length} managers across all imported seasons. Click a manager to see their teams, aliases, and identity controls.
      </p>

      {actionResult && (
        <div style={{
          padding: '10px 14px', marginBottom: '16px', borderRadius: '8px', fontSize: '13px',
          background: actionResult.success ? '#f0fdf4' : '#fef2f2',
          border: `1px solid ${actionResult.success ? '#86efac' : '#fca5a5'}`,
          color: actionResult.success ? '#166534' : '#991b1b',
        }}>
          {actionResult.message}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {managers.map((m) => {
          const isExpanded = expandedMgr === m.id;
          const isEditing = editingMgr === m.id;
          const mgrAliases = aliases.get(m.id) ?? [];
          const mgrTeams = teamManagers.get(m.id) ?? [];
          const linkedMember = leagueMembers.find((lm) => lm.user_id === m.linked_user_id);

          return (
            <div
              key={m.id}
              style={{ border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden' }}
            >
              {/* Manager header row */}
              <button
                onClick={() => setExpandedMgr(isExpanded ? null : m.id)}
                style={{
                  width: '100%', padding: '12px 16px', cursor: 'pointer',
                  background: isExpanded ? '#f9fafb' : 'transparent',
                  border: 'none', textAlign: 'left', display: 'flex',
                  justifyContent: 'space-between', alignItems: 'center',
                }}
              >
                <div>
                  <span style={{ fontSize: '14px', fontWeight: '600', color: '#374151' }}>
                    {m.display_name}
                  </span>
                  {mgrAliases.length > 0 && (
                    <span style={{ fontSize: '12px', color: '#9ca3af', marginLeft: '8px' }}>
                      {mgrAliases.length} alias{mgrAliases.length !== 1 ? 'es' : ''}
                    </span>
                  )}
                  {mgrTeams.length > 0 && (
                    <span style={{ fontSize: '12px', color: '#9ca3af', marginLeft: '8px' }}>
                      {mgrTeams.length} team{mgrTeams.length !== 1 ? 's' : ''}
                    </span>
                  )}
                  {linkedMember && (
                    <span style={{
                      fontSize: '12px', marginLeft: '8px', padding: '2px 6px',
                      background: '#dbeafe', borderRadius: '4px', color: '#1e40af',
                    }}>
                      Linked
                    </span>
                  )}
                </div>
                <span style={{ fontSize: '12px', color: '#9ca3af' }}>
                  {isExpanded ? 'Collapse' : 'Expand'}
                </span>
              </button>

              {/* Expanded details */}
              {isExpanded && (
                <div style={{ padding: '16px', borderTop: '1px solid #e5e7eb' }}>
                  {/* Aliases */}
                  {mgrAliases.length > 0 && (
                    <div style={{ marginBottom: '16px' }}>
                      <div style={{ fontSize: '13px', fontWeight: '600', color: '#374151', marginBottom: '8px' }}>
                        ESPN Owner IDs
                      </div>
                      {mgrAliases.map((a) => (
                        <div key={a.id} style={{ fontSize: '13px', color: '#6b7280', marginBottom: '4px' }}>
                          <code style={{ background: '#f3f4f6', padding: '2px 6px', borderRadius: '4px' }}>
                            {a.external_owner_id}
                          </code>
                          {a.display_name && ` (${a.display_name})`}
                          {a.first_season && ` — ${a.first_season}${a.last_season ? `–${a.last_season}` : ''}`}
                          <span style={{ fontSize: '11px', color: '#9ca3af', marginLeft: '6px' }}>
                            [{a.match_method}]
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Teams */}
                  {mgrTeams.length > 0 && (
                    <div style={{ marginBottom: '16px' }}>
                      <div style={{ fontSize: '13px', fontWeight: '600', color: '#374151', marginBottom: '8px' }}>
                        Historical Teams
                      </div>
                      {mgrTeams
                        .sort((a, b) => b.season_year - a.season_year)
                        .map((tm) => (
                          <div key={tm.id} style={{ fontSize: '13px', color: '#6b7280', marginBottom: '4px' }}>
                            {tm.season_year}: {tm.team_name}
                            <span style={{
                              fontSize: '11px', marginLeft: '6px', padding: '1px 5px',
                              borderRadius: '3px',
                              background: tm.role === 'primary' ? '#dbeafe' : '#f3f4f6',
                              color: tm.role === 'primary' ? '#1e40af' : '#6b7280',
                            }}>
                              {tm.role}
                            </span>
                          </div>
                        ))}
                    </div>
                  )}

                  {/* Owner-only controls */}
                  {isOwner && (
                    <div style={{ borderTop: '1px solid #f3f4f6', paddingTop: '12px' }}>
                      {/* Rename */}
                      {isEditing ? (
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
                          <input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            style={{
                              padding: '6px 10px', border: '1px solid #d1d5db',
                              borderRadius: '6px', fontSize: '13px', flex: '1',
                            }}
                          />
                          <button
                            onClick={() => callManagerAction('rename_manager', { managerId: m.id, displayName: editName })}
                            disabled={acting || !editName.trim()}
                            style={{
                              padding: '6px 14px', fontSize: '13px', fontWeight: '500',
                              background: acting || !editName.trim() ? '#9ca3af' : '#2563eb',
                              color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer',
                            }}
                          >
                            Save
                          </button>
                          <button
                            onClick={() => { setEditingMgr(null); setEditName(''); }}
                            style={{
                              padding: '6px 14px', fontSize: '13px',
                              background: 'transparent', color: '#374151',
                              border: '1px solid #d1d5db', borderRadius: '6px', cursor: 'pointer',
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setEditingMgr(m.id); setEditName(m.display_name); }}
                          style={{
                            padding: '6px 14px', fontSize: '13px', fontWeight: '500',
                            background: 'transparent', color: '#2563eb',
                            border: '1px solid #2563eb', borderRadius: '6px', cursor: 'pointer',
                            marginRight: '8px',
                          }}
                        >
                          Rename
                        </button>
                      )}

                      {/* Link to member */}
                      <select
                        value={m.linked_user_id ?? ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val) {
                            callManagerAction('link_manager', { managerId: m.id, linkedUserId: val });
                          }
                        }}
                        style={{
                          padding: '6px 10px', fontSize: '13px',
                          border: '1px solid #d1d5db', borderRadius: '6px',
                          marginRight: '8px', marginBottom: '4px',
                        }}
                      >
                        <option value="">Link to member...</option>
                        {leagueMembers.map((lm) => (
                          <option key={lm.user_id ?? ''} value={lm.user_id ?? ''}>
                            {lm.display_name ?? (lm.user_id ?? '').slice(0, 8)}
                          </option>
                        ))}
                      </select>

                      {/* Merge with another manager */}
                      {mergeTarget === m.id ? (
                        <span style={{ fontSize: '12px', color: '#6b7280' }}>
                          Select another manager to merge into this one (this one survives).
                        </span>
                      ) : (
                        <button
                          onClick={() => setMergeTarget(m.id)}
                          style={{
                            padding: '6px 14px', fontSize: '13px', fontWeight: '500',
                            background: 'transparent', color: '#dc2626',
                            border: '1px solid #dc2626', borderRadius: '6px', cursor: 'pointer',
                          }}
                        >
                          Merge into...
                        </button>
                      )}
                    </div>
                  )}

                  {/* Merge target selection */}
                  {isOwner && mergeTarget && mergeTarget !== m.id && (
                    <div style={{
                      marginTop: '8px', padding: '8px 12px', background: '#fffbeb',
                      border: '1px solid #fcd34d', borderRadius: '6px',
                      display: 'flex', gap: '8px', alignItems: 'center',
                    }}>
                      <span style={{ fontSize: '13px', color: '#92400e' }}>
                        Merge "{m.display_name}" into "{managers.find((x) => x.id === mergeTarget)?.display_name}"?
                      </span>
                      <button
                        onClick={() => callManagerAction('merge_managers', { sourceId: m.id, targetId: mergeTarget })}
                        disabled={acting}
                        style={{
                          padding: '4px 12px', fontSize: '12px', fontWeight: '500',
                          background: acting ? '#9ca3af' : '#dc2626', color: '#fff',
                          border: 'none', borderRadius: '4px', cursor: 'pointer',
                        }}
                      >
                        Confirm Merge
                      </button>
                      <button
                        onClick={() => setMergeTarget(null)}
                        style={{
                          padding: '4px 12px', fontSize: '12px',
                          background: 'transparent', color: '#374151',
                          border: '1px solid #d1d5db', borderRadius: '4px', cursor: 'pointer',
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
