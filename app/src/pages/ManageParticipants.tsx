import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { Database } from '../types/supabase';

type Draft = Database['public']['Tables']['drafts']['Row'];
type Participant = Database['public']['Tables']['draft_participants']['Row'];

export default function ManageParticipants() {
  const { leagueId, draftId } = useParams<{ leagueId: string; draftId: string }>();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [teamName, setTeamName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (draftId) {
      loadData();
    }
  }, [draftId]);

  async function loadData() {
    const [draftRes, participantsRes] = await Promise.all([
      supabase.from('drafts').select('*').eq('id', draftId!).single(),
      supabase.from('draft_participants').select('*').eq('draft_id', draftId!).order('draft_position', { ascending: true })
    ]);

    if (draftRes.data) setDraft(draftRes.data);
    if (participantsRes.data) setParticipants(participantsRes.data);
  }

  async function addParticipant(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    const nextPosition = participants.length + 1;

    const { error: insertError } = await supabase
      .from('draft_participants')
      .insert({
        draft_id: draftId!,
        user_id: `user-${nextPosition}`,
        team_name: teamName,
        draft_position: nextPosition,
        notification_preferences: {}
      });

    if (insertError) {
      setError('Error adding participant: ' + insertError.message);
    } else {
      setTeamName('');
      loadData();
    }
    setLoading(false);
  }

  async function startDraft() {
    setError('');

    if (participants.length < 2) {
      setError('Need at least 2 participants to start draft');
      return;
    }

    const firstParticipant = participants[0];
    const { error: updateError } = await supabase
      .from('drafts')
      .update({
        status: 'in_progress',
        current_participant_id: firstParticipant.id,
        start_time: new Date().toISOString()
      })
      .eq('id', draftId!);

    if (updateError) {
      setError('Error starting draft: ' + updateError.message);
    } else {
      navigate(`/leagues/${leagueId}/drafts/${draftId}/board`);
    }
  }

  if (!draft) return <div style={{ padding: '40px' }}>Loading...</div>;

  return (
    <div style={{ padding: '40px', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ marginBottom: '20px' }}>
        <Link to={`/leagues/${leagueId}/drafts`} style={{ color: '#2563eb', textDecoration: 'none' }}>
          ← Back to Drafts
        </Link>
      </div>

      <h1>Setup Participants</h1>
      <h2 style={{ color: '#6b7280', fontWeight: 'normal', marginTop: '5px' }}>{draft.name}</h2>

      <div style={{ marginTop: '30px', maxWidth: '600px' }}>
        <h3>Current Participants ({participants.length})</h3>
        {participants.length === 0 ? (
          <p style={{ color: '#6b7280' }}>No participants yet. Add at least 2 to start.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '20px' }}>
            {participants.map(p => (
              <div key={p.id} style={{ padding: '15px', border: '1px solid #e5e7eb', borderRadius: '6px', display: 'flex', justifyContent: 'space-between' }}>
                <span><strong>Pick {p.draft_position}:</strong> {p.team_name}</span>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={addParticipant} style={{ marginTop: '20px' }}>
          <label style={{ display: 'block', marginBottom: '5px', fontWeight: '500' }}>
            Add Participant
          </label>
          <div style={{ display: 'flex', gap: '10px' }}>
            <input
              type="text"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              placeholder="Team Name"
              required
              style={{ flex: 1, padding: '10px', border: '1px solid #d1d5db', borderRadius: '6px' }}
            />
            <button
              type="submit"
              disabled={loading}
              style={{
                padding: '10px 20px',
                background: '#2563eb',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: loading ? 'not-allowed' : 'pointer',
                fontWeight: '500'
              }}
            >
              Add
            </button>
          </div>
        </form>

        {error && (
          <div style={{
            marginTop: '20px',
            padding: '12px',
            background: '#fee2e2',
            border: '1px solid #ef4444',
            borderRadius: '6px',
            color: '#dc2626'
          }}>
            {error}
          </div>
        )}

        <button
          onClick={startDraft}
          disabled={participants.length < 2}
          style={{
            marginTop: '30px',
            padding: '12px 24px',
            background: participants.length < 2 ? '#9ca3af' : '#059669',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: participants.length < 2 ? 'not-allowed' : 'pointer',
            fontWeight: '500',
            fontSize: '16px'
          }}
        >
          Start Draft
        </button>
        {participants.length < 2 && (
          <p style={{ marginTop: '10px', color: '#6b7280', fontSize: '14px' }}>
            Add at least 2 participants to start the draft
          </p>
        )}
      </div>
    </div>
  );
}
