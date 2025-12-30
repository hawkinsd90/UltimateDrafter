import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { Database } from '../types/supabase';

type League = Database['public']['Tables']['leagues']['Row'];

export default function LeagueList() {
  const [leagues, setLeagues] = useState<League[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadLeagues();
  }, []);

  async function loadLeagues() {
    const { data, error } = await supabase
      .from('leagues')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error && data) {
      setLeagues(data);
    }
    setLoading(false);
  }

  if (loading) return <div style={{ padding: '40px' }}>Loading...</div>;

  return (
    <div style={{ padding: '40px', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ marginBottom: '20px' }}>
        <Link to="/" style={{ color: '#2563eb', textDecoration: 'none' }}>← Home</Link>
      </div>

      <h1>Leagues</h1>

      <Link to="/leagues/create" style={{ display: 'inline-block', padding: '10px 20px', background: '#059669', color: 'white', textDecoration: 'none', borderRadius: '6px', marginBottom: '20px' }}>
        Create New League
      </Link>

      {leagues.length === 0 ? (
        <p>No leagues yet. Create one to get started!</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          {leagues.map(league => (
            <div key={league.id} style={{ padding: '20px', border: '1px solid #e5e7eb', borderRadius: '8px' }}>
              <h3 style={{ margin: '0 0 10px 0' }}>{league.name}</h3>
              <p style={{ margin: '0 0 10px 0', color: '#6b7280' }}>
                {league.sport} - {league.season}
              </p>
              <Link to={`/leagues/${league.id}/drafts`} style={{ color: '#2563eb', textDecoration: 'none' }}>
                View Drafts →
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
