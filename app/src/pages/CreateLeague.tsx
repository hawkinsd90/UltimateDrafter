import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { getSeasonLabel } from '../utils/season';
import { useAuth } from '../contexts/AuthContext';
import UserMenu from '../components/UserMenu';

export default function CreateLeague() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [name, setName] = useState('');
  const [sport, setSport] = useState('football');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const season = getSeasonLabel(sport);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    if (!user?.id) {
      setError('You must be signed in to create a league');
      setLoading(false);
      return;
    }

    const { data, error: insertError } = await supabase
      .from('leagues')
      .insert({
        name,
        sport,
        season,
        owner_id: user.id,
        settings: {}
      })
      .select()
      .single();

    setLoading(false);

    if (insertError) {
      setError('Error creating league: ' + insertError.message);
    } else if (data) {
      navigate(`/leagues/${data.id}/drafts`);
    }
  }

  return (
    <div style={{ padding: '40px', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <Link to="/leagues" style={{ color: '#2563eb', textDecoration: 'none' }}>← Back to Leagues</Link>
        <UserMenu />
      </div>

      <h1>Create League</h1>

      <form onSubmit={handleSubmit} style={{ maxWidth: '500px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div>
          <label style={{ display: 'block', marginBottom: '5px', fontWeight: '500' }}>
            League Name
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
            Sport
          </label>
          <select
            value={sport}
            onChange={(e) => setSport(e.target.value)}
            style={{ width: '100%', padding: '10px', border: '1px solid #d1d5db', borderRadius: '6px' }}
          >
            <option value="football">Football</option>
            <option value="basketball">Basketball</option>
            <option value="baseball">Baseball</option>
            <option value="hockey">Hockey</option>
          </select>
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '5px', fontWeight: '500', color: '#6b7280' }}>
            Season
          </label>
          <div style={{ padding: '10px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '6px', color: '#374151' }}>
            {season}
          </div>
        </div>

        {error && (
          <div style={{
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
          {loading ? 'Creating...' : 'Create League'}
        </button>
      </form>
    </div>
  );
}
