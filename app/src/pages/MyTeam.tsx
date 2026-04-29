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

interface PickedPlayer {
  pickId: string;
  pickNumber: number;
  round: number;
  pickInRound: number;
  playerId: string | null;
  displayName: string;
  fantasyPosition: string | null;
  teamAbbr: string | null;
  isKeeper: boolean;
}

interface KeptPlayer {
  id: string;
  sportsPlayerId: string;
  displayName: string;
  fantasyPosition: string | null;
  teamAbbr: string | null;
}

// ── Position grouping helpers ─────────────────────────────────────────────────

const POSITION_ORDER = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DST', 'BE', 'IR'];

function positionSortKey(pos: string | null): number {
  const idx = POSITION_ORDER.indexOf(pos ?? '');
  return idx === -1 ? 99 : idx;
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

// ── Colours (match DraftBoard) ────────────────────────────────────────────────

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
  return POSITION_COLORS[pos ?? ''] ?? { bg: '#1e293b', text: '#94a3b8' };
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function MyTeam() {
  const { draftId } = useParams<{ draftId: string }>();
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [draft, setDraft] = useState<DraftInfo | null>(null);
  const [participant, setParticipant] = useState<Participant | null>(null);
  const [picks, setPicks] = useState<PickedPlayer[]>([]);
  const [keepers, setKeepers] = useState<KeptPlayer[]>([]);
  const [rosterSettings, setRosterSettings] = useState<RosterSettings | null>(null);
  const [totalPicksMade, setTotalPicksMade] = useState(0);
  const [totalParticipants, setTotalParticipants] = useState(0);

  // For viewing other teams (owner view)
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [viewingId, setViewingId] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const effectiveParticipantId = viewingId ?? participant?.id ?? null;

  const loadPicks = useCallback(async (participantId: string, draftIdVal: string) => {
    const { data } = await supabase
      .from('draft_picks')
      .select('id, pick_number, round, pick_in_round, player_id, is_keeper, player:sports_players(display_name, fantasy_position, team:sports_teams(abbreviation))')
      .eq('draft_id', draftIdVal)
      .eq('participant_id', participantId)
      .order('pick_number', { ascending: true });

    const mapped: PickedPlayer[] = (data ?? []).map((p: any) => ({
      pickId: p.id,
      pickNumber: p.pick_number,
      round: p.round,
      pickInRound: p.pick_in_round,
      playerId: p.player_id,
      displayName: p.player?.display_name ?? 'Unknown Player',
      fantasyPosition: p.player?.fantasy_position ?? null,
      teamAbbr: p.player?.team?.abbreviation ?? null,
      isKeeper: p.is_keeper ?? false,
    }));
    setPicks(mapped);
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

    if (targetId) {
      await loadPicks(targetId, draftId);

      // Load keeper assignments for this participant
      const { data: keeperData } = await supabase
        .from('draft_keeper_assignments')
        .select('id, sports_player_id, player:sports_players(display_name, fantasy_position, team:sports_teams(abbreviation))')
        .eq('draft_id', draftId)
        .eq('participant_id', targetId);

      const mappedKeepers: KeptPlayer[] = (keeperData ?? []).map((k: any) => ({
        id: k.id,
        sportsPlayerId: k.sports_player_id,
        displayName: k.player?.display_name ?? 'Unknown Player',
        fantasyPosition: k.player?.fantasy_position ?? null,
        teamAbbr: k.player?.team?.abbreviation ?? null,
      }));
      setKeepers(mappedKeepers);
    }

    // Count total picks made in this draft
    const { count } = await supabase
      .from('draft_picks')
      .select('id', { count: 'exact', head: true })
      .eq('draft_id', draftId);
    setTotalPicksMade(count ?? 0);

    setLoading(false);
  }

  useEffect(() => {
    loadData();

    // Poll for live updates during active drafts
    pollRef.current = setInterval(async () => {
      if (!draftId) return;
      const { data } = await supabase
        .from('drafts')
        .select('id, name, status, league_id, current_pick_number, current_participant_id')
        .eq('id', draftId)
        .maybeSingle();
      if (data) setDraft(data);

      const targetId = viewingId ?? participant?.id ?? null;
      if (targetId) await loadPicks(targetId, draftId);

      const { count } = await supabase
        .from('draft_picks')
        .select('id', { count: 'exact', head: true })
        .eq('draft_id', draftId);
      setTotalPicksMade(count ?? 0);
    }, 8000);

    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [draftId, user?.id]);

  // Reload picks when viewingId changes
  useEffect(() => {
    if (!viewingId || !draftId) return;
    loadPicks(viewingId, draftId);

    supabase
      .from('draft_keeper_assignments')
      .select('id, sports_player_id, player:sports_players(display_name, fantasy_position, team:sports_teams(abbreviation))')
      .eq('draft_id', draftId)
      .eq('participant_id', viewingId)
      .then(({ data }) => {
        const mapped: KeptPlayer[] = (data ?? []).map((k: any) => ({
          id: k.id,
          sportsPlayerId: k.sports_player_id,
          displayName: k.player?.display_name ?? 'Unknown Player',
          fantasyPosition: k.player?.fantasy_position ?? null,
          teamAbbr: k.player?.team?.abbreviation ?? null,
        }));
        setKeepers(mapped);
      });
  }, [viewingId, draftId]);

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
  const totalRounds = rosterSettings
    ? (rosterSettings.roster_qb ?? 0) + (rosterSettings.roster_rb ?? 0) +
      (rosterSettings.roster_wr ?? 0) + (rosterSettings.roster_te ?? 0) +
      (rosterSettings.roster_flex ?? 0) + (rosterSettings.roster_k ?? 0) +
      (rosterSettings.roster_dst ?? 0) + (rosterSettings.bench ?? 0)
    : null;

  const currentRound = totalParticipants > 0
    ? Math.ceil(draft.current_pick_number / totalParticipants)
    : 1;

  // Sort picks by position priority
  const sortedPicks = [...picks].sort((a, b) =>
    positionSortKey(a.fantasyPosition) - positionSortKey(b.fantasyPosition)
  );

  // Slots remaining
  const pickedCount = picks.length;
  const totalSlots = totalRounds ?? 0;
  const slotsRemaining = Math.max(0, totalSlots - pickedCount);

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
          <span style={{ marginLeft: '10px', padding: '2px 10px', borderRadius: '9999px', fontSize: '12px', fontWeight: '600', background: '#14532d', color: green, border: `1px solid #16a34a` }}>
            Live
          </span>
        )}
        {draft.status === 'paused' && (
          <span style={{ marginLeft: '10px', padding: '2px 10px', borderRadius: '9999px', fontSize: '12px', fontWeight: '600', background: '#451a03', color: amber, border: `1px solid ${amber}` }}>
            Paused
          </span>
        )}
        {draft.status === 'completed' && (
          <span style={{ marginLeft: '10px', padding: '2px 10px', borderRadius: '9999px', fontSize: '12px', fontWeight: '600', background: '#1e293b', color: textSecondary, border: `1px solid ${border}` }}>
            Final
          </span>
        )}
      </p>

      {/* Team selector — all participants */}
      {participants.length > 1 && (
        <div style={{ background: card, border: `1px solid ${border}`, borderRadius: '10px', padding: '16px', marginBottom: '20px' }}>
          <p style={{ margin: '0 0 10px 0', fontSize: '13px', fontWeight: '600', color: textSecondary, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            View Team
          </p>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {participants.map(p => {
              const isMe = p.id === participant?.id;
              const active = (viewingId ?? participant?.id) === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => setViewingId(p.id)}
                  style={{
                    padding: '6px 14px',
                    borderRadius: '9999px',
                    fontSize: '13px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    border: `1px solid ${active ? blue : border}`,
                    background: active ? '#1d4ed8' : 'transparent',
                    color: active ? '#fff' : textSecondary,
                    transition: 'all 0.15s',
                  }}
                >
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
          {/* On the clock banner */}
          {isOnClock && draft.status === 'in_progress' && (
            <div style={{ background: '#052e16', border: `2px solid ${green}`, borderRadius: '10px', padding: '14px 18px', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: green, boxShadow: `0 0 8px ${green}` }} />
              <span style={{ color: green, fontWeight: '700', fontSize: '15px' }}>
                {isMyTeam ? "It's your turn to pick!" : `${viewingParticipant?.team_name} is on the clock`}
              </span>
            </div>
          )}

          {/* Stats bar */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginBottom: '20px' }}>
            <StatBox label="Picks Made" value={String(pickedCount)} />
            <StatBox label="Slots Left" value={totalSlots > 0 ? String(slotsRemaining) : '—'} highlight={slotsRemaining === 0 && totalSlots > 0} />
            <StatBox label="Draft Round" value={draft.status === 'pending' ? '—' : String(currentRound) + (totalRounds ? `/${totalRounds}` : '')} />
          </div>

          {/* Roster settings */}
          {rosterSettings && (
            <div style={{ background: card, border: `1px solid ${border}`, borderRadius: '10px', padding: '14px 16px', marginBottom: '20px' }}>
              <p style={{ margin: '0 0 10px 0', fontSize: '12px', fontWeight: '600', color: textSecondary, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Roster Format
              </p>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {slotLabel(rosterSettings).map(s => (
                  <span key={s.slot} style={{
                    padding: '3px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: '600',
                    background: '#0f172a', color: textSecondary, border: `1px solid ${border}`,
                  }}>
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

          {/* Keepers */}
          {keepers.length > 0 && (
            <div style={{ background: card, border: `1px solid ${border}`, borderRadius: '10px', padding: '16px', marginBottom: '20px' }}>
              <p style={{ margin: '0 0 12px 0', fontSize: '13px', fontWeight: '600', color: textSecondary, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Keepers ({keepers.length})
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {keepers.map(k => (
                  <PlayerRow
                    key={k.id}
                    name={k.displayName}
                    position={k.fantasyPosition}
                    team={k.teamAbbr}
                    badge="Keeper"
                    badgeColor={amber}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Drafted players */}
          <div style={{ background: card, border: `1px solid ${border}`, borderRadius: '10px', padding: '16px', marginBottom: '20px' }}>
            <p style={{ margin: '0 0 12px 0', fontSize: '13px', fontWeight: '600', color: textSecondary, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Drafted Players ({picks.length})
            </p>

            {picks.length === 0 ? (
              <p style={{ color: textSecondary, fontSize: '14px', margin: 0 }}>
                {draft.status === 'pending' ? 'Draft has not started yet.' : 'No picks made yet.'}
              </p>
            ) : (
              <>
                {/* Grouped by position */}
                {POSITION_ORDER.filter(pos =>
                  sortedPicks.some(p => (p.fantasyPosition ?? '').toUpperCase() === pos || (pos === 'BE' && p.fantasyPosition == null))
                ).map(pos => {
                  const group = sortedPicks.filter(p =>
                    pos === 'BE'
                      ? p.fantasyPosition == null
                      : (p.fantasyPosition ?? '').toUpperCase() === pos
                  );
                  if (group.length === 0) return null;
                  return (
                    <div key={pos} style={{ marginBottom: '12px' }}>
                      <p style={{ margin: '0 0 6px 0', fontSize: '11px', fontWeight: '700', color: textSecondary, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                        {pos === 'BE' ? 'Other' : pos}
                      </p>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {group.map(pick => (
                          <PlayerRow
                            key={pick.pickId}
                            name={pick.displayName}
                            position={pick.fantasyPosition}
                            team={pick.teamAbbr}
                            badge={`Rd ${pick.round}, Pk ${pick.pickInRound}`}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}

                {/* Remaining empty slots */}
                {slotsRemaining > 0 && draft.status !== 'completed' && (
                  <div style={{ marginTop: '8px', borderTop: `1px solid ${border}`, paddingTop: '12px' }}>
                    <p style={{ margin: '0 0 6px 0', fontSize: '11px', fontWeight: '700', color: textSecondary, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                      Empty Slots ({slotsRemaining})
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {Array.from({ length: slotsRemaining }).map((_, i) => (
                        <div key={i} style={{
                          padding: '10px 14px', borderRadius: '8px',
                          border: `1px dashed ${border}`, background: 'transparent',
                          display: 'flex', alignItems: 'center', gap: '10px',
                        }}>
                          <span style={{ fontSize: '12px', color: border }}>— Empty —</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Draft order context */}
          {totalParticipants > 0 && draft.status !== 'pending' && (
            <div style={{ background: card, border: `1px solid ${border}`, borderRadius: '10px', padding: '14px 16px' }}>
              <p style={{ margin: '0 0 10px 0', fontSize: '13px', fontWeight: '600', color: textSecondary, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Overall Draft Progress
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ flex: 1, height: '6px', background: '#0f172a', borderRadius: '3px', overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    width: totalSlots > 0
                      ? `${Math.min(100, (totalPicksMade / (totalSlots * totalParticipants)) * 100)}%`
                      : '0%',
                    background: green,
                    borderRadius: '3px',
                    transition: 'width 0.5s ease',
                  }} />
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

function PlayerRow({
  name, position, team, badge, badgeColor,
}: {
  name: string;
  position: string | null;
  team: string | null;
  badge?: string;
  badgeColor?: string;
}) {
  const col = posColor(position ? position.toUpperCase() : null);
  return (
    <div style={{
      padding: '10px 14px', borderRadius: '8px',
      border: `1px solid ${border}`, background: '#0f172a',
      display: 'flex', alignItems: 'center', gap: '10px',
    }}>
      {position && (
        <span style={{
          padding: '2px 8px', borderRadius: '5px', fontSize: '11px', fontWeight: '700',
          background: col.bg, color: col.text, minWidth: '36px', textAlign: 'center',
        }}>
          {position.toUpperCase()}
        </span>
      )}
      <span style={{ flex: 1, fontWeight: '600', color: textPrimary, fontSize: '14px' }}>{name}</span>
      {team && <span style={{ fontSize: '12px', color: textSecondary }}>{team}</span>}
      {badge && (
        <span style={{
          fontSize: '11px', fontWeight: '600',
          color: badgeColor ?? textSecondary,
          padding: '2px 8px', borderRadius: '9999px',
          border: `1px solid ${badgeColor ?? border}`,
        }}>
          {badge}
        </span>
      )}
    </div>
  );
}
