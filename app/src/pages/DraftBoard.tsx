import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { Database } from '../types/supabase';
import PlayerSearch from '../components/PlayerSearch';

type Draft = Database['public']['Tables']['drafts']['Row'];
type Participant = Database['public']['Tables']['draft_participants']['Row'];
type Pick = Database['public']['Tables']['draft_picks']['Row'] & {
  player?: { name: string; position: string; team: string | null };
};

export default function DraftBoard() {
  const { leagueId, draftId } = useParams<{ leagueId: string; draftId: string }>();
  const [draft, setDraft] = useState<Draft | null>(null);
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
    const [draftRes, participantsRes, picksRes] = await Promise.all([
      supabase.from('drafts').select('*').eq('id', draftId!).single(),
      supabase.from('draft_participants').select('*').eq('draft_id', draftId!).order('draft_position', { ascending: true }),
      supabase.from('draft_picks').select('*, player:players(name, position, team)').eq('draft_id', draftId!).order('pick_number', { ascending: true })
    ]);

    if (draftRes.data) {
      setDraft(draftRes.data);
      if (draftRes.data.current_participant_id && participantsRes.data) {
        const current = participantsRes.data.find(p => p.id === draftRes.data.current_participant_id);
        setCurrentParticipant(current || null);
      }
    }
    if (participantsRes.data) setParticipants(participantsRes.data);
    if (picksRes.data) setPicks(picksRes.data as Pick[]);
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

    if (nextParticipant) {
      await supabase.from('notifications_outbox').insert({
        draft_id: draftId!,
        participant_id: nextParticipant.id,
        notification_type: 'your_turn',
        channel: 'sms',
        recipient: nextParticipant.user_id,
        message: `${nextParticipant.team_name}, you are on the clock! Pick ${nextPickNumber}`,
        status: 'pending',
        metadata: { pick_number: nextPickNumber }
      });
    }

    setShowPlayerSearch(false);
    loadData();
  }

  function getNextParticipant(currentPickNumber: number): Participant | null {
    if (participants.length === 0) return null;

    const nextPickNumber = currentPickNumber + 1;
    const nextRound = Math.ceil(nextPickNumber / participants.length);

    if (draft?.draft_type === 'snake') {
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

  if (loading) return <div style={{ padding: '40px' }}>Loading...</div>;
  if (!draft) return <div style={{ padding: '40px' }}>Draft not found</div>;

  return (
    <div style={{ padding: '40px', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ marginBottom: '20px' }}>
        <Link to={`/leagues/${leagueId}/drafts`} style={{ color: '#2563eb', textDecoration: 'none' }}>
          ← Back to Drafts
        </Link>
      </div>

      <h1>{draft.name}</h1>
      <div style={{ marginBottom: '30px', padding: '20px', background: '#f3f4f6', borderRadius: '8px' }}>
        <p style={{ margin: '0 0 10px 0' }}>
          <strong>Status:</strong> <span style={{ textTransform: 'capitalize' }}>{draft.status}</span>
        </p>
        <p style={{ margin: '0 0 10px 0' }}>
          <strong>Pick #{draft.current_pick_number}</strong>
        </p>
        {currentParticipant && (
          <p style={{ margin: '0', fontSize: '18px', color: '#059669', fontWeight: '600' }}>
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
            fontWeight: '500',
            fontSize: '16px',
            marginBottom: '20px'
          }}
        >
          Make Pick
        </button>
      )}

      {draft.status === 'in_progress' && !currentParticipant && (
        <div style={{
          marginBottom: '20px',
          padding: '12px',
          background: '#fef3c7',
          border: '1px solid #f59e0b',
          borderRadius: '6px',
          color: '#92400e'
        }}>
          No active participant. Draft may be complete or in an invalid state.
        </div>
      )}

      {showPlayerSearch && (
        <PlayerSearch
          draftId={draftId!}
          onSelectPlayer={makePick}
          onClose={() => setShowPlayerSearch(false)}
        />
      )}

      <h2>Draft Order</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '30px' }}>
        {participants.map(p => (
          <div
            key={p.id}
            style={{
              padding: '15px',
              border: '2px solid',
              borderColor: p.id === currentParticipant?.id ? '#059669' : '#e5e7eb',
              borderRadius: '6px',
              background: p.id === currentParticipant?.id ? '#f0fdf4' : 'white'
            }}
          >
            <strong>Pick {p.draft_position}:</strong> {p.team_name}
          </div>
        ))}
      </div>

      <h2>Picks Made ({picks.length})</h2>
      {picks.length === 0 ? (
        <p style={{ color: '#6b7280' }}>No picks yet</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {picks.map(pick => {
            const participant = participants.find(p => p.id === pick.participant_id);
            return (
              <div key={pick.id} style={{ padding: '15px', border: '1px solid #e5e7eb', borderRadius: '6px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <strong>Pick {pick.pick_number}</strong> (Rd {pick.round}, Pick {pick.pick_in_round})
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: '600' }}>{pick.player?.name || 'Unknown Player'}</div>
                    <div style={{ color: '#6b7280', fontSize: '14px' }}>
                      {pick.player?.position} - {pick.player?.team || 'FA'}
                    </div>
                  </div>
                </div>
                <div style={{ marginTop: '5px', color: '#6b7280', fontSize: '14px' }}>
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
