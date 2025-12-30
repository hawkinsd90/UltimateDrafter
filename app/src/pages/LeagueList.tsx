import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import UserMenu from '../components/UserMenu';
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <Link to="/" style={{ color: '#2563eb', textDecoration: 'none' }}>← Home</Link>
        <UserMenu />
      </div>

      <h1>Leagues</h1>

      <Link to="/leagues/create" style={{ display: 'inline-block', padding: '10px 20px', background: '#059669', color: 'white', textDecoration: 'none', borderRadius: '6px', marginBottom: '20px' }}>
        Create New League
      </Link>

      {leagues.length === 0 ? (
        <div style={{
          padding: '40px',
          background: '#f9fafb',
          border: '2px dashed #d1d5db',
          borderRadius: '8px',
          textAlign: 'center',
          maxWidth: '500px'
        }}>
          <h3 style={{ margin: '0 0 10px 0', color: '#374151' }}>No Leagues Yet</h3>
          <p style={{ margin: '0 0 20px 0', color: '#6b7280' }}>
            Create your first league to start organizing drafts and managing your fantasy teams.
          </p>
          <Link to="/leagues/create" style={{
            display: 'inline-block',
            padding: '12px 24px',
            background: '#059669',
            color: 'white',
            textDecoration: 'none',
            borderRadius: '6px',
            fontWeight: '500'
          }}>
            Create Your First League
          </Link>
        </div>
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
