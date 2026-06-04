import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import type { ImportedMember } from './ImportedLeaguematesPanel';
import type { Database } from '../../types/supabase';

type LeagueMember   = Database['public']['Tables']['league_members']['Row'];
type LeagueSettings = Database['public']['Tables']['league_settings']['Row'];

interface Props {
  leagueId:       string;
  userId:         string;
  importedMembers: ImportedMember[];
  leagueMembers:  LeagueMember[];
  leagueSettings: LeagueSettings | null;
}

interface RosterPlayer {
  id:               string;
  displayName:      string;
  fantasyPosition:  string | null;
  teamAbbr:         string | null;
  resolutionStatus: string;
  unresolved:       boolean;
}

// Describes one starter or bench slot in the empty roster shell
interface RosterSlot {
  label:        string;  // e.g. "QB", "RB", "FLEX", "BN" — used for badge + color
  displayLabel: string;  // full label shown in the slot row
  section:      'starters' | 'bench';
}

const card          = '#1e293b';
const border        = '#334155';
const textPrimary   = '#f1f5f9';
const textSecondary = '#94a3b8';
const blue          = '#3b82f6';

const POSITION_COLORS: Record<string, { bg: string; text: string }> = {
  QB:   { bg: '#7c2d12', text: '#fed7aa' },
  RB:   { bg: '#14532d', text: '#bbf7d0' },
  WR:   { bg: '#1e3a5f', text: '#bfdbfe' },
  TE:   { bg: '#3b1a5f', text: '#e9d5ff' },
  FLEX: { bg: '#1e3a5f', text: '#93c5fd' },
  K:    { bg: '#1a2e1a', text: '#86efac' },
  DST:  { bg: '#1c1a2e', text: '#a5b4fc' },
  DEF:  { bg: '#1c1a2e', text: '#a5b4fc' },
  OP:   { bg: '#3b2a12', text: '#fde68a' },
  BN:   { bg: '#1e293b', text: '#64748b' },
};

function posColor(pos: string | null) {
  return POSITION_COLORS[pos ?? ''] ?? { bg: '#334155', text: '#94a3b8' };
}

function buildEmptySlots(settings: LeagueSettings | null): RosterSlot[] {
  const s = settings;
  const qb    = s?.roster_qb   ?? 1;
  const rb    = s?.roster_rb   ?? 2;
  const wr    = s?.roster_wr   ?? 2;
  const te    = s?.roster_te   ?? 1;
  const flex  = s?.roster_flex ?? 1;
  const k     = s?.roster_k    ?? 1;
  const dst   = s?.roster_dst  ?? 1;
  const op    = (s as (LeagueSettings & { roster_op?: number }) | null)?.roster_op ?? 0;
  const bench = s?.bench       ?? 6;

  const slots: RosterSlot[] = [];
  for (let i = 0; i < qb;   i++) slots.push({ label: 'QB',   displayLabel: 'QB',             section: 'starters' });
  for (let i = 0; i < rb;   i++) slots.push({ label: 'RB',   displayLabel: 'RB',             section: 'starters' });
  for (let i = 0; i < wr;   i++) slots.push({ label: 'WR',   displayLabel: 'WR',             section: 'starters' });
  for (let i = 0; i < te;   i++) slots.push({ label: 'TE',   displayLabel: 'TE',             section: 'starters' });
  for (let i = 0; i < flex; i++) slots.push({ label: 'FLEX', displayLabel: 'FLEX',           section: 'starters' });
  for (let i = 0; i < k;    i++) slots.push({ label: 'K',    displayLabel: 'K',              section: 'starters' });
  for (let i = 0; i < dst;  i++) slots.push({ label: 'DST',  displayLabel: 'DST',            section: 'starters' });
  for (let i = 0; i < op;   i++) slots.push({ label: 'OP',   displayLabel: 'SuperFlex (OP)', section: 'starters' });
  for (let i = 0; i < bench; i++) slots.push({ label: 'BN',  displayLabel: 'BN',             section: 'bench' });
  return slots;
}

export default function LeagueRosterTab({
  leagueId, userId, importedMembers, leagueMembers, leagueSettings,
}: Props) {
  // Only show teams whose owner has actually joined the league
  const joinedMembers  = importedMembers.filter(m => m.invitedUserId !== null);
  const myTeam         = joinedMembers.find(m => m.invitedUserId === userId) ?? null;
  const defaultMember  = myTeam ?? joinedMembers[0] ?? null;

  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(defaultMember?.id ?? null);
  const [players, setPlayers]       = useState<RosterPlayer[]>([]);
  const [loading, setLoading]       = useState(false);
  const [rosterEmpty, setRosterEmpty] = useState(false);   // true when no players found for any reason
  const [fetchError, setFetchError] = useState('');

  const selectedMember = joinedMembers.find(m => m.id === selectedMemberId) ?? null;

  const loadRoster = useCallback(async (member: ImportedMember) => {
    setLoading(true);
    setPlayers([]);
    setRosterEmpty(false);
    setFetchError('');

    if (!member.externalTeamId || !member.externalLeagueId) {
      setRosterEmpty(true);
      setLoading(false);
      return;
    }

    // Step 1 — find import links for this league
    const { data: links, error: linksErr } = await supabase
      .from('external_league_links')
      .select('id, provider, external_league_id, import_status')
      .eq('league_id', leagueId);

    if (linksErr) {
      setFetchError('Could not load import data.');
      setLoading(false);
      return;
    }

    // Step 2 — match by provider + external_league_id
    const matchingLink = (links ?? []).find(
      l => l.provider === member.provider && l.external_league_id === member.externalLeagueId
    );
    if (!matchingLink) {
      setRosterEmpty(true);
      setLoading(false);
      return;
    }

    // Step 3 — find the team row
    const { data: teamRow, error: teamErr } = await supabase
      .from('external_league_teams')
      .select('link_id, external_team_id, mapping_status')
      .eq('link_id', matchingLink.id)
      .eq('external_team_id', member.externalTeamId)
      .maybeSingle();

    if (teamErr) {
      setFetchError('Could not load team data.');
      setLoading(false);
      return;
    }
    if (!teamRow) {
      setRosterEmpty(true);
      setLoading(false);
      return;
    }

    // Step 4 — load roster players
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
      setRosterEmpty(true);
      setLoading(false);
      return;
    }

    // Step 5 — resolve player details
    const resolvedIds = rosterRows
      .filter(r => r.sports_player_id)
      .map(r => r.sports_player_id as string);

    const detailMap = new Map<string, { display_name: string; fantasy_position: string | null; team_abbr: string | null }>();

    if (resolvedIds.length > 0) {
      const { data: poolRows } = await supabase
        .from('nfl_draft_player_pool')
        .select('id, display_name, fantasy_position, team_abbr')
        .in('id', resolvedIds);

      for (const sp of poolRows ?? []) {
        detailMap.set(sp.id, { display_name: sp.display_name, fantasy_position: sp.fantasy_position, team_abbr: sp.team_abbr });
      }

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
    if (selectedMember) loadRoster(selectedMember);
  }, [selectedMember, loadRoster]);

  // Set default selection once joinedMembers arrive without overriding a manual pick
  useEffect(() => {
    if (!selectedMemberId && defaultMember?.id) {
      setSelectedMemberId(defaultMember.id);
    }
  }, [selectedMemberId, defaultMember?.id]);

  function memberLabel(m: ImportedMember): string {
    const claimed = leagueMembers.find(lm => lm.user_id === m.invitedUserId);
    const suffix  = m.invitedUserId === userId
      ? ' (you)'
      : claimed ? ` · ${claimed.display_name ?? claimed.phone_e164 ?? ''}` : '';
    return m.teamName + suffix;
  }

  // ── No joined members ─────────────────────────────────────────────────────────
  if (joinedMembers.length === 0) {
    return (
      <div style={{ fontFamily: 'system-ui, sans-serif', color: textPrimary }}>
        <div style={{ background: card, border: `1px solid ${border}`, borderRadius: '10px', padding: '32px', textAlign: 'center' }}>
          <p style={{ color: textSecondary, margin: 0, fontSize: '14px' }}>
            No members have claimed their imported team yet.
          </p>
          <p style={{ color: textSecondary, margin: '8px 0 0', fontSize: '13px' }}>
            Once leaguemates accept their invites, their rosters will appear here.
          </p>
        </div>
      </div>
    );
  }

  const unresolvedCount = players.filter(p => p.unresolved).length;
  const emptySlots      = buildEmptySlots(leagueSettings);
  const starterSlots    = emptySlots.filter(s => s.section === 'starters');
  const benchSlots      = emptySlots.filter(s => s.section === 'bench');

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', color: textPrimary }}>

      {/* Team selector — only when more than one joined member */}
      {joinedMembers.length > 1 && (
        <div style={{ background: card, border: `1px solid ${border}`, borderRadius: '10px', padding: '14px 16px', marginBottom: '16px' }}>
          <p style={{ margin: '0 0 10px', fontSize: '12px', fontWeight: '600', color: textSecondary, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            View Team
          </p>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {joinedMembers.map(m => {
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

        {/* Header */}
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

        {/* Fetch error */}
        {!loading && fetchError && (
          <div style={{ padding: '16px', color: '#f87171', fontSize: '13px' }}>{fetchError}</div>
        )}

        {/* Empty roster shell — shown when no players found for any reason */}
        {!loading && !fetchError && rosterEmpty && (
          <>
            {/* Notice banner */}
            <div style={{ padding: '10px 16px', background: '#172033', borderBottom: `1px solid ${border}`, fontSize: '12px', color: '#93c5fd' }}>
              No roster players have been imported for this team yet. To import rosters, the commissioner must run the full import wizard from a draft in this league (Drafts tab &rarr; draft settings &rarr; Import External League).
            </div>

            {/* Starters section */}
            <div style={{ padding: '8px 16px 2px', borderBottom: `1px solid ${border}` }}>
              <span style={{ fontSize: '10px', fontWeight: '700', color: textSecondary, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Starters
              </span>
            </div>
            {starterSlots.map((slot, i) => {
              const col = posColor(slot.label);
              return (
                <div
                  key={`starter-${i}`}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '10px',
                    padding: '9px 16px',
                    borderBottom: `1px solid ${border}`,
                    opacity: 0.55,
                  }}
                >
                  <span style={{
                    minWidth: '36px', padding: '2px 5px', borderRadius: '4px',
                    fontSize: '10px', fontWeight: '700', textAlign: 'center',
                    background: col.bg, color: col.text, flexShrink: 0,
                  }}>
                    {slot.label}
                  </span>
                  {slot.displayLabel !== slot.label ? (
                    <span style={{ fontSize: '13px', color: textSecondary }}>
                      {slot.displayLabel}
                    </span>
                  ) : (
                    <span style={{ fontSize: '13px', color: textSecondary, fontStyle: 'italic' }}>
                      — Empty —
                    </span>
                  )}
                </div>
              );
            })}

            {/* Bench section */}
            {benchSlots.length > 0 && (
              <>
                <div style={{ padding: '8px 16px 2px', borderBottom: `1px solid ${border}` }}>
                  <span style={{ fontSize: '10px', fontWeight: '700', color: textSecondary, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    Bench
                  </span>
                </div>
                {benchSlots.map((slot, i) => {
                  const col = posColor(slot.label);
                  return (
                    <div
                      key={`bench-${i}`}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '10px',
                        padding: '9px 16px',
                        borderBottom: i < benchSlots.length - 1 ? `1px solid ${border}` : 'none',
                        opacity: 0.45,
                      }}
                    >
                      <span style={{
                        minWidth: '36px', padding: '2px 5px', borderRadius: '4px',
                        fontSize: '10px', fontWeight: '700', textAlign: 'center',
                        background: col.bg, color: col.text, flexShrink: 0,
                      }}>
                        {slot.label}
                      </span>
                      <span style={{ fontSize: '13px', color: textSecondary, fontStyle: 'italic' }}>
                        — Empty —
                      </span>
                    </div>
                  );
                })}
              </>
            )}
          </>
        )}

        {/* Unresolved notice (only shown when real players exist) */}
        {!loading && !rosterEmpty && unresolvedCount > 0 && (
          <div style={{ padding: '8px 16px', background: '#1c2840', borderBottom: `1px solid ${border}`, fontSize: '12px', color: '#93c5fd' }}>
            {unresolvedCount} player{unresolvedCount !== 1 ? 's' : ''} could not be matched to the player database and are shown with their imported names.
          </div>
        )}

        {/* Imported player rows */}
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
                  <span style={{
                    minWidth: '36px', padding: '2px 5px', borderRadius: '4px',
                    fontSize: '10px', fontWeight: '700', textAlign: 'center',
                    background: col.bg, color: col.text, flexShrink: 0,
                  }}>
                    {player.fantasyPosition ?? '—'}
                  </span>
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

      {/* No selected team (user has no claimed team in this league) */}
      {!selectedMember && !loading && (
        <div style={{ marginTop: '16px', background: card, border: `1px solid ${border}`, borderRadius: '10px', padding: '24px', textAlign: 'center' }}>
          <p style={{ color: textSecondary, margin: 0, fontSize: '14px' }}>You are not connected to an imported team yet.</p>
          <p style={{ color: textSecondary, margin: '8px 0 0', fontSize: '13px' }}>
            Ask the league commissioner to send you an invite linked to your imported team.
          </p>
        </div>
      )}

    </div>
  );
}
