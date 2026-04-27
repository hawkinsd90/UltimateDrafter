import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { Database } from '../types/supabase';
import PlayerSearch from '../components/PlayerSearch';
import { enqueueNotification } from '../utils/notifications';
import UserMenu from '../components/UserMenu';

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

export default function DraftBoard() {
  const { draftId } = useParams<{ draftId: string }>();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [league, setLeague] = useState<League | null>(null);
  const [draftSettings, setDraftSettings] = useState<DraftSettings | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [currentParticipant, setCurrentParticipant] = useState<Participant | null>(null);
  const [showPlayerSearch, setShowPlayerSearch] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (draftId) {
      loadData();
    }
  }, [draftId]);

  async function loadData() {
    const draftRes = await supabase.from('drafts').select('*').eq('id', draftId!).single();

    if (!draftRes.data) {
      setLoading(false);
      return;
    }

    const [participantsRes, picksRes, leagueRes, settingsRes] = await Promise.all([
      supabase.from('draft_participants').select('*').eq('draft_id', draftId!).order('draft_position', { ascending: true }),
      supabase.from('draft_picks').select('*, player:sports_players(display_name, fantasy_position, position, team:sports_teams(abbreviation))').eq('draft_id', draftId!).order('pick_number', { ascending: true }),
      supabase.from('leagues').select('*').eq('id', draftRes.data.league_id).single(),
      supabase.from('draft_settings').select('*').eq('draft_id', draftId!).maybeSingle()
    ]);

    setDraft(draftRes.data);
    if (draftRes.data.current_participant_id && participantsRes.data) {
      const current = participantsRes.data.find(p => p.id === draftRes.data.current_participant_id);
      setCurrentParticipant(current || null);
    }
    if (participantsRes.data) setParticipants(participantsRes.data);
    if (picksRes.data) setPicks(picksRes.data as Pick[]);
    if (leagueRes.data) setLeague(leagueRes.data);
    if (settingsRes.data) setDraftSettings(settingsRes.data);
    setLoading(false);
  }

  async function makePick(playerId: string) {
    setError('');

    if (!draft || !currentParticipant) {
      setError('Cannot make pick: no active participant');
      return;
    }

    const alreadyPicked = picks.find(p => p.player_id === playerId);
    if (alreadyPicked) {
      setError('This player has already been drafted');
      setShowPlayerSearch(false);
      return;
    }

    const pickNumber = draft.current_pick_number;
    const round = Math.ceil(pickNumber / participants.length);
    const pickInRound = ((pickNumber - 1) % participants.length) + 1;

    const { error: pickError } = await supabase
      .from('draft_picks')
      .insert({
        draft_id: draftId!,
        participant_id: currentParticipant.id,
        player_id: playerId,
        pick_number: pickNumber,
        round,
        pick_in_round: pickInRound,
        picked_at: new Date().toISOString(),
        time_taken_seconds: 0,
        is_autopick: false
      });

    if (pickError) {
      setError('Error making pick: ' + pickError.message);
      setShowPlayerSearch(false);
      return;
    }

    const nextPickNumber = pickNumber + 1;
    const nextParticipant = getNextParticipant(pickNumber);

    const { error: draftError } = await supabase
      .from('drafts')
      .update({
        current_pick_number: nextPickNumber,
        current_participant_id: nextParticipant?.id || null
      })
      .eq('id', draftId!);

    if (draftError) {
      setError('Error updating draft: ' + draftError.message);
      setShowPlayerSearch(false);
      return;
    }

    // Enqueue email, SMS, and voice notifications for next participant
    if (nextParticipant && nextParticipant.user_id) {
      const notificationPayload = {
        leagueName: league?.name || 'Unknown League',
        pickNumber: nextPickNumber,
        teamName: nextParticipant.team_name,
        draftName: draft.name
      };
      const messageText = `${nextParticipant.team_name}, you're on the clock! Pick #${nextPickNumber} in ${draft.name}`;

      // Enqueue all three channels (edge function will apply consent + destination gating)
      const [emailResult, smsResult, voiceResult] = await Promise.all([
        enqueueNotification({
          channel: 'email',
          userId: nextParticipant.user_id,
          leagueId: draft.league_id,
          templateKey: 'draft_turn',
          payload: notificationPayload,
          messageText
        }),
        enqueueNotification({
          channel: 'sms',
          userId: nextParticipant.user_id,
          leagueId: draft.league_id,
          templateKey: 'draft_turn',
          payload: notificationPayload,
          messageText
        }),
        enqueueNotification({
          channel: 'voice',
          userId: nextParticipant.user_id,
          leagueId: draft.league_id,
          templateKey: 'draft_turn',
          payload: notificationPayload,
          messageText
        })
      ]);

      console.log('[DraftBoard] Notifications enqueued:', {
        email: { notificationId: emailResult.notificationId, status: emailResult.status },
        sms: { notificationId: smsResult.notificationId, status: smsResult.status },
        voice: { notificationId: voiceResult.notificationId, status: voiceResult.status }
      });
    }

    setShowPlayerSearch(false);
    loadData();
  }

  function getNextParticipant(currentPickNumber: number): Participant | null {
    if (participants.length === 0) return null;

    const nextPickNumber = currentPickNumber + 1;
    const nextRound = Math.ceil(nextPickNumber / participants.length);

    const draftFormat = draftSettings?.draft_format || draft?.draft_type || 'snake';

    if (draftFormat === 'snake') {
      const isNextRoundOdd = nextRound % 2 === 1;

      if (isNextRoundOdd) {
        const position = ((nextPickNumber - 1) % participants.length);
        return participants[position];
      } else {
        const position = participants.length - 1 - ((nextPickNumber - 1) % participants.length);
        return participants[position];
      }
    } else {
      const position = ((nextPickNumber - 1) % participants.length);
      return participants[position];
    }
  }

  if (loading) return <div style={{ padding: '40px', color: '#0f172a' }}>Loading...</div>;
  if (!draft) return <div style={{ padding: '40px', color: '#0f172a' }}>Draft not found</div>;

  return (
    <div style={{ padding: '40px', fontFamily: 'system-ui, sans-serif', color: '#0f172a' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <Link to={`/leagues/${draft.league_id}`} style={{ color: '#2563eb', textDecoration: 'none' }}>
          ← Back to League
        </Link>
        <UserMenu />
      </div>

      <h1 style={{ color: '#0f172a' }}>{draft.name}</h1>
      <div style={{ marginBottom: '30px', padding: '20px', background: 'white', border: '1px solid #e2e8f0', borderRadius: '8px', color: '#0f172a' }}>
        <p style={{ margin: '0 0 8px 0', color: '#0f172a' }}>
          <strong>Status:</strong>{' '}
          <span style={{
            textTransform: 'capitalize',
            display: 'inline-block',
            padding: '2px 10px',
            borderRadius: '9999px',
            fontSize: '13px',
            fontWeight: '600',
            background: draft.status === 'in_progress' ? '#dcfce7' : draft.status === 'paused' ? '#fef9c3' : '#f1f5f9',
            color: draft.status === 'in_progress' ? '#166534' : draft.status === 'paused' ? '#713f12' : '#475569',
          }}>
            {draft.status}
          </span>
        </p>
        <p style={{ margin: '0 0 8px 0', color: '#0f172a' }}>
          <strong>Pick #{draft.current_pick_number}</strong>
        </p>
        {draftSettings && (
          <p style={{ margin: '0 0 8px 0', fontSize: '14px', color: '#475569' }}>
            {draftSettings.draft_format === 'snake' ? 'Snake' : 'Linear'} Draft •
            {draftSettings.pick_timer_seconds === 0 ? ' Unlimited time' : ` ${draftSettings.pick_timer_seconds}s per pick`} •
            Roster: {draftSettings.roster_qb}QB {draftSettings.roster_rb}RB {draftSettings.roster_wr}WR {draftSettings.roster_te}TE {draftSettings.roster_flex}FLEX {draftSettings.roster_k}K {draftSettings.roster_dst}DST {draftSettings.bench}Bench
          </p>
        )}
        {currentParticipant && (
          <p style={{ margin: '0', fontSize: '17px', color: '#059669', fontWeight: '600' }}>
            On the clock: {currentParticipant.team_name}
          </p>
        )}
      </div>

      {error && (
        <div style={{
          marginBottom: '20px',
          padding: '12px',
          background: '#fee2e2',
          border: '1px solid #ef4444',
          borderRadius: '6px',
          color: '#dc2626'
        }}>
          {error}
        </div>
      )}

      {draft.status === 'in_progress' && currentParticipant && (
        <button
          onClick={() => setShowPlayerSearch(true)}
          style={{
            padding: '12px 24px',
            background: '#2563eb',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontWeight: '600',
            fontSize: '16px',
            marginBottom: '20px'
          }}
        >
          Make Pick
        </button>
      )}

      {draft.status === 'in_progress' && !currentParticipant && participants.length > 0 && (
        <div style={{ marginBottom: '20px', display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ padding: '12px 16px', background: '#fef9c3', border: '1px solid #fde047', borderRadius: '6px', color: '#713f12', fontSize: '14px' }}>
            No active participant set. Use the button to assign the next pick and make a selection.
          </div>
          <button
            onClick={async () => {
              const first = participants[0];
              await supabase.from('drafts').update({ current_participant_id: first.id }).eq('id', draft.id);
              setCurrentParticipant(first);
            }}
            style={{ padding: '12px 20px', background: '#2563eb', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '600', fontSize: '15px', whiteSpace: 'nowrap' }}
          >
            Set Pick 1 &amp; Make Pick
          </button>
        </div>
      )}

      {draft.status === 'in_progress' && !currentParticipant && participants.length === 0 && (
        <div style={{ marginBottom: '20px', padding: '12px 16px', background: '#fef9c3', border: '1px solid #fde047', borderRadius: '6px', color: '#713f12', fontSize: '14px' }}>
          No participants have joined this draft yet. Add participants before making picks.
        </div>
      )}

      {showPlayerSearch && (
        <PlayerSearch
          draftId={draftId!}
          onSelectPlayer={makePick}
          onClose={() => setShowPlayerSearch(false)}
        />
      )}

      <h2 style={{ color: '#0f172a' }}>Draft Order</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '30px' }}>
        {participants.length === 0 ? (
          <p style={{ color: '#64748b' }}>No participants yet.</p>
        ) : participants.map(p => (
          <div
            key={p.id}
            style={{
              padding: '12px 16px',
              border: '2px solid',
              borderColor: p.id === currentParticipant?.id ? '#059669' : '#e2e8f0',
              borderRadius: '7px',
              background: p.id === currentParticipant?.id ? '#f0fdf4' : 'white',
              color: '#0f172a',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
            }}
          >
            <span style={{ fontWeight: '700', color: p.id === currentParticipant?.id ? '#059669' : '#64748b', minWidth: '28px' }}>
              {p.draft_position}.
            </span>
            <span style={{ fontWeight: p.id === currentParticipant?.id ? '600' : '400' }}>{p.team_name}</span>
            {p.id === currentParticipant?.id && (
              <span style={{ marginLeft: 'auto', fontSize: '13px', fontWeight: '600', color: '#059669' }}>On the clock</span>
            )}
          </div>
        ))}
      </div>

      <h2 style={{ color: '#0f172a' }}>Picks Made ({picks.length})</h2>
      {picks.length === 0 ? (
        <p style={{ color: '#64748b' }}>No picks yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {picks.map(pick => {
            const participant = participants.find(p => p.id === pick.participant_id);
            return (
              <div key={pick.id} style={{ padding: '14px 16px', border: '1px solid #e2e8f0', borderRadius: '7px', background: 'white', color: '#0f172a' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <span style={{ fontWeight: '700', color: '#0f172a' }}>Pick {pick.pick_number}</span>
                    <span style={{ marginLeft: '8px', fontSize: '13px', color: '#64748b' }}>Rd {pick.round}, Pick {pick.pick_in_round}</span>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: '600', color: '#0f172a' }}>{pick.player?.display_name ?? 'Unknown Player'}</div>
                    <div style={{ fontSize: '13px', color: '#64748b' }}>
                      {pick.player?.fantasy_position ?? pick.player?.position ?? '—'}
                      {pick.player?.team?.abbreviation ? ` · ${pick.player.team.abbreviation}` : ''}
                    </div>
                  </div>
                </div>
                <div style={{ marginTop: '4px', fontSize: '13px', color: '#64748b' }}>
                  {participant?.team_name}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
