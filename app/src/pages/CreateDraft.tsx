import { useState, useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { Database } from '../types/supabase';
import UserMenu from '../components/UserMenu';

type League = Database['public']['Tables']['leagues']['Row'];

export default function CreateDraft() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const navigate = useNavigate();
  const [league, setLeague] = useState<League | null>(null);
  const [name, setName] = useState('');
  const [draftType, setDraftType] = useState('snake');
  const [pickTimeSeconds, setPickTimeSeconds] = useState(60);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (leagueId) {
      loadLeague();
    }
  }, [leagueId]);

  async function loadLeague() {
    const { data } = await supabase
      .from('leagues')
      .select('*')
      .eq('id', leagueId!)
      .single();

    if (data) setLeague(data);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    const { data, error } = await supabase
      .from('drafts')
      .insert({
        league_id: leagueId!,
        name,
        draft_type: draftType,
        status: 'setup',
        current_pick_number: 1,
        pick_time_seconds: pickTimeSeconds,
        settings: {}
      })
      .select()
      .single();

    setLoading(false);

    if (error) {
      alert('Error creating draft: ' + error.message);
    } else if (data) {
      navigate(`/leagues/${leagueId}/drafts/${data.id}/participants`);
    }
  }

  if (!league) return <div style={{ padding: '40px' }}>Loading...</div>;

  return (
    <div style={{ padding: '40px', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <Link to={`/leagues/${leagueId}/drafts`} style={{ color: '#2563eb', textDecoration: 'none' }}>
          ← Back to {league.name}
        </Link>
        <UserMenu />
      </div>

      <h1>Create Draft</h1>

      <form onSubmit={handleSubmit} style={{ maxWidth: '500px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div>
          <label style={{ display: 'block', marginBottom: '5px', fontWeight: '500' }}>
            Draft Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            style={{ width: '100%', padding: '10px', border: '1px solid #d1d5db', borderRadius: '6px' }}
          />
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '5px', fontWeight: '500' }}>
            Draft Type
          </label>
          <select
            value={draftType}
            onChange={(e) => setDraftType(e.target.value)}
            style={{ width: '100%', padding: '10px', border: '1px solid #d1d5db', borderRadius: '6px' }}
          >
            <option value="snake">Snake</option>
            <option value="linear">Linear</option>
          </select>
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '5px', fontWeight: '500' }}>
            Pick Time (seconds)
          </label>
          <input
            type="number"
            value={pickTimeSeconds}
            onChange={(e) => setPickTimeSeconds(Number(e.target.value))}
            min={10}
            max={300}
            style={{ width: '100%', padding: '10px', border: '1px solid #d1d5db', borderRadius: '6px' }}
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          style={{
            padding: '12px 24px',
            background: '#059669',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: loading ? 'not-allowed' : 'pointer',
            fontWeight: '500'
          }}
        >
          {loading ? 'Creating...' : 'Create Draft'}
        </button>
      </form>
    </div>
  );
}
