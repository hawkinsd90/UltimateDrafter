import { useEffect, useState, useCallback, useRef } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import UserMenu from '../components/UserMenu';

// ── Types ─────────────────────────────────────────────────────────────────────

interface DraftInfo {
  id: string;
  name: string;
  status: string;
  league_id: string;
  current_pick_number: number;
  current_participant_id: string | null;
}

interface Participant {
  id: string;
  user_id: string | null;
  team_name: string;
  draft_position: number;
}

interface RosterSettings {
  roster_qb: number | null;
  roster_rb: number | null;
  roster_wr: number | null;
  roster_te: number | null;
  roster_flex: number | null;
  roster_k: number | null;
  roster_dst: number | null;
  bench: number | null;
  draft_format: string | null;
}

interface RosterPlayer {
  id: string; // unique key (pickId, keeperId, or importedId)
  playerId: string | null;
  displayName: string;
  fantasyPosition: string | null;
  teamAbbr: string | null;
  source: 'pick' | 'keeper' | 'imported';
  badge?: string;
  pickRound?: number;
  pickInRound?: number;
  unmatched?: boolean;
}

// ── Roster slot definitions ───────────────────────────────────────────────────

interface RosterSlot {
  label: string;
  eligible: string[]; // positions that can fill this slot
}

function buildStarterSlots(s: RosterSettings): RosterSlot[] {
  const slots: RosterSlot[] = [];
  for (let i = 0; i < (s.roster_qb ?? 0); i++) slots.push({ label: 'QB', eligible: ['QB'] });
  for (let i = 0; i < (s.roster_rb ?? 0); i++) slots.push({ label: 'RB', eligible: ['RB'] });
  for (let i = 0; i < (s.roster_wr ?? 0); i++) slots.push({ label: 'WR', eligible: ['WR'] });
  for (let i = 0; i < (s.roster_te ?? 0); i++) slots.push({ label: 'TE', eligible: ['TE'] });
  for (let i = 0; i < (s.roster_flex ?? 0); i++) slots.push({ label: 'FLEX', eligible: ['RB', 'WR', 'TE'] });
  for (let i = 0; i < (s.roster_k ?? 0); i++) slots.push({ label: 'K', eligible: ['K'] });
  for (let i = 0; i < (s.roster_dst ?? 0); i++) slots.push({ label: 'D/ST', eligible: ['DST', 'DEF'] });
  return slots;
}

function canFillSlot(player: RosterPlayer, slot: RosterSlot): boolean {
  const pos = (player.fantasyPosition ?? '').toUpperCase();
  return slot.eligible.some(e => e.toUpperCase() === pos);
}

// Auto-assign players to starter slots greedily, return [starterAssignments, benchPlayers]
function assignStarters(
  players: RosterPlayer[],
  slots: RosterSlot[]
): { starters: (RosterPlayer | null)[]; bench: RosterPlayer[] } {
  const remaining = [...players];
  const starters: (RosterPlayer | null)[] = slots.map(() => null);

  // First pass: fill exact-position slots
  for (let si = 0; si < slots.length; si++) {
    const slot = slots[si];
    if (slot.label === 'FLEX' || slot.label === 'D/ST') continue;
    const idx = remaining.findIndex(p => canFillSlot(p, slot));
    if (idx !== -1) {
      starters[si] = remaining.splice(idx, 1)[0];
    }
  }

  // Second pass: fill FLEX and D/ST
  for (let si = 0; si < slots.length; si++) {
    if (starters[si]) continue;
    const slot = slots[si];
    const idx = remaining.findIndex(p => canFillSlot(p, slot));
    if (idx !== -1) {
      starters[si] = remaining.splice(idx, 1)[0];
    }
  }

  return { starters, bench: remaining };
}

// ── Colours ───────────────────────────────────────────────────────────────────

const bg = '#0f172a';
const card = '#1e293b';

const border = '#334155';
const textPrimary = '#f1f5f9';
const textSecondary = '#94a3b8';
const green = '#22c55e';
const blue = '#3b82f6';
const amber = '#f59e0b';

const POSITION_COLORS: Record<string, { bg: string; text: string }> = {
  QB:   { bg: '#7c2d12', text: '#fed7aa' },
  RB:   { bg: '#14532d', text: '#bbf7d0' },
  WR:   { bg: '#1e3a5f', text: '#bfdbfe' },
  TE:   { bg: '#3b1a5f', text: '#e9d5ff' },
  FLEX: { bg: '#1e293b', text: '#94a3b8' },
  K:    { bg: '#1a2e1a', text: '#86efac' },
  DST:  { bg: '#1c1a2e', text: '#a5b4fc' },
  DEF:  { bg: '#1c1a2e', text: '#a5b4fc' },
};

function posColor(pos: string | null) {
  return POSITION_COLORS[(pos ?? '').toUpperCase()] ?? { bg: '#1e293b', text: '#94a3b8' };
}

function slotBadgeColor(label: string) {
  const map: Record<string, { bg: string; text: string }> = {
    QB:    { bg: '#7c2d12', text: '#fed7aa' },
    RB:    { bg: '#14532d', text: '#bbf7d0' },
    WR:    { bg: '#1e3a5f', text: '#bfdbfe' },
    TE:    { bg: '#3b1a5f', text: '#e9d5ff' },
    FLEX:  { bg: '#292524', text: '#d6d3d1' },
    K:     { bg: '#1a2e1a', text: '#86efac' },
    'D/ST':{ bg: '#1c1a2e', text: '#a5b4fc' },
  };
  return map[label] ?? { bg: '#1e293b', text: '#94a3b8' };
}

function totalRosterSlots(s: RosterSettings): number {
  return (s.roster_qb ?? 0) + (s.roster_rb ?? 0) + (s.roster_wr ?? 0) +
    (s.roster_te ?? 0) + (s.roster_flex ?? 0) + (s.roster_k ?? 0) +
    (s.roster_dst ?? 0) + (s.bench ?? 0);
}

function slotLabel(settings: RosterSettings): Array<{ slot: string; count: number }> {
  return [
    { slot: 'QB', count: settings.roster_qb ?? 0 },
    { slot: 'RB', count: settings.roster_rb ?? 0 },
    { slot: 'WR', count: settings.roster_wr ?? 0 },
    { slot: 'TE', count: settings.roster_te ?? 0 },
    { slot: 'FLEX', count: settings.roster_flex ?? 0 },
    { slot: 'K', count: settings.roster_k ?? 0 },
    { slot: 'DST', count: settings.roster_dst ?? 0 },
    { slot: 'Bench', count: settings.bench ?? 0 },
  ].filter(s => s.count > 0);
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function MyTeam() {
  const { draftId } = useParams<{ draftId: string }>();
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [draft, setDraft] = useState<DraftInfo | null>(null);
  const [participant, setParticipant] = useState<Participant | null>(null);
  const [rosterPlayers, setRosterPlayers] = useState<RosterPlayer[]>([]);
  const [importedRosterBroken, setImportedRosterBroken] = useState(false);
  const [rosterSettings, setRosterSettings] = useState<RosterSettings | null>(null);
  const [totalPicksMade, setTotalPicksMade] = useState(0);
  const [totalParticipants, setTotalParticipants] = useState(0);

  // For viewing other teams
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [viewingId, setViewingId] = useState<string | null>(null);

  // Swap state: which player index (in full list) is selected for swapping
  const [swapSourceIndex, setSwapSourceIndex] = useState<number | null>(null);

  // Manual starter overrides: map from slotIndex → rosterPlayer.id
  const [starterOverrides, setStarterOverrides] = useState<Record<number, string>>({});

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const effectiveParticipantId = viewingId ?? participant?.id ?? null;

  const loadRosterPlayers = useCallback(async (participantId: string, draftIdVal: string) => {
    setImportedRosterBroken(false);

    // Load picks, keepers, and imported roster in parallel
    const [picksRes, keepersRes, linkRes] = await Promise.all([
      supabase
        .from('draft_picks')
        .select('id, pick_number, round, pick_in_round, player_id, player:sports_players(display_name, fantasy_position, team:sports_teams(abbreviation))')
        .eq('draft_id', draftIdVal)
        .eq('participant_id', participantId)
        .order('pick_number', { ascending: true }),
      supabase
        .from('draft_keeper_assignments')
        .select('id, sports_player_id, player:sports_players(display_name, fantasy_position, team:sports_teams(abbreviation))')
        .eq('draft_id', draftIdVal)
        .eq('participant_id', participantId),
      supabase
        .from('external_league_links')
        .select('id')
        .eq('draft_id', draftIdVal)
        .maybeSingle(),
    ]);

    const players: RosterPlayer[] = [];

    for (const p of picksRes.data ?? []) {
      players.push({
        id: `pick-${p.id}`,
        playerId: p.player_id,
        displayName: (p as any).player?.display_name ?? 'Unknown Player',
        fantasyPosition: (p as any).player?.fantasy_position ?? null,
        teamAbbr: (p as any).player?.team?.abbreviation ?? null,
        source: 'pick',
        pickRound: p.round,
        pickInRound: p.pick_in_round,
      });
    }

    for (const k of keepersRes.data ?? []) {
      players.push({
        id: `keeper-${k.id}`,
        playerId: k.sports_player_id,
        displayName: (k as any).player?.display_name ?? 'Unknown Player',
        fantasyPosition: (k as any).player?.fantasy_position ?? null,
        teamAbbr: (k as any).player?.team?.abbreviation ?? null,
        source: 'keeper',
        badge: 'Keeper',
      });
    }

    // Imported roster
    if (linkRes.data) {
      const { data: teamData } = await supabase
        .from('external_league_teams')
        .select('id, external_team_id')
        .eq('link_id', linkRes.data.id)
        .eq('draft_participant_id', participantId)
        .maybeSingle();

      if (teamData) {
        const { data: rosterData } = await supabase
          .from('external_roster_players')
          .select('id, external_player_name, external_position, resolution_status, player:sports_players(display_name, fantasy_position, team:sports_teams(abbreviation))')
          .eq('link_id', linkRes.data.id)
          .eq('external_team_id', teamData.external_team_id)
          .neq('resolution_status', 'skipped');

        for (const r of rosterData ?? []) {
          players.push({
            id: `imported-${r.id}`,
            playerId: null,
            displayName: (r as any).player?.display_name ?? r.external_player_name ?? 'Unknown Player',
            fantasyPosition: (r as any).player?.fantasy_position ?? r.external_position ?? null,
            teamAbbr: (r as any).player?.team?.abbreviation ?? null,
            source: 'imported',
            unmatched: r.resolution_status === 'unresolved',
          });
        }
      } else {
        // Check for broken mappings
        const { data: allMapped } = await supabase
          .from('external_league_teams')
          .select('id, draft_participant_id')
          .eq('link_id', linkRes.data.id)
          .eq('mapping_status', 'mapped');
        if ((allMapped ?? []).some((t: any) => !t.draft_participant_id)) {
          setImportedRosterBroken(true);
        }
      }
    }

    setRosterPlayers(players);
  }, []);

  async function loadData() {
    if (!draftId || !user) return;
    setLoading(true);

    const { data: draftData } = await supabase
      .from('drafts')
      .select('id, name, status, league_id, current_pick_number, current_participant_id')
      .eq('id', draftId)
      .maybeSingle();

    if (!draftData) { setError('Draft not found.'); setLoading(false); return; }
    setDraft(draftData);

    const [participantsRes, settingsRes] = await Promise.all([
      supabase
        .from('draft_participants')
        .select('id, user_id, team_name, draft_position')
        .eq('draft_id', draftId)
        .order('draft_position', { ascending: true }),
      supabase
        .from('draft_settings')
        .select('roster_qb, roster_rb, roster_wr, roster_te, roster_flex, roster_k, roster_dst, bench, draft_format')
        .eq('draft_id', draftId)
        .maybeSingle(),
    ]);

    const allParticipants: Participant[] = participantsRes.data ?? [];
    setParticipants(allParticipants);
    setTotalParticipants(allParticipants.length);

    const myPart = allParticipants.find(p => p.user_id === user.id) ?? null;
    setParticipant(myPart);

    if (settingsRes.data) setRosterSettings(settingsRes.data);

    const targetId = viewingId ?? myPart?.id ?? null;
    if (targetId) await loadRosterPlayers(targetId, draftId);

    const { count } = await supabase
      .from('draft_picks')
      .select('id', { count: 'exact', head: true })
      .eq('draft_id', draftId);
    setTotalPicksMade(count ?? 0);

    setLoading(false);
  }

  useEffect(() => {
    loadData();

    pollRef.current = setInterval(async () => {
      if (!draftId) return;
      const { data } = await supabase
        .from('drafts')
        .select('id, name, status, league_id, current_pick_number, current_participant_id')
        .eq('id', draftId)
        .maybeSingle();
      if (data) setDraft(data);

      const targetId = viewingId ?? participant?.id ?? null;
      if (targetId) await loadRosterPlayers(targetId, draftId);

      const { count } = await supabase
        .from('draft_picks')
        .select('id', { count: 'exact', head: true })
        .eq('draft_id', draftId);
      setTotalPicksMade(count ?? 0);
    }, 8000);

    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [draftId, user?.id]);

  useEffect(() => {
    if (!viewingId || !draftId) return;
    setStarterOverrides({});
    setSwapSourceIndex(null);
    loadRosterPlayers(viewingId, draftId);
  }, [viewingId, draftId]);

  // ── Roster layout computation ─────────────────────────────────────────────

  const starterSlots = rosterSettings ? buildStarterSlots(rosterSettings) : [];
  const benchCount = rosterSettings?.bench ?? 0;

  // Apply auto-assignment then override with manual swaps
  const { starters: autoStarters, bench: autoBench } = assignStarters(rosterPlayers, starterSlots);

  // Build mutable copies respecting overrides
  const starters: (RosterPlayer | null)[] = [...autoStarters];
  const bench: RosterPlayer[] = [...autoBench];

  // Apply overrides: if user has manually moved player X to slot i, enforce it
  for (const [slotIdxStr, playerId] of Object.entries(starterOverrides)) {
    const slotIdx = Number(slotIdxStr);
    const player = rosterPlayers.find(p => p.id === playerId);
    if (!player) continue;

    // Find where this player currently sits
    const currentStarterIdx = starters.findIndex(s => s?.id === playerId);
    const currentBenchIdx = bench.findIndex(b => b.id === playerId);

    const displaced = starters[slotIdx];

    if (currentStarterIdx !== -1 && currentStarterIdx !== slotIdx) {
      // Swap two starters
      starters[slotIdx] = player;
      starters[currentStarterIdx] = displaced;
    } else if (currentBenchIdx !== -1) {
      // Move from bench to starter slot
      starters[slotIdx] = player;
      bench.splice(currentBenchIdx, 1);
      if (displaced) bench.push(displaced);
    }
  }

  function handleSwap(playerId: string) {
    if (swapSourceIndex === null) return;

    const newOverrides = { ...starterOverrides };

    // Find slot of source
    const sourceSlotIdx = starters.findIndex(s => s?.id === rosterPlayers[swapSourceIndex]?.id);
    const sourcePlayer = rosterPlayers[swapSourceIndex];
    if (!sourcePlayer) { setSwapSourceIndex(null); return; }

    // Find target slot (if target is in starters)
    const targetStarterIdx = starters.findIndex(s => s?.id === playerId);
    const targetBenchIdx = bench.findIndex(b => b.id === playerId);

    if (targetStarterIdx !== -1 && sourceSlotIdx !== -1) {
      // Swap two starters
      newOverrides[targetStarterIdx] = sourcePlayer.id;
      newOverrides[sourceSlotIdx] = starters[targetStarterIdx]!.id;
    } else if (targetBenchIdx !== -1 && sourceSlotIdx !== -1) {
      // Move starter to bench → put bench player in that slot
      newOverrides[sourceSlotIdx] = playerId;
    } else if (targetStarterIdx !== -1) {
      // Source is on bench, target is in starters
      newOverrides[targetStarterIdx] = sourcePlayer.id;
    }

    setStarterOverrides(newOverrides);
    setSwapSourceIndex(null);
  }

  function startSwap(playerIndex: number) {
    setSwapSourceIndex(playerIndex === swapSourceIndex ? null : playerIndex);
  }

  const swapSourcePlayer = swapSourceIndex !== null ? rosterPlayers[swapSourceIndex] : null;

  // ── Loading / error ───────────────────────────────────────────────────────

  if (loading) return (
    <div style={{ padding: '40px', background: bg, minHeight: '100vh', color: textPrimary, fontFamily: 'system-ui, sans-serif' }}>
      Loading...
    </div>
  );

  if (error || !draft) return (
    <div style={{ padding: '40px', background: bg, minHeight: '100vh', color: '#ef4444', fontFamily: 'system-ui, sans-serif' }}>
      {error || 'Draft not found.'}
    </div>
  );

  const viewingParticipant = effectiveParticipantId
    ? participants.find(p => p.id === effectiveParticipantId) ?? null
    : null;

  const isMyTeam = viewingParticipant?.id === participant?.id;
  const isOnClock = draft.current_participant_id === effectiveParticipantId;
  const totalSlots = rosterSettings ? totalRosterSlots(rosterSettings) : 0;
  const currentRound = totalParticipants > 0 ? Math.ceil(draft.current_pick_number / totalParticipants) : 1;

  const picksCount = rosterPlayers.filter(p => p.source === 'pick').length;
  const slotsRemaining = Math.max(0, totalSlots - picksCount);

  return (
    <div style={{ padding: '24px 20px', fontFamily: 'system-ui, sans-serif', color: textPrimary, background: bg, minHeight: '100vh', maxWidth: '700px', margin: '0 auto' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <Link to={`/drafts/${draftId}`} style={{ color: blue, textDecoration: 'none', fontSize: '14px' }}>
          ← Back to Draft Board
        </Link>
        <UserMenu />
      </div>

      <h1 style={{ margin: '0 0 4px 0', fontSize: '24px', fontWeight: '700', color: textPrimary }}>
        {isMyTeam ? 'My Team' : (viewingParticipant?.team_name ?? 'Team Roster')}
      </h1>
      <p style={{ margin: '0 0 20px 0', color: textSecondary, fontSize: '14px' }}>
        {draft.name}
        {draft.status === 'in_progress' && (
          <span style={{ marginLeft: '10px', padding: '2px 10px', borderRadius: '9999px', fontSize: '12px', fontWeight: '600', background: '#14532d', color: green, border: `1px solid #16a34a` }}>Live</span>
        )}
        {draft.status === 'paused' && (
          <span style={{ marginLeft: '10px', padding: '2px 10px', borderRadius: '9999px', fontSize: '12px', fontWeight: '600', background: '#451a03', color: amber, border: `1px solid ${amber}` }}>Paused</span>
        )}
        {draft.status === 'completed' && (
          <span style={{ marginLeft: '10px', padding: '2px 10px', borderRadius: '9999px', fontSize: '12px', fontWeight: '600', background: '#1e293b', color: textSecondary, border: `1px solid ${border}` }}>Final</span>
        )}
      </p>

      {/* Team selector */}
      {participants.length > 1 && (
        <div style={{ background: card, border: `1px solid ${border}`, borderRadius: '10px', padding: '16px', marginBottom: '20px' }}>
          <p style={{ margin: '0 0 10px 0', fontSize: '13px', fontWeight: '600', color: textSecondary, textTransform: 'uppercase', letterSpacing: '0.05em' }}>View Team</p>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {participants.map(p => {
              const isMe = p.id === participant?.id;
              const active = (viewingId ?? participant?.id) === p.id;
              return (
                <button key={p.id} onClick={() => setViewingId(p.id)} style={{
                  padding: '6px 14px', borderRadius: '9999px', fontSize: '13px', fontWeight: '600',
                  cursor: 'pointer', border: `1px solid ${active ? blue : border}`,
                  background: active ? '#1d4ed8' : 'transparent', color: active ? '#fff' : textSecondary,
                  transition: 'all 0.15s',
                }}>
                  {p.team_name}{isMe ? ' (you)' : ''}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {!effectiveParticipantId ? (
        <div style={{ background: card, border: `1px solid ${border}`, borderRadius: '10px', padding: '24px', textAlign: 'center' }}>
          <p style={{ color: textSecondary, margin: 0 }}>You are not a participant in this draft.</p>
        </div>
      ) : (
        <>
          {/* On the clock */}
          {isOnClock && draft.status === 'in_progress' && (
            <div style={{ background: '#052e16', border: `2px solid ${green}`, borderRadius: '10px', padding: '14px 18px', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: green, boxShadow: `0 0 8px ${green}` }} />
              <span style={{ color: green, fontWeight: '700', fontSize: '15px' }}>
                {isMyTeam ? "It's your turn to pick!" : `${viewingParticipant?.team_name} is on the clock`}
              </span>
            </div>
          )}

          {/* Stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginBottom: '20px' }}>
            <StatBox label="Picks Made" value={String(picksCount)} />
            <StatBox label="Slots Left" value={totalSlots > 0 ? String(slotsRemaining) : '—'} highlight={slotsRemaining === 0 && totalSlots > 0} />
            <StatBox label="Draft Round" value={draft.status === 'pending' ? '—' : `${currentRound}${totalSlots ? `/${totalSlots}` : ''}`} />
          </div>

          {/* Roster format */}
          {rosterSettings && (
            <div style={{ background: card, border: `1px solid ${border}`, borderRadius: '10px', padding: '14px 16px', marginBottom: '20px' }}>
              <p style={{ margin: '0 0 10px 0', fontSize: '12px', fontWeight: '600', color: textSecondary, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Roster Format</p>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {slotLabel(rosterSettings).map(s => (
                  <span key={s.slot} style={{ padding: '3px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: '600', background: '#0f172a', color: textSecondary, border: `1px solid ${border}` }}>
                    {s.count} {s.slot}
                  </span>
                ))}
                {rosterSettings.draft_format && (
                  <span style={{ marginLeft: 'auto', padding: '3px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: '600', background: '#0f172a', color: textSecondary, border: `1px solid ${border}` }}>
                    {rosterSettings.draft_format === 'snake' ? 'Snake' : 'Linear'}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Broken mapping warning */}
          {importedRosterBroken && (
            <div style={{ background: '#451a03', border: `1px solid #92400e`, borderRadius: '10px', padding: '16px', marginBottom: '20px' }}>
              <p style={{ margin: '0 0 6px 0', fontSize: '13px', fontWeight: '700', color: amber, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Imported Roster Not Linked</p>
              <p style={{ margin: '0 0 10px 0', fontSize: '14px', color: '#fde68a', lineHeight: '1.5' }}>
                This draft has imported ESPN/Sleeper teams, but they haven't been linked to participants yet. The league owner needs to re-save the team mapping.
              </p>
              <Link to={`/drafts/${draftId}/map-teams`} style={{ display: 'inline-block', padding: '7px 14px', background: amber, color: '#111827', borderRadius: '6px', fontSize: '13px', fontWeight: '600', textDecoration: 'none' }}>
                Go to Team Mapping
              </Link>
            </div>
          )}

          {/* Swap mode hint */}
          {swapSourcePlayer && (
            <div style={{ background: '#1e3a5f', border: `1px solid ${blue}`, borderRadius: '10px', padding: '12px 16px', marginBottom: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ color: '#bfdbfe', fontSize: '14px' }}>
                Select a player to swap with <strong style={{ color: textPrimary }}>{swapSourcePlayer.displayName}</strong>
              </span>
              <button onClick={() => setSwapSourceIndex(null)} style={{ background: 'transparent', border: 'none', color: textSecondary, cursor: 'pointer', fontSize: '18px', lineHeight: 1 }}>×</button>
            </div>
          )}

          {rosterPlayers.length === 0 ? (
            <div style={{ background: card, border: `1px solid ${border}`, borderRadius: '10px', padding: '32px', textAlign: 'center' }}>
              <p style={{ color: textSecondary, margin: 0, fontSize: '14px' }}>
                {draft.status === 'pending' ? 'Draft has not started yet.' : 'No players on this roster yet.'}
              </p>
            </div>
          ) : (
            <>
              {/* ── STARTERS ── */}
              {starterSlots.length > 0 && (
                <div style={{ background: card, border: `1px solid ${border}`, borderRadius: '10px', overflow: 'hidden', marginBottom: '16px' }}>
                  <div style={{ padding: '12px 16px', borderBottom: `1px solid ${border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '13px', fontWeight: '700', color: textSecondary, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Starters</span>
                    <span style={{ fontSize: '12px', color: textSecondary }}>{starters.filter(Boolean).length} / {starterSlots.length}</span>
                  </div>
                  {starterSlots.map((slot, si) => {
                    const player = starters[si];
                    const slotColors = slotBadgeColor(slot.label);
                    const playerIndex = player ? rosterPlayers.findIndex(p => p.id === player.id) : -1;
                    const isSwapSource = swapSourcePlayer?.id === player?.id;
                    const isSwapTarget = swapSourcePlayer !== null && player !== null && player.id !== swapSourcePlayer.id;
                    const canSwap = swapSourcePlayer !== null && player !== null && canFillSlot(swapSourcePlayer, slot);

                    return (
                      <div
                        key={si}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '10px',
                          padding: '10px 16px',
                          borderBottom: si < starterSlots.length - 1 ? `1px solid ${border}` : 'none',
                          background: isSwapSource ? '#1e3a5f' : isSwapTarget && canSwap ? '#0f2b1a' : 'transparent',
                          cursor: isSwapTarget && canSwap ? 'pointer' : 'default',
                          transition: 'background 0.15s',
                        }}
                        onClick={() => {
                          if (isSwapTarget && canSwap && player) handleSwap(player.id);
                        }}
                      >
                        {/* Slot label */}
                        <span style={{
                          minWidth: '42px', padding: '3px 6px', borderRadius: '5px', fontSize: '11px', fontWeight: '700',
                          textAlign: 'center', background: slotColors.bg, color: slotColors.text,
                        }}>{slot.label}</span>

                        {player ? (
                          <>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ fontWeight: '600', fontSize: '14px', color: textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{player.displayName}</span>
                                {player.badge && (
                                  <span style={{ fontSize: '10px', fontWeight: '700', color: amber, border: `1px solid ${amber}`, borderRadius: '4px', padding: '1px 5px', whiteSpace: 'nowrap' }}>{player.badge}</span>
                                )}
                                {player.unmatched && (
                                  <span style={{ fontSize: '10px', fontWeight: '700', color: '#ef4444', border: '1px solid #ef4444', borderRadius: '4px', padding: '1px 5px', whiteSpace: 'nowrap' }}>Unmatched</span>
                                )}
                              </div>
                              <div style={{ fontSize: '12px', color: textSecondary, marginTop: '2px' }}>
                                {player.fantasyPosition && <span style={{ ...posColor(player.fantasyPosition), borderRadius: '3px', padding: '0 5px', fontSize: '11px', fontWeight: '600', marginRight: '6px', background: posColor(player.fantasyPosition).bg, color: posColor(player.fantasyPosition).text }}>{player.fantasyPosition}</span>}
                                {player.teamAbbr && <span>{player.teamAbbr}</span>}
                                {player.source === 'pick' && player.pickRound && <span style={{ marginLeft: '6px', opacity: 0.6 }}>Rd {player.pickRound}, Pk {player.pickInRound}</span>}
                              </div>
                            </div>
                            <button
                              onClick={e => { e.stopPropagation(); startSwap(playerIndex); }}
                              style={{
                                padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: '600',
                                border: `1px solid ${isSwapSource ? blue : border}`,
                                background: isSwapSource ? '#1d4ed8' : 'transparent',
                                color: isSwapSource ? '#fff' : textSecondary,
                                cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.15s',
                              }}
                            >
                              {isSwapSource ? 'Cancel' : 'Move'}
                            </button>
                          </>
                        ) : (
                          <span style={{ flex: 1, fontSize: '13px', color: border }}>— Empty —</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* ── BENCH ── */}
              {(bench.length > 0 || benchCount > 0) && (
                <div style={{ background: card, border: `1px solid ${border}`, borderRadius: '10px', overflow: 'hidden', marginBottom: '16px' }}>
                  <div style={{ padding: '12px 16px', borderBottom: `1px solid ${border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '13px', fontWeight: '700', color: textSecondary, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Bench</span>
                    <span style={{ fontSize: '12px', color: textSecondary }}>{bench.length}{benchCount > 0 ? ` / ${benchCount}` : ''}</span>
                  </div>
                  {bench.length === 0 ? (
                    <div style={{ padding: '14px 16px' }}>
                      <span style={{ fontSize: '13px', color: border }}>— Empty —</span>
                    </div>
                  ) : (
                    bench.map((player, bi) => {
                      const playerIndex = rosterPlayers.findIndex(p => p.id === player.id);
                      const isSwapSource = swapSourcePlayer?.id === player.id;
                      // Any starter slot that can accept this bench player
                      const canMoveToBench = swapSourcePlayer !== null && player.id !== swapSourcePlayer.id;
                      // If swap source is a starter and this bench player is the target
                      const swapSourceIsStarter = swapSourcePlayer ? starters.some(s => s?.id === swapSourcePlayer.id) : false;
                      const isValidBenchSwapTarget = canMoveToBench && swapSourceIsStarter;

                      return (
                        <div
                          key={player.id}
                          style={{
                            display: 'flex', alignItems: 'center', gap: '10px',
                            padding: '10px 16px',
                            borderBottom: bi < bench.length - 1 ? `1px solid ${border}` : 'none',
                            background: isSwapSource ? '#1e3a5f' : isValidBenchSwapTarget ? '#0f2b1a' : 'transparent',
                            cursor: isValidBenchSwapTarget ? 'pointer' : 'default',
                            transition: 'background 0.15s',
                          }}
                          onClick={() => { if (isValidBenchSwapTarget) handleSwap(player.id); }}
                        >
                          <span style={{ minWidth: '42px', padding: '3px 6px', borderRadius: '5px', fontSize: '11px', fontWeight: '700', textAlign: 'center', background: '#1e293b', color: textSecondary, border: `1px solid ${border}` }}>BN</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span style={{ fontWeight: '600', fontSize: '14px', color: textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{player.displayName}</span>
                              {player.badge && (
                                <span style={{ fontSize: '10px', fontWeight: '700', color: amber, border: `1px solid ${amber}`, borderRadius: '4px', padding: '1px 5px', whiteSpace: 'nowrap' }}>{player.badge}</span>
                              )}
                              {player.unmatched && (
                                <span style={{ fontSize: '10px', fontWeight: '700', color: '#ef4444', border: '1px solid #ef4444', borderRadius: '4px', padding: '1px 5px', whiteSpace: 'nowrap' }}>Unmatched</span>
                              )}
                            </div>
                            <div style={{ fontSize: '12px', color: textSecondary, marginTop: '2px' }}>
                              {player.fantasyPosition && <span style={{ borderRadius: '3px', padding: '0 5px', fontSize: '11px', fontWeight: '600', marginRight: '6px', background: posColor(player.fantasyPosition).bg, color: posColor(player.fantasyPosition).text }}>{player.fantasyPosition}</span>}
                              {player.teamAbbr && <span>{player.teamAbbr}</span>}
                              {player.source === 'pick' && player.pickRound && <span style={{ marginLeft: '6px', opacity: 0.6 }}>Rd {player.pickRound}, Pk {player.pickInRound}</span>}
                            </div>
                          </div>
                          <button
                            onClick={e => { e.stopPropagation(); startSwap(playerIndex); }}
                            style={{
                              padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: '600',
                              border: `1px solid ${isSwapSource ? blue : border}`,
                              background: isSwapSource ? '#1d4ed8' : 'transparent',
                              color: isSwapSource ? '#fff' : textSecondary,
                              cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.15s',
                            }}
                          >
                            {isSwapSource ? 'Cancel' : 'Move'}
                          </button>
                        </div>
                      );
                    })
                  )}
                  {/* Empty bench slots */}
                  {Array.from({ length: Math.max(0, benchCount - bench.length) }).map((_, i) => (
                    <div key={`empty-bench-${i}`} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 16px', borderTop: `1px solid ${border}` }}>
                      <span style={{ minWidth: '42px', padding: '3px 6px', borderRadius: '5px', fontSize: '11px', fontWeight: '700', textAlign: 'center', background: '#1e293b', color: textSecondary, border: `1px solid ${border}` }}>BN</span>
                      <span style={{ fontSize: '13px', color: border }}>— Empty —</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Overflow (more players than slots — e.g. imported roster is bigger) */}
              {(() => {
                const overflow = rosterPlayers.filter(p =>
                  !starters.some(s => s?.id === p.id) && !bench.some(b => b.id === p.id)
                );
                if (overflow.length === 0) return null;
                return (
                  <div style={{ background: card, border: `1px solid ${border}`, borderRadius: '10px', overflow: 'hidden', marginBottom: '16px' }}>
                    <div style={{ padding: '12px 16px', borderBottom: `1px solid ${border}` }}>
                      <span style={{ fontSize: '13px', fontWeight: '700', color: textSecondary, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Additional Players</span>
                    </div>
                    {overflow.map((player, oi) => {
                      const playerIndex = rosterPlayers.findIndex(p => p.id === player.id);
                      const isSwapSource = swapSourcePlayer?.id === player.id;
                      return (
                        <div key={player.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 16px', borderBottom: oi < overflow.length - 1 ? `1px solid ${border}` : 'none', background: isSwapSource ? '#1e3a5f' : 'transparent' }}>
                          <span style={{ minWidth: '42px', padding: '3px 6px', borderRadius: '5px', fontSize: '11px', fontWeight: '700', textAlign: 'center', background: '#1e293b', color: textSecondary, border: `1px solid ${border}` }}>+</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span style={{ fontWeight: '600', fontSize: '14px', color: textPrimary }}>{player.displayName}</span>
                              {player.unmatched && <span style={{ fontSize: '10px', fontWeight: '700', color: '#ef4444', border: '1px solid #ef4444', borderRadius: '4px', padding: '1px 5px' }}>Unmatched</span>}
                            </div>
                            <div style={{ fontSize: '12px', color: textSecondary, marginTop: '2px' }}>
                              {player.fantasyPosition && <span style={{ borderRadius: '3px', padding: '0 5px', fontSize: '11px', fontWeight: '600', marginRight: '6px', background: posColor(player.fantasyPosition).bg, color: posColor(player.fantasyPosition).text }}>{player.fantasyPosition}</span>}
                              {player.teamAbbr && <span>{player.teamAbbr}</span>}
                            </div>
                          </div>
                          <button onClick={e => { e.stopPropagation(); startSwap(playerIndex); }} style={{ padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: '600', border: `1px solid ${isSwapSource ? blue : border}`, background: isSwapSource ? '#1d4ed8' : 'transparent', color: isSwapSource ? '#fff' : textSecondary, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                            {isSwapSource ? 'Cancel' : 'Move'}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </>
          )}

          {/* Overall draft progress */}
          {totalParticipants > 0 && draft.status !== 'pending' && (
            <div style={{ background: card, border: `1px solid ${border}`, borderRadius: '10px', padding: '14px 16px' }}>
              <p style={{ margin: '0 0 10px 0', fontSize: '13px', fontWeight: '600', color: textSecondary, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Overall Draft Progress</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ flex: 1, height: '6px', background: '#0f172a', borderRadius: '3px', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: totalSlots > 0 ? `${Math.min(100, (totalPicksMade / (totalSlots * totalParticipants)) * 100)}%` : '0%', background: green, borderRadius: '3px', transition: 'width 0.5s ease' }} />
                </div>
                <span style={{ fontSize: '13px', color: textSecondary, whiteSpace: 'nowrap' }}>
                  {totalPicksMade} / {totalSlots * totalParticipants} picks
                </span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatBox({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div style={{ background: card, border: `1px solid ${border}`, borderRadius: '10px', padding: '14px', textAlign: 'center' }}>
      <div style={{ fontSize: '22px', fontWeight: '700', color: highlight ? green : textPrimary }}>{value}</div>
      <div style={{ fontSize: '12px', color: textSecondary, marginTop: '2px' }}>{label}</div>
    </div>
  );
}
