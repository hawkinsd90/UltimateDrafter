import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { getSeasonLabel } from '../utils/season';

export default function CreateLeague() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [sport, setSport] = useState('football');
  const [loading, setLoading] = useState(false);

  const season = getSeasonLabel(sport);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    const { data, error } = await supabase
      .from('leagues')
      .insert({
        name,
        sport,
        season,
        owner_id: 'temp-user-id',
        settings: {}
      })
      .select()
      .single();

    setLoading(false);

    if (error) {
      alert('Error creating league: ' + error.message);
    } else if (data) {
      navigate(`/leagues/${data.id}/drafts`);
    }
  }

  return (
    <div style={{ padding: '40px', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ marginBottom: '20px' }}>
        <Link to="/leagues" style={{ color: '#2563eb', textDecoration: 'none' }}>← Back to Leagues</Link>
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
