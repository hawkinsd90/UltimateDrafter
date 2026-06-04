import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import type { ImportedMember } from './ImportedLeaguematesPanel';
import type { Database } from '../../types/supabase';

type LeagueMember = Database['public']['Tables']['league_members']['Row'];

interface Props {
  leagueId: string;
  userId: string;
  isOwner: boolean;
  importedMembers: ImportedMember[];
  leagueMembers: LeagueMember[];
}

interface RosterPlayer {
  id: string;
  displayName: string;
  fantasyPosition: string | null;
  teamAbbr: string | null;
  resolutionStatus: string;
  unresolved: boolean;
}

// ── Colours (matches the dark theme used in MyTeam / DraftBoard) ──────────────
const bg           = '#0f172a';
const card         = '#1e293b';
const border       = '#334155';
const textPrimary  = '#f1f5f9';
const textSecondary = '#94a3b8';
const blue         = '#3b82f6';

const POSITION_COLORS: Record<string, { bg: string; text: string }> = {
  QB:    { bg: '#7c2d12', text: '#fed7aa' },
  RB:    { bg: '#14532d', text: '#bbf7d0' },
  WR:    { bg: '#1e3a5f', text: '#bfdbfe' },
  TE:    { bg: '#3b1a5f', text: '#e9d5ff' },
  K:     { bg: '#1a2e1a', text: '#86efac' },
  DST:   { bg: '#1c1a2e', text: '#a5b4fc' },
  DEF:   { bg: '#1c1a2e', text: '#a5b4fc' },
};

function posColor(pos: string | null) {
  return POSITION_COLORS[pos ?? ''] ?? { bg: '#334155', text: '#94a3b8' };
}

export default function LeagueRosterTab({
  leagueId, userId, importedMembers, leagueMembers,
}: Props) {
  // Default to the user's own claimed team, or the first team if none claimed
  const myTeam = importedMembers.find(m => m.invitedUserId === userId) ?? null;
  const defaultMember = myTeam ?? importedMembers[0] ?? null;

  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(
    defaultMember?.id ?? null
  );
  const [players, setPlayers]     = useState<RosterPlayer[]>([]);
  const [loading, setLoading]     = useState(false);
  const [noImport, setNoImport]   = useState(false);
  const [noTeamMap, setNoTeamMap] = useState(false);
  const [fetchError, setFetchError] = useState('');

  const selectedMember = importedMembers.find(m => m.id === selectedMemberId) ?? null;

  const loadRoster = useCallback(async (member: ImportedMember) => {
    setLoading(true);
    setPlayers([]);
    setNoImport(false);
    setNoTeamMap(false);
    setFetchError('');

    // Guard: must have the fields needed to traverse the import chain
    if (!member.externalTeamId || !member.externalLeagueId) {
      setNoImport(true);
      setLoading(false);
      return;
    }

    // Step 1 — find all import links for this league
    const { data: links, error: linksErr } = await supabase
      .from('external_league_links')
      .select('id, provider, external_league_id, import_status')
      .eq('league_id', leagueId);

    if (linksErr) {
      setFetchError('Could not load import data.');
      setLoading(false);
      return;
    }

    if (!links || links.length === 0) {
      setNoImport(true);
      setLoading(false);
      return;
    }

    // Step 2 — find the link matching this member's provider + external_league_id
    const matchingLink = links.find(
      l => l.provider === member.provider && l.external_league_id === member.externalLeagueId
    );
    if (!matchingLink) {
      setNoImport(true);
      setLoading(false);
      return;
    }

    // Step 3 — find the external_league_teams row for this member's team
    const { data: teamRow, error: teamErr } = await supabase
      .from('external_league_teams')
      .select('link_id, external_team_id, mapping_status')
      .eq('link_id', matchingLink.id)
      .eq('external_team_id', member.externalTeamId)
      .maybeSingle();

    if (teamErr) {
      setFetchError('Could not load team mapping.');
      setLoading(false);
      return;
    }

    if (!teamRow) {
      setNoTeamMap(true);
      setLoading(false);
      return;
    }

    // Step 4 — load roster players for this team
    const { data: rosterRows, error: rosterErr } = await supabase
      .from('external_roster_players')
      .select('id, external_player_name, external_position, sports_player_id, resolution_status')
      .eq('link_id', teamRow.link_id)
      .eq('external_team_id', teamRow.external_team_id);

    if (rosterErr) {
      setFetchError('Could not load roster players.');
      setLoading(false);
      return;
    }

    if (!rosterRows || rosterRows.length === 0) {
      setPlayers([]);
      setLoading(false);
      return;
    }

    // Step 5 — resolve sports_player_id details
    const resolvedIds = rosterRows
      .filter(r => r.sports_player_id)
      .map(r => r.sports_player_id as string);

    const detailMap = new Map<string, { display_name: string; fantasy_position: string | null; team_abbr: string | null }>();

    if (resolvedIds.length > 0) {
      // Primary: nfl_draft_player_pool (active/fantasy-relevant players with team_abbr)
      const { data: poolRows } = await supabase
        .from('nfl_draft_player_pool')
        .select('id, display_name, fantasy_position, team_abbr')
        .in('id', resolvedIds);

      for (const sp of poolRows ?? []) {
        detailMap.set(sp.id, {
          display_name: sp.display_name,
          fantasy_position: sp.fantasy_position,
          team_abbr: sp.team_abbr,
        });
      }

      // Fallback: sports_players for any IDs not in the pool (retired, inactive, etc.)
      const missingIds = resolvedIds.filter(id => !detailMap.has(id));
      if (missingIds.length > 0) {
        const { data: spRows } = await supabase
          .from('sports_players')
          .select('id, display_name, fantasy_position, team:sports_teams(abbreviation)')
          .in('id', missingIds);

        for (const sp of spRows ?? []) {
          detailMap.set(sp.id, {
            display_name:     sp.display_name,
            fantasy_position: sp.fantasy_position,
            team_abbr:        (sp.team as unknown as { abbreviation: string | null } | null)?.abbreviation ?? null,
          });
        }
      }
    }

    const resolved: RosterPlayer[] = rosterRows.map(row => {
      const detail = row.sports_player_id ? detailMap.get(row.sports_player_id) : null;
      return {
        id:               row.id,
        displayName:      detail?.display_name ?? row.external_player_name ?? 'Unknown',
        fantasyPosition:  detail?.fantasy_position ?? row.external_position ?? null,
        teamAbbr:         detail?.team_abbr ?? null,
        resolutionStatus: row.resolution_status,
        unresolved:       !row.sports_player_id,
      };
    });

    // Sort: resolved first, then by position, then name
    resolved.sort((a, b) => {
      if (a.unresolved !== b.unresolved) return a.unresolved ? 1 : -1;
      const posOrder = ['QB', 'RB', 'WR', 'TE', 'K', 'DST', 'DEF'];
      const ai = posOrder.indexOf(a.fantasyPosition ?? '');
      const bi = posOrder.indexOf(b.fantasyPosition ?? '');
      if (ai !== bi) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      return a.displayName.localeCompare(b.displayName);
    });

    setPlayers(resolved);
    setLoading(false);
  }, [leagueId]);

  useEffect(() => {
    if (selectedMember) {
      loadRoster(selectedMember);
    }
  }, [selectedMember, loadRoster]);

  // ── Render helpers ────────────────────────────────────────────────────────────

  function memberLabel(m: ImportedMember): string {
    const claimed = leagueMembers.find(lm => lm.user_id === m.invitedUserId);
    const suffix  = m.invitedUserId === userId ? ' (you)' : claimed ? ` · ${claimed.display_name ?? claimed.phone_e164 ?? ''}` : '';
    return m.teamName + suffix;
  }

  // ── Empty / error states ──────────────────────────────────────────────────────

  if (importedMembers.length === 0) {
    return (
      <div style={{ fontFamily: 'system-ui, sans-serif', color: textPrimary, background: bg, minHeight: '40vh', padding: '32px 0' }}>
        <div style={{ background: card, border: `1px solid ${border}`, borderRadius: '10px', padding: '32px', textAlign: 'center' }}>
          <p style={{ color: textSecondary, margin: 0 }}>No imported rosters found for this league.</p>
          <p style={{ color: textSecondary, margin: '8px 0 0', fontSize: '13px' }}>
            The commissioner can import a previous season's league from the draft settings.
          </p>
        </div>
      </div>
    );
  }

  const unresolvedCount = players.filter(p => p.unresolved).length;

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', color: textPrimary, background: bg, minHeight: '40vh' }}>

      {/* Team selector */}
      {importedMembers.length > 1 && (
        <div style={{ background: card, border: `1px solid ${border}`, borderRadius: '10px', padding: '14px 16px', marginBottom: '16px' }}>
          <p style={{ margin: '0 0 10px', fontSize: '12px', fontWeight: '600', color: textSecondary, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            View Team
          </p>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {importedMembers.map(m => {
              const active = m.id === selectedMemberId;
              return (
                <button
                  key={m.id}
                  onClick={() => setSelectedMemberId(m.id)}
                  style={{
                    padding: '5px 14px', borderRadius: '9999px', fontSize: '13px', fontWeight: '600',
                    cursor: 'pointer', border: `1px solid ${active ? blue : border}`,
                    background: active ? '#1d4ed8' : 'transparent',
                    color: active ? '#fff' : textSecondary,
                    transition: 'all 0.1s',
                  }}
                >
                  {memberLabel(m)}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Roster card */}
      <div style={{ background: card, border: `1px solid ${border}`, borderRadius: '10px', overflow: 'hidden' }}>

        {/* Card header */}
        <div style={{ padding: '12px 16px', borderBottom: `1px solid ${border}`, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '14px', fontWeight: '700', color: textPrimary }}>
            {selectedMember?.teamName ?? 'Roster'}
          </span>
          {selectedMember && (
            <span style={{ fontSize: '12px', color: textSecondary }}>
              Imported from {selectedMember.provider?.toUpperCase()}
            </span>
          )}
        </div>

        {/* Loading */}
        {loading && (
          <div style={{ padding: '32px', textAlign: 'center', color: textSecondary, fontSize: '14px' }}>
            Loading roster...
          </div>
        )}

        {/* Error */}
        {!loading && fetchError && (
          <div style={{ padding: '16px', color: '#f87171', fontSize: '13px' }}>
            {fetchError}
          </div>
        )}

        {/* No import found */}
        {!loading && !fetchError && noImport && (
          <div style={{ padding: '24px 16px', textAlign: 'center', color: textSecondary, fontSize: '13px' }}>
            No import data found for this team.
            <br />
            <span style={{ fontSize: '12px' }}>The commissioner may need to run the league import for this draft.</span>
          </div>
        )}

        {/* Team not yet mapped */}
        {!loading && !fetchError && !noImport && noTeamMap && (
          <div style={{ padding: '24px 16px', textAlign: 'center', color: textSecondary, fontSize: '13px' }}>
            This team has not been mapped in the import yet.
          </div>
        )}

        {/* Empty roster */}
        {!loading && !fetchError && !noImport && !noTeamMap && players.length === 0 && (
          <div style={{ padding: '24px 16px', textAlign: 'center', color: textSecondary, fontSize: '13px' }}>
            No players found for this roster.
          </div>
        )}

        {/* Unresolved notice */}
        {!loading && unresolvedCount > 0 && (
          <div style={{ margin: '0', padding: '8px 16px', background: '#1c2840', borderBottom: `1px solid ${border}`, fontSize: '12px', color: '#93c5fd' }}>
            {unresolvedCount} player{unresolvedCount !== 1 ? 's' : ''} could not be matched to the player database and are shown with imported names.
          </div>
        )}

        {/* Player rows */}
        {!loading && !fetchError && players.length > 0 && (
          <div>
            {players.map((player, i) => {
              const col = posColor(player.fantasyPosition);
              return (
                <div
                  key={player.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '10px',
                    padding: '10px 16px',
                    borderBottom: i < players.length - 1 ? `1px solid ${border}` : 'none',
                    background: player.unresolved ? 'rgba(100,116,139,0.06)' : 'transparent',
                  }}
                >
                  {/* Position badge */}
                  <span style={{
                    minWidth: '36px', padding: '2px 5px', borderRadius: '4px',
                    fontSize: '10px', fontWeight: '700', textAlign: 'center',
                    background: col.bg, color: col.text, flexShrink: 0,
                  }}>
                    {player.fantasyPosition ?? '—'}
                  </span>

                  {/* Player info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: '600', fontSize: '14px', color: player.unresolved ? textSecondary : textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {player.displayName}
                    </div>
                    {player.teamAbbr && (
                      <div style={{ fontSize: '11px', color: textSecondary, marginTop: '1px' }}>
                        {player.teamAbbr}
                      </div>
                    )}
                  </div>

                  {/* Resolved / Unresolved badge */}
                  {player.unresolved ? (
                    <span style={{ fontSize: '10px', fontWeight: '700', padding: '2px 6px', borderRadius: '4px', background: '#292524', color: '#a8a29e', flexShrink: 0 }}>
                      Unresolved
                    </span>
                  ) : (
                    <span style={{ fontSize: '10px', fontWeight: '700', padding: '2px 6px', borderRadius: '4px', background: '#1c3340', color: '#67e8f9', flexShrink: 0 }}>
                      Imported
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}

      </div>

      {/* No selected team fallback */}
      {!selectedMember && !loading && (
        <div style={{ marginTop: '16px', background: card, border: `1px solid ${border}`, borderRadius: '10px', padding: '24px', textAlign: 'center' }}>
          <p style={{ color: textSecondary, margin: 0 }}>You are not connected to an imported team yet.</p>
          <p style={{ color: textSecondary, margin: '8px 0 0', fontSize: '13px' }}>
            Ask the league commissioner to send you an invite linked to your imported team.
          </p>
        </div>
      )}

    </div>
  );
}
