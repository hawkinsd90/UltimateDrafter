import { useEffect, useState, useRef, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { Database } from '../types/supabase';
import PlayerSearch from '../components/PlayerSearch';
import { enqueueNotification } from '../utils/notifications';
import UserMenu from '../components/UserMenu';
import { useAuth } from '../contexts/AuthContext';

type Draft = Database['public']['Tables']['drafts']['Row'];
type League = Database['public']['Tables']['leagues']['Row'];
type DraftSettings = Database['public']['Tables']['draft_settings']['Row'];
type Participant = Database['public']['Tables']['draft_participants']['Row'];
type Pick = Database['public']['Tables']['draft_picks']['Row'] & {
  player?: {
    display_name: string;
    fantasy_position: string | null;
    position: string | null;
    team: { abbreviation: string | null } | null;
  } | null;
};

type FilterMode = 'all' | 'round' | 'owner';

const bg = '#0f172a';
const card = '#1e293b';
const border = '#334155';
const textPrimary = '#f1f5f9';
const textSecondary = '#94a3b8';
const green = '#22c55e';
const greenDark = '#16a34a';
const blue = '#3b82f6';
const amber = '#f59e0b';

export default function DraftBoard() {
  const { draftId } = useParams<{ draftId: string }>();
  const { user } = useAuth();

  const [draft, setDraft] = useState<Draft | null>(null);
  const [league, setLeague] = useState<League | null>(null);
  const [draftSettings, setDraftSettings] = useState<DraftSettings | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [currentParticipant, setCurrentParticipant] = useState<Participant | null>(null);
  const [showPlayerSearch, setShowPlayerSearch] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [filterRound, setFilterRound] = useState<number>(1);
  const [filterOwner, setFilterOwner] = useState<string>('');

  const participantsRef = useRef<Participant[]>([]);
  participantsRef.current = participants;
  const draftRef = useRef<Draft | null>(null);
  draftRef.current = draft;
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const reloadPicks = useCallback(() => {
    supabase
      .from('draft_picks')
      .select('*, player:sports_players(display_name, fantasy_position, position, team:sports_teams(abbreviation))')
      .eq('draft_id', draftId!)
      .order('pick_number', { ascending: true })
      .then(({ data }) => {
        if (data) setPicks(data as Pick[]);
      });
  }, [draftId]);

  const reloadDraft = useCallback(() => {
    supabase
      .from('drafts')
      .select('*')
      .eq('id', draftId!)
      .single()
      .then(({ data }) => {
        if (!data) return;
        setDraft(data);
        const current = participantsRef.current.find(p => p.id === data.current_participant_id) ?? null;
        setCurrentParticipant(current);
      });
  }, [draftId]);

  useEffect(() => {
    if (!draftId) return;
    loadData();
    const cleanup = subscribeToLiveUpdates();

    // Polling fallback: every 5s reload draft state and picks
    pollRef.current = setInterval(() => {
      reloadDraft();
      reloadPicks();
    }, 5000);

    return () => {
      cleanup();
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [draftId]);

  async function loadData() {
    const draftRes = await supabase.from('drafts').select('*').eq('id', draftId!).single();
    if (!draftRes.data) { setLoading(false); return; }

    const [participantsRes, picksRes, leagueRes, settingsRes] = await Promise.all([
      supabase.from('draft_participants').select('*').eq('draft_id', draftId!).order('draft_position', { ascending: true }),
      supabase.from('draft_picks').select('*, player:sports_players(display_name, fantasy_position, position, team:sports_teams(abbreviation))').eq('draft_id', draftId!).order('pick_number', { ascending: true }),
      supabase.from('leagues').select('*').eq('id', draftRes.data.league_id).single(),
      supabase.from('draft_settings').select('*').eq('draft_id', draftId!).maybeSingle()
    ]);

    const newParticipants = participantsRes.data ?? [];
    setDraft(draftRes.data);
    setParticipants(newParticipants);
    if (picksRes.data) setPicks(picksRes.data as Pick[]);
    if (leagueRes.data) setLeague(leagueRes.data);
    if (settingsRes.data) setDraftSettings(settingsRes.data);

    const current = newParticipants.find(p => p.id === draftRes.data.current_participant_id) ?? null;
    setCurrentParticipant(current);
    setLoading(false);
  }

  function subscribeToLiveUpdates() {
    const channel = supabase
      .channel(`draft-board-${draftId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'drafts',
        filter: `id=eq.${draftId}`,
      }, (payload) => {
        const updated = payload.new as Draft;
        setDraft(updated);
        const current = participantsRef.current.find(p => p.id === updated.current_participant_id) ?? null;
        setCurrentParticipant(current);
        reloadPicks();
      })
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'draft_picks',
        filter: `draft_id=eq.${draftId}`,
      }, () => { reloadPicks(); })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'draft_picks',
        filter: `draft_id=eq.${draftId}`,
      }, () => { reloadPicks(); })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }

  async function startDraft() {
    if (!participants.length) return;
    const { error: err } = await supabase
      .from('drafts')
      .update({ current_participant_id: participants[0].id, status: 'in_progress' })
      .eq('id', draftId!);
    if (err) setError('Failed to start draft: ' + err.message);
  }

  async function makePick(playerId: string) {
    setError('');
    if (!draft || !currentParticipant) { setError('Cannot make pick: no active participant'); return; }

    const alreadyPicked = picks.find(p => p.player_id === playerId);
    if (alreadyPicked) { setError('This player has already been drafted'); setShowPlayerSearch(false); return; }

    const pickNumber = draft.current_pick_number;
    const round = Math.ceil(pickNumber / participants.length);
    const pickInRound = ((pickNumber - 1) % participants.length) + 1;
    const nextPickNumber = pickNumber + 1;
    const nextParticipant = getNextParticipant(pickNumber);
    const isForcePick = isOwner && currentParticipant.user_id !== user?.id;

    if (isForcePick) {
      const { error: pickError } = await supabase.from('draft_picks').insert({
        draft_id: draftId!, participant_id: currentParticipant.id, player_id: playerId,
        pick_number: pickNumber, round, pick_in_round: pickInRound,
        picked_at: new Date().toISOString(), time_taken_seconds: 0, is_autopick: false,
      });
      if (pickError) { setError('Error making pick: ' + pickError.message); setShowPlayerSearch(false); return; }

      const { error: advErr } = await supabase.from('drafts')
        .update({ current_pick_number: nextPickNumber, current_participant_id: nextParticipant?.id ?? null })
        .eq('id', draftId!);
      if (advErr) { setError('Error advancing draft: ' + advErr.message); setShowPlayerSearch(false); return; }
    } else {
      const { error: rpcError } = await supabase.rpc('advance_draft_turn', {
        p_draft_id: draftId!, p_player_id: playerId, p_pick_number: pickNumber,
        p_round: round, p_pick_in_round: pickInRound,
        p_next_pick_number: nextPickNumber, p_next_participant_id: nextParticipant?.id ?? null,
      });
      if (rpcError) { setError('Error making pick: ' + rpcError.message); setShowPlayerSearch(false); return; }
    }

    // Fire notifications without awaiting — don't block the UI
    if (nextParticipant?.user_id) {
      const notificationPayload = {
        leagueName: league?.name ?? 'Unknown League',
        pickNumber: nextPickNumber,
        teamName: nextParticipant.team_name,
        draftName: draft.name,
      };
      const messageText = `${nextParticipant.team_name}, you're on the clock! Pick #${nextPickNumber} in ${draft.name}`;
      void Promise.all([
        enqueueNotification({ channel: 'email', userId: nextParticipant.user_id, leagueId: draft.league_id, templateKey: 'draft_turn', payload: notificationPayload, messageText }),
        enqueueNotification({ channel: 'sms',   userId: nextParticipant.user_id, leagueId: draft.league_id, templateKey: 'draft_turn', payload: notificationPayload, messageText }),
      ]);
    }

    setShowPlayerSearch(false);
    setDraft(prev => prev ? { ...prev, current_pick_number: nextPickNumber, current_participant_id: nextParticipant?.id ?? null } : prev);
    setCurrentParticipant(nextParticipant ?? null);
    reloadPicks();
  }

  function getNextParticipant(currentPickNumber: number): Participant | null {
    if (!participants.length) return null;
    const nextPickNumber = currentPickNumber + 1;
    const nextRound = Math.ceil(nextPickNumber / participants.length);
    const fmt = draftSettings?.draft_format || draft?.draft_type || 'snake';
    if (fmt === 'snake') {
      const odd = nextRound % 2 === 1;
      if (odd) return participants[(nextPickNumber - 1) % participants.length];
      return participants[participants.length - 1 - ((nextPickNumber - 1) % participants.length)];
    }
    return participants[(nextPickNumber - 1) % participants.length];
  }

  if (loading) return <div style={{ padding: '40px', background: bg, minHeight: '100vh', color: textPrimary }}>Loading...</div>;
  if (!draft) return <div style={{ padding: '40px', background: bg, minHeight: '100vh', color: textPrimary }}>Draft not found</div>;

  const isOwner = !!(user && league && league.owner_id === user.id);
  const myParticipant = participants.find(p => p.user_id === user?.id) ?? null;
  const isMyTurn = !!(currentParticipant && myParticipant && currentParticipant.id === myParticipant.id);
  const draftNotStarted = draft.status === 'in_progress' && !currentParticipant && participants.length > 0;
  const canMakePick = draft.status === 'in_progress' && currentParticipant && isMyTurn;
  const canForcePick = draft.status === 'in_progress' && currentParticipant && isOwner && !isMyTurn;

  const totalRounds = draftSettings
    ? (draftSettings.roster_qb ?? 0) + (draftSettings.roster_rb ?? 0) + (draftSettings.roster_wr ?? 0)
      + (draftSettings.roster_te ?? 0) + (draftSettings.roster_flex ?? 0) + (draftSettings.roster_k ?? 0)
      + (draftSettings.roster_dst ?? 0) + (draftSettings.bench ?? 0)
    : null;
  const currentRound = participants.length > 0 ? Math.ceil(draft.current_pick_number / participants.length) : 1;
  const roundsRemaining = totalRounds != null ? Math.max(0, totalRounds - currentRound + 1) : null;

  const roundNumbers = Array.from(new Set(picks.map(p => p.round))).sort((a, b) => a - b);

  const filteredPicks = picks.filter(pick => {
    if (filterMode === 'round') return pick.round === filterRound;
    if (filterMode === 'owner') return pick.participant_id === filterOwner;
    return true;
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s: Record<string, any> = {
    page: { padding: '24px 32px', fontFamily: 'system-ui, sans-serif', color: textPrimary, background: bg, minHeight: '100vh' },
    card: { background: card, border: `1px solid ${border}`, borderRadius: '10px', padding: '20px', marginBottom: '20px' },
    h2: { color: textPrimary, margin: '0 0 14px 0', fontSize: '18px' },
    pill: (active: boolean, col: string) => ({
      padding: '4px 14px', borderRadius: '9999px', fontSize: '13px', fontWeight: '600',
      background: active ? col : 'transparent',
      color: active ? 'white' : textSecondary,
      border: `1px solid ${active ? col : border}`,
      cursor: 'pointer',
    }),
    btn: (col: string) => ({
      padding: '10px 22px', background: col, color: 'white', border: 'none',
      borderRadius: '7px', cursor: 'pointer', fontWeight: '600', fontSize: '15px',
    }),
    btnOutline: {
      padding: '10px 22px', background: 'transparent', color: amber, border: `1px solid ${amber}`,
      borderRadius: '7px', cursor: 'pointer', fontWeight: '600', fontSize: '15px',
    },
  };

  return (
    <div style={s.page}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <Link to={`/leagues/${draft.league_id}`} style={{ color: blue, textDecoration: 'none', fontSize: '14px' }}>
          ← Back to League
        </Link>
        <UserMenu />
      </div>

      <h1 style={{ color: textPrimary, marginBottom: '20px', fontSize: '26px' }}>{draft.name}</h1>

      {/* Status card */}
      <div style={s.card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
          <span style={{ color: textSecondary, fontWeight: '600' }}>Status:</span>
          <span style={{
            padding: '2px 12px', borderRadius: '9999px', fontSize: '13px', fontWeight: '600',
            background: draft.status === 'in_progress' ? '#14532d' : draft.status === 'paused' ? '#451a03' : '#1e293b',
            color: draft.status === 'in_progress' ? green : draft.status === 'paused' ? amber : textSecondary,
            border: `1px solid ${draft.status === 'in_progress' ? greenDark : draft.status === 'paused' ? amber : border}`,
          }}>
            {draft.status.replace('_', ' ')}
          </span>
        </div>
        <p style={{ margin: '0 0 6px', color: textPrimary, fontWeight: '700', fontSize: '17px' }}>
          Round {currentRound}{totalRounds != null ? ` of ${totalRounds}` : ''}
          {roundsRemaining != null && (
            <span style={{ marginLeft: '10px', color: textSecondary, fontWeight: '400', fontSize: '14px' }}>
              · {roundsRemaining} round{roundsRemaining !== 1 ? 's' : ''} remaining · Pick #{draft.current_pick_number}
            </span>
          )}
        </p>
        {draftSettings && (
          <p style={{ margin: '0 0 8px', fontSize: '13px', color: textSecondary }}>
            {draftSettings.draft_format === 'snake' ? 'Snake' : 'Linear'} Draft ·
            {draftSettings.pick_timer_seconds === 0 ? ' Unlimited time' : ` ${draftSettings.pick_timer_seconds}s per pick`} ·
            Roster: {draftSettings.roster_qb}QB {draftSettings.roster_rb}RB {draftSettings.roster_wr}WR {draftSettings.roster_te}TE {draftSettings.roster_flex}FLEX {draftSettings.roster_k}K {draftSettings.roster_dst}DST {draftSettings.bench}Bench
          </p>
        )}
        {currentParticipant && (
          <p style={{ margin: '0', fontSize: '16px', color: green, fontWeight: '700' }}>
            On the clock: {currentParticipant.team_name}
          </p>
        )}
      </div>

      {error && (
        <div style={{ marginBottom: '16px', padding: '12px 16px', background: '#450a0a', border: '1px solid #ef4444', borderRadius: '6px', color: '#fca5a5' }}>
          {error}
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '24px', flexWrap: 'wrap' }}>
        {isOwner && draftNotStarted && (
          <button onClick={startDraft} style={s.btn(greenDark)}>Start Draft</button>
        )}
        {canMakePick && (
          <button onClick={() => setShowPlayerSearch(true)} style={s.btn(blue)}>Make Pick</button>
        )}
        {canForcePick && (
          <button onClick={() => setShowPlayerSearch(true)} style={s.btn('#0f766e')}>
            Force Pick for {currentParticipant!.team_name}
          </button>
        )}
        {isOwner && draft.status === 'in_progress' && (
          <button onClick={async () => { await supabase.from('drafts').update({ status: 'paused' }).eq('id', draftId!); }} style={s.btnOutline}>
            Pause Draft
          </button>
        )}
        {isOwner && draft.status === 'paused' && (
          <button onClick={async () => { await supabase.from('drafts').update({ status: 'in_progress' }).eq('id', draftId!); }} style={s.btn(greenDark)}>
            Resume Draft
          </button>
        )}
      </div>

      {draft.status === 'paused' && (
        <div style={{ marginBottom: '16px', padding: '12px 16px', background: '#451a03', border: `1px solid ${amber}`, borderRadius: '6px', color: amber, fontSize: '14px' }}>
          Draft is paused.{isOwner ? ' Use Resume Draft to continue.' : ' Waiting for the commissioner to resume.'}
        </div>
      )}

      {showPlayerSearch && (
        <PlayerSearch draftId={draftId!} onSelectPlayer={makePick} onClose={() => setShowPlayerSearch(false)} />
      )}

      {/* Draft order */}
      <div style={s.card}>
        <h2 style={s.h2}>Draft Order</h2>
        {participants.length === 0 ? (
          <p style={{ color: textSecondary }}>No participants yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {participants.map(p => (
              <div key={p.id} style={{
                padding: '11px 14px', borderRadius: '7px', display: 'flex', alignItems: 'center', gap: '10px',
                border: `2px solid ${p.id === currentParticipant?.id ? green : border}`,
                background: p.id === currentParticipant?.id ? '#052e16' : '#0f172a',
              }}>
                <span style={{ fontWeight: '700', color: p.id === currentParticipant?.id ? green : textSecondary, minWidth: '24px' }}>
                  {p.draft_position}.
                </span>
                <span style={{ color: textPrimary, fontWeight: p.id === currentParticipant?.id ? '600' : '400' }}>
                  {p.team_name}
                </span>
                {p.id === currentParticipant?.id && (
                  <span style={{ marginLeft: 'auto', fontSize: '13px', fontWeight: '700', color: green }}>On the clock</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Picks log */}
      <div style={s.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '10px' }}>
          <h2 style={{ ...s.h2, margin: 0 }}>Picks Made ({picks.length})</h2>
          {/* Filter controls */}
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
            <button style={s.pill(filterMode === 'all', blue)} onClick={() => setFilterMode('all')}>All</button>
            <button style={s.pill(filterMode === 'round', blue)} onClick={() => setFilterMode('round')}>By Round</button>
            <button style={s.pill(filterMode === 'owner', blue)} onClick={() => setFilterMode('owner')}>By Team</button>
          </div>
        </div>

        {filterMode === 'round' && roundNumbers.length > 0 && (
          <div style={{ display: 'flex', gap: '6px', marginBottom: '12px', flexWrap: 'wrap' }}>
            {roundNumbers.map(r => (
              <button key={r} style={s.pill(filterRound === r, greenDark)} onClick={() => setFilterRound(r)}>
                Rd {r}
              </button>
            ))}
          </div>
        )}

        {filterMode === 'owner' && participants.length > 0 && (
          <div style={{ display: 'flex', gap: '6px', marginBottom: '12px', flexWrap: 'wrap' }}>
            {participants.map(p => (
              <button key={p.id} style={s.pill(filterOwner === p.id, greenDark)} onClick={() => setFilterOwner(p.id)}>
                {p.team_name}
              </button>
            ))}
          </div>
        )}

        {filteredPicks.length === 0 ? (
          <p style={{ color: textSecondary }}>No picks yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {filteredPicks.map(pick => {
              const participant = participants.find(p => p.id === pick.participant_id);
              return (
                <div key={pick.id} style={{ padding: '13px 16px', border: `1px solid ${border}`, borderRadius: '7px', background: '#0f172a' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <span style={{ fontWeight: '700', color: textPrimary }}>Pick {pick.pick_number}</span>
                      <span style={{ marginLeft: '8px', fontSize: '13px', color: textSecondary }}>Rd {pick.round}, Pick {pick.pick_in_round}</span>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: '600', color: textPrimary }}>{pick.player?.display_name ?? 'Unknown Player'}</div>
                      <div style={{ fontSize: '13px', color: textSecondary }}>
                        {pick.player?.fantasy_position ?? pick.player?.position ?? '—'}
                        {pick.player?.team?.abbreviation ? ` · ${pick.player.team.abbreviation}` : ''}
                      </div>
                    </div>
                  </div>
                  <div style={{ marginTop: '4px', fontSize: '13px', color: textSecondary }}>
                    {participant?.team_name}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
