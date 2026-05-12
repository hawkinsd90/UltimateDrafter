import { useEffect, useState, useCallback, useRef } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import UserMenu from '../components/UserMenu';
import { usePlayerDetail } from '../hooks/draft/usePlayerDetail';
import PlayerDetailModal from '../components/draft/PlayerDetailModal';

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

type PlayerSource = 'drafted' | 'imported' | 'keeper';

interface RosterPlayer {
  pickId: string;
  pickNumber: number | null;
  round: number | null;
  pickInRound: number | null;
  playerId: string | null;
  displayName: string;
  fantasyPosition: string | null;
  teamAbbr: string | null;
  isKeeper: boolean;
  source: PlayerSource;
  unresolved?: boolean;
}

// ── Slot building ─────────────────────────────────────────────────────────────

interface RosterSlot {
  slotLabel: string;
  slotType: 'QB' | 'RB' | 'WR' | 'TE' | 'FLEX' | 'K' | 'DST' | 'Bench';
  player: RosterPlayer | null;
}

const FLEX_ELIGIBLE = ['RB', 'WR', 'TE'];

function buildRoster(players: RosterPlayer[], settings: RosterSettings | null): RosterSlot[] {
  if (!settings) {
    return players.map((p, i) => ({ slotLabel: `BN ${i + 1}`, slotType: 'Bench', player: p }));
  }

  const slots: RosterSlot[] = [];
  const used = new Set<string>();

  const add = (type: RosterSlot['slotType'], count: number, eligible: string[]) => {
    for (let i = 0; i < count; i++) {
      const label = count > 1 ? `${type} ${i + 1}` : type;
      const player = players.find(p => !used.has(p.pickId) && eligible.includes(p.fantasyPosition ?? '')) ?? null;
      if (player) used.add(player.pickId);
      slots.push({ slotLabel: label, slotType: type, player });
    }
  };

  add('QB',   settings.roster_qb   ?? 0, ['QB']);
  add('RB',   settings.roster_rb   ?? 0, ['RB']);
  add('WR',   settings.roster_wr   ?? 0, ['WR']);
  add('TE',   settings.roster_te   ?? 0, ['TE']);
  add('FLEX', settings.roster_flex ?? 0, FLEX_ELIGIBLE);
  add('K',    settings.roster_k    ?? 0, ['K']);
  add('DST',  settings.roster_dst  ?? 0, ['DST', 'DEF']);

  const benchCount = settings.bench ?? 0;
  const remaining  = players.filter(p => !used.has(p.pickId));
  for (let i = 0; i < Math.max(benchCount, remaining.length); i++) {
    slots.push({ slotLabel: 'BN', slotType: 'Bench', player: remaining[i] ?? null });
  }

  return slots;
}

// ── Colours ───────────────────────────────────────────────────────────────────

const bg          = '#0f172a';
const card        = '#1e293b';
const border      = '#334155';
const textPrimary = '#f1f5f9';
const textSecondary = '#94a3b8';
const green       = '#22c55e';
const blue        = '#3b82f6';
const amber       = '#f59e0b';

const SLOT_COLORS: Record<string, { bg: string; text: string }> = {
  QB:    { bg: '#7c2d12', text: '#fed7aa' },
  RB:    { bg: '#14532d', text: '#bbf7d0' },
  WR:    { bg: '#1e3a5f', text: '#bfdbfe' },
  TE:    { bg: '#3b1a5f', text: '#e9d5ff' },
  FLEX:  { bg: '#1e293b', text: '#94a3b8' },
  K:     { bg: '#1a2e1a', text: '#86efac' },
  DST:   { bg: '#1c1a2e', text: '#a5b4fc' },
  Bench: { bg: '#1e293b', text: '#64748b' },
};

function slotColor(type: string) {
  return SLOT_COLORS[type] ?? { bg: '#1e293b', text: '#94a3b8' };
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function MyTeam() {
  const { draftId } = useParams<{ draftId: string }>();
  const { user } = useAuth();

  const [loading, setLoading]                 = useState(true);
  const [error, setError]                     = useState('');
  const [draft, setDraft]                     = useState<DraftInfo | null>(null);
  const [participant, setParticipant]         = useState<Participant | null>(null);
  const [players, setPlayers]                 = useState<RosterPlayer[]>([]);
  const [rosterSettings, setRosterSettings]   = useState<RosterSettings | null>(null);
  const [totalPicksMade, setTotalPicksMade]   = useState(0);
  const [totalParticipants, setTotalParticipants] = useState(0);
  const [participants, setParticipants]       = useState<Participant[]>([]);
  const [viewingId, setViewingId]             = useState<string | null>(null);
  const [draftScoringRuleId, setDraftScoringRuleId] = useState<string | null>(null);

  // Player detail panel — passes scoring rule so Last Season rankings show in the profile
  const playerDetail = usePlayerDetail(draftId!, user?.id, draftScoringRuleId);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const viewingIdRef = useRef<string | null>(viewingId);
  const participantRef = useRef<Participant | null>(participant);
  viewingIdRef.current = viewingId;
  participantRef.current = participant;

  const effectiveParticipantId = viewingId ?? participant?.id ?? null;

  // Load the unified roster: draft picks + imported roster players, deduplicated by sports_player_id.
  // Drafted players take precedence if both sources contain the same player.
  const loadRoster = useCallback(async (participantId: string, draftIdVal: string) => {
    // 1. Draft picks for this participant
    const { data: picksData } = await supabase
      .from('draft_picks')
      .select('id, pick_number, round, pick_in_round, player_id, player:sports_players(display_name, fantasy_position, team:sports_teams(abbreviation))')
      .eq('draft_id', draftIdVal)
      .eq('participant_id', participantId)
      .not('player_id', 'is', null)
      .order('pick_number', { ascending: true });

    const draftedPlayers: RosterPlayer[] = (picksData ?? []).map((p: any) => ({
      pickId:        p.id,
      pickNumber:    p.pick_number,
      round:         p.round,
      pickInRound:   p.pick_in_round,
      playerId:      p.player_id,
      displayName:   p.player?.display_name ?? 'Unknown Player',
      fantasyPosition: p.player?.fantasy_position ?? null,
      teamAbbr:      p.player?.team?.abbreviation ?? null,
      isKeeper:      false,
      source:        'drafted' as PlayerSource,
    }));

    const draftedIds = new Set(draftedPlayers.map(p => p.playerId).filter(Boolean) as string[]);

    // 2. Imported roster players — two flat queries because external_roster_players
    //    has no direct FK to external_league_teams (only composite link_id+external_team_id),
    //    so Supabase nested selects cannot traverse this relationship.

    // Step 2a: find the (link_id, external_team_id) pairs mapped to this participant
    const { data: mappedTeams } = await supabase
      .from('external_league_teams')
      .select('link_id, external_team_id')
      .eq('draft_participant_id', participantId)
      .eq('mapping_status', 'mapped');

    const importedPlayers: RosterPlayer[] = [];

    if (mappedTeams && mappedTeams.length > 0) {
      // Step 2b: fetch roster players for each mapped (link_id, external_team_id) pair
      // and verify the link belongs to this draft via external_league_links
      const { data: linkRows } = await supabase
        .from('external_league_links')
        .select('id')
        .eq('draft_id', draftIdVal);

      const validLinkIds = new Set((linkRows ?? []).map((l: any) => l.id as string));

      for (const team of mappedTeams) {
        if (!validLinkIds.has(team.link_id)) continue;

        const { data: rosterRows } = await supabase
          .from('external_roster_players')
          .select('external_player_name, external_position, sports_player_id, resolution_status')
          .eq('link_id', team.link_id)
          .eq('external_team_id', team.external_team_id);

        if (!rosterRows || rosterRows.length === 0) continue;

        // Step 2c: fetch sports_player details for resolved rows in bulk.
        // Primary source: nfl_draft_player_pool (enriched view with team_abbr).
        // Fallback: sports_players directly for any IDs the pool excludes (e.g. retired/inactive players
        // that are fantasy_relevant but filtered out of the pool view).
        const resolvedIds = rosterRows
          .filter(r => r.sports_player_id)
          .map(r => r.sports_player_id as string);

        const playerDetailMap = new Map<string, { display_name: string; fantasy_position: string | null; team_abbr: string | null }>();
        if (resolvedIds.length > 0) {
          const { data: poolRows } = await supabase
            .from('nfl_draft_player_pool')
            .select('id, display_name, fantasy_position, team_abbr')
            .in('id', resolvedIds);
          for (const sp of poolRows ?? []) {
            playerDetailMap.set(sp.id, { display_name: sp.display_name, fantasy_position: sp.fantasy_position, team_abbr: sp.team_abbr });
          }

          // Fall back to sports_players for any IDs the pool view excluded
          const missingIds = resolvedIds.filter(id => !playerDetailMap.has(id));
          if (missingIds.length > 0) {
            const { data: spRows } = await supabase
              .from('sports_players')
              .select('id, display_name, fantasy_position, team:sports_teams(abbreviation)')
              .in('id', missingIds);
            for (const sp of spRows ?? []) {
              playerDetailMap.set(sp.id, {
                display_name:    sp.display_name,
                fantasy_position: sp.fantasy_position,
                team_abbr:       (sp.team as unknown as { abbreviation: string | null } | null)?.abbreviation ?? null,
              });
            }
          }
        }

        for (const erp of rosterRows) {
          // If resolved and already drafted, skip duplicate
          if (erp.sports_player_id && draftedIds.has(erp.sports_player_id)) continue;

          const sp = erp.sports_player_id ? playerDetailMap.get(erp.sports_player_id) : null;
          importedPlayers.push({
            pickId:          `imported-${team.link_id}-${erp.sports_player_id ?? erp.external_player_name}`,
            pickNumber:      null,
            round:           null,
            pickInRound:     null,
            playerId:        erp.sports_player_id ?? null,
            displayName:     sp?.display_name ?? erp.external_player_name ?? 'Unknown',
            fantasyPosition: sp?.fantasy_position ?? erp.external_position ?? null,
            teamAbbr:        sp?.team_abbr ?? null,
            isKeeper:        false,
            source:          'imported' as PlayerSource,
            unresolved:      !erp.sports_player_id,
          });
        }
      }
    }

    // Drafted first (in pick order), then imported
    setPlayers([...draftedPlayers, ...importedPlayers]);
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

    const [participantsRes, settingsRes, scoringRuleRes] = await Promise.all([
      supabase.from('draft_participants').select('id, user_id, team_name, draft_position').eq('draft_id', draftId).order('draft_position', { ascending: true }),
      supabase.from('draft_settings').select('roster_qb, roster_rb, roster_wr, roster_te, roster_flex, roster_k, roster_dst, bench, draft_format').eq('draft_id', draftId).maybeSingle(),
      supabase.from('draft_scoring_rules').select('id').eq('draft_id', draftId).maybeSingle(),
    ]);
    setDraftScoringRuleId(scoringRuleRes.data?.id ?? null);

    const allParticipants: Participant[] = participantsRes.data ?? [];
    setParticipants(allParticipants);
    setTotalParticipants(allParticipants.length);

    const myPart = allParticipants.find(p => p.user_id === user.id) ?? null;
    setParticipant(myPart);
    if (settingsRes.data) setRosterSettings(settingsRes.data);

    const targetId = viewingId ?? myPart?.id ?? null;
    if (targetId) await loadRoster(targetId, draftId);

    const { count } = await supabase.from('draft_picks').select('id', { count: 'exact', head: true }).eq('draft_id', draftId);
    setTotalPicksMade(count ?? 0);
    setLoading(false);
  }

  useEffect(() => {
    loadData();

    pollRef.current = setInterval(async () => {
      if (!draftId) return;
      const { data } = await supabase.from('drafts').select('id, name, status, league_id, current_pick_number, current_participant_id').eq('id', draftId).maybeSingle();
      if (data) setDraft(data);
      const targetId = viewingIdRef.current ?? participantRef.current?.id ?? null;
      if (targetId) await loadRoster(targetId, draftId);
      const { count } = await supabase.from('draft_picks').select('id', { count: 'exact', head: true }).eq('draft_id', draftId);
      setTotalPicksMade(count ?? 0);
    }, 8000);

    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [draftId, user?.id]);

  useEffect(() => {
    if (!viewingId || !draftId) return;
    loadRoster(viewingId, draftId);
  }, [viewingId, draftId]);

  if (loading) return (
    <div style={{ padding: '40px', background: bg, minHeight: '100vh', color: textPrimary, fontFamily: 'system-ui, sans-serif' }}>Loading...</div>
  );

  if (error || !draft) return (
    <div style={{ padding: '40px', background: bg, minHeight: '100vh', color: '#ef4444', fontFamily: 'system-ui, sans-serif' }}>{error || 'Draft not found.'}</div>
  );

  const viewingParticipant = effectiveParticipantId ? participants.find(p => p.id === effectiveParticipantId) ?? null : null;
  const isMyTeam   = viewingParticipant?.id === participant?.id;
  const isOnClock  = draft.current_participant_id === effectiveParticipantId;

  const totalSlots = rosterSettings
    ? (rosterSettings.roster_qb   ?? 0) + (rosterSettings.roster_rb  ?? 0) +
      (rosterSettings.roster_wr   ?? 0) + (rosterSettings.roster_te  ?? 0) +
      (rosterSettings.roster_flex ?? 0) + (rosterSettings.roster_k   ?? 0) +
      (rosterSettings.roster_dst  ?? 0) + (rosterSettings.bench      ?? 0)
    : null;

  const currentRound = totalParticipants > 0 ? Math.ceil(draft.current_pick_number / totalParticipants) : 1;
  const roster       = buildRoster(players, rosterSettings);
  const starters     = roster.filter(s => s.slotType !== 'Bench');
  const bench        = roster.filter(s => s.slotType === 'Bench');

  // For the stat box, count the total roster size (drafted + imported)
  const draftedCount  = players.filter(p => p.source === 'drafted').length;
  const importedCount = players.filter(p => p.source === 'imported').length;

  return (
    <div style={{ padding: '16px', fontFamily: 'system-ui, sans-serif', color: textPrimary, background: bg, minHeight: '100vh', maxWidth: '600px', margin: '0 auto' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <Link to={`/drafts/${draftId}`} style={{ color: blue, textDecoration: 'none', fontSize: '14px' }}>← Back</Link>
        <UserMenu />
      </div>

      <h1 style={{ margin: '0 0 2px', fontSize: '22px', fontWeight: '700' }}>
        {isMyTeam ? 'My Team' : (viewingParticipant?.team_name ?? 'Team Roster')}
      </h1>
      <p style={{ margin: '0 0 16px', color: textSecondary, fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}>
        {draft.name}
        {draft.status === 'in_progress' && <StatusPill color={green} bg="#14532d" border="#16a34a" label="Live" />}
        {draft.status === 'paused'      && <StatusPill color={amber} bg="#451a03" border={amber}    label="Paused" />}
        {draft.status === 'completed'   && <StatusPill color={textSecondary} bg={card} border={border} label="Final" />}
      </p>

      {/* Team selector */}
      {participants.length > 1 && (
        <div style={{ background: card, border: `1px solid ${border}`, borderRadius: '10px', padding: '12px', marginBottom: '16px' }}>
          <p style={{ margin: '0 0 8px', fontSize: '12px', fontWeight: '600', color: textSecondary, textTransform: 'uppercase', letterSpacing: '0.05em' }}>View Team</p>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {participants.map(p => {
              const active = (viewingId ?? participant?.id) === p.id;
              return (
                <button key={p.id} onClick={() => setViewingId(p.id)} style={{
                  padding: '5px 12px', borderRadius: '9999px', fontSize: '13px', fontWeight: '600', cursor: 'pointer',
                  border: `1px solid ${active ? blue : border}`,
                  background: active ? '#1d4ed8' : 'transparent',
                  color: active ? '#fff' : textSecondary,
                }}>
                  {p.team_name}{p.id === participant?.id ? ' (you)' : ''}
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
            <div style={{ background: '#052e16', border: `2px solid ${green}`, borderRadius: '10px', padding: '12px 16px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: green, boxShadow: `0 0 8px ${green}` }} />
              <span style={{ color: green, fontWeight: '700', fontSize: '14px' }}>
                {isMyTeam ? "It's your turn to pick!" : `${viewingParticipant?.team_name} is on the clock`}
              </span>
            </div>
          )}

          {/* Stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '16px' }}>
            <StatBox label="Players" value={String(players.length)} />
            <StatBox
              label="Slots Left"
              value={totalSlots ? String(Math.max(0, totalSlots - players.length)) : '—'}
              highlight={totalSlots !== null && players.length >= totalSlots}
            />
            <StatBox label="Round" value={draft.status === 'pending' ? '—' : `${currentRound}${totalSlots ? `/${totalSlots}` : ''}`} />
          </div>

          {/* Imported banner */}
          {importedCount > 0 && (
            <div style={{ background: '#0c1a2e', border: `1px solid #1e3a5f`, borderRadius: '8px', padding: '8px 12px', marginBottom: '12px', fontSize: '12px', color: '#93c5fd' }}>
              {importedCount} player{importedCount !== 1 ? 's' : ''} imported from previous season roster
              {draftedCount > 0 ? `, ${draftedCount} drafted this season` : ''}
            </div>
          )}

          {/* Starters */}
          <div style={{ background: card, border: `1px solid ${border}`, borderRadius: '10px', overflow: 'hidden', marginBottom: '12px' }}>
            <div style={{ padding: '10px 14px', borderBottom: `1px solid ${border}` }}>
              <span style={{ fontSize: '12px', fontWeight: '700', color: textSecondary, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Starters
              </span>
            </div>
            {starters.length === 0 ? (
              <p style={{ padding: '16px 14px', color: textSecondary, fontSize: '13px', margin: 0 }}>
                {draft.status === 'pending' ? 'Draft has not started.' : 'No starters yet.'}
              </p>
            ) : (
              starters.map((slot, i) => <SlotRow key={i} slot={slot} onOpenDetail={playerDetail.openPlayerDetail} />)
            )}
          </div>

          {/* Bench */}
          {bench.length > 0 && (
            <div style={{ background: card, border: `1px solid ${border}`, borderRadius: '10px', overflow: 'hidden', marginBottom: '16px' }}>
              <div style={{ padding: '10px 14px', borderBottom: `1px solid ${border}` }}>
                <span style={{ fontSize: '12px', fontWeight: '700', color: textSecondary, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Bench
                </span>
              </div>
              {bench.map((slot, i) => <SlotRow key={i} slot={slot} onOpenDetail={playerDetail.openPlayerDetail} />)}
            </div>
          )}

          {/* Draft progress */}
          {totalParticipants > 0 && draft.status !== 'pending' && totalSlots && (
            <div style={{ background: card, border: `1px solid ${border}`, borderRadius: '10px', padding: '12px 14px' }}>
              <p style={{ margin: '0 0 8px', fontSize: '12px', fontWeight: '600', color: textSecondary, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Overall Progress</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ flex: 1, height: '5px', background: '#0f172a', borderRadius: '3px', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.min(100, (totalPicksMade / (totalSlots * totalParticipants)) * 100)}%`, background: green, borderRadius: '3px', transition: 'width 0.5s' }} />
                </div>
                <span style={{ fontSize: '12px', color: textSecondary, whiteSpace: 'nowrap' }}>
                  {totalPicksMade} / {totalSlots * totalParticipants}
                </span>
              </div>
            </div>
          )}
        </>
      )}

      {/* Player profile panel */}
      <PlayerDetailModal
        detail={playerDetail.playerDetail}
        loading={playerDetail.detailLoading}
        isOnBoard={false}
        isPicked={playerDetail.playerDetail != null && players.find(p => p.playerId === playerDetail.playerDetail!.id)?.source === 'drafted'}
        canPick={false}
        showBoardActions={false}
        sourceBadge={
          playerDetail.playerDetail
            ? (players.find(p => p.playerId === playerDetail.playerDetail!.id)?.source === 'imported'
                ? 'Imported'
                : players.find(p => p.playerId === playerDetail.playerDetail!.id)?.source === 'drafted'
                  ? 'Drafted'
                  : null)
            : null
        }
        onAdd={() => {}}
        onRemove={() => {}}
        onPick={() => {}}
        onClose={playerDetail.closePlayerDetail}
      />
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusPill({ color, bg: bgColor, border: borderColor, label }: { color: string; bg: string; border: string; label: string }) {
  return (
    <span style={{ padding: '2px 8px', borderRadius: '9999px', fontSize: '11px', fontWeight: '600', background: bgColor, color, border: `1px solid ${borderColor}` }}>
      {label}
    </span>
  );
}

function StatBox({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div style={{ background: card, border: `1px solid ${border}`, borderRadius: '8px', padding: '12px', textAlign: 'center' }}>
      <div style={{ fontSize: '20px', fontWeight: '700', color: highlight ? green : textPrimary }}>{value}</div>
      <div style={{ fontSize: '11px', color: textSecondary, marginTop: '2px' }}>{label}</div>
    </div>
  );
}

const SOURCE_BADGE: Record<PlayerSource, { label: string; bg: string; color: string }> = {
  drafted:  { label: 'Drafted',  bg: '#1e3a8a', color: '#93c5fd' },
  imported: { label: 'Imported', bg: '#1c3340', color: '#67e8f9' },
  keeper:   { label: 'Keeper',   bg: '#3b2a0a', color: '#fcd34d' },
};

function SlotRow({ slot, onOpenDetail }: { slot: RosterSlot; onOpenDetail: (id: string) => void }) {
  const col        = slotColor(slot.slotType);
  const isEmpty    = !slot.player;
  const srcBadge   = slot.player ? SOURCE_BADGE[slot.player.source] : null;
  const unresolved = slot.player?.unresolved ?? false;
  // Only resolved players with a known sports_player_id are clickable
  const isClickable = !isEmpty && !unresolved && !!slot.player?.playerId;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '10px',
      padding: '10px 14px',
      borderBottom: `1px solid ${border}`,
      background: isEmpty ? 'transparent' : '#0f172a',
      opacity: isEmpty ? 0.6 : 1,
    }}>
      {/* Slot label */}
      <span style={{
        minWidth: '40px', padding: '2px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: '700',
        textAlign: 'center', background: col.bg, color: col.text, flexShrink: 0,
      }}>
        {slot.slotLabel}
      </span>

      {isEmpty ? (
        <span style={{ flex: 1, fontSize: '13px', color: '#475569' }}>— Empty —</span>
      ) : (
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            {isClickable ? (
              <button
                onClick={e => { e.stopPropagation(); onOpenDetail(slot.player!.playerId!); }}
                style={{
                  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                  fontWeight: '600', fontSize: '14px', color: textPrimary, textAlign: 'left',
                  textDecoration: 'underline', textDecorationColor: 'transparent',
                  transition: 'text-decoration-color 0.12s',
                }}
                onMouseEnter={e => (e.currentTarget.style.textDecorationColor = '#60a5fa')}
                onMouseLeave={e => (e.currentTarget.style.textDecorationColor = 'transparent')}
              >
                {slot.player!.displayName}
              </button>
            ) : (
              <span style={{ fontWeight: '600', fontSize: '14px', color: textPrimary }}>
                {slot.player!.displayName}
              </span>
            )}
            {srcBadge && (
              <span style={{ fontSize: '10px', fontWeight: '700', padding: '1px 5px', borderRadius: '4px', background: srcBadge.bg, color: srcBadge.color }}>
                {unresolved ? 'Unresolved' : srcBadge.label}
              </span>
            )}
          </div>
          <div style={{ fontSize: '11px', color: textSecondary, marginTop: '1px' }}>
            {slot.player!.teamAbbr && `${slot.player!.teamAbbr} · `}
            {slot.player!.fantasyPosition ?? '—'}
            {slot.player!.source === 'drafted' && slot.player!.round !== null && (
              <span style={{ marginLeft: '6px' }}>Rd {slot.player!.round}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
