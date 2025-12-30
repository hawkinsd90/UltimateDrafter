import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import UserMenu from '../components/UserMenu';

export default function Home() {
  const { user } = useAuth();
  const [playersExist, setPlayersExist] = useState<boolean | null>(null);
  const [isSeeding, setIsSeeding] = useState(false);
  const [seedMessage, setSeedMessage] = useState('');

  useEffect(() => {
    checkPlayers();
  }, []);

  async function checkPlayers() {
    try {
      const { data } = await supabase
        .from('players')
        .select('id')
        .limit(1);

      setPlayersExist(data && data.length > 0);
    } catch (error) {
      console.error('Error checking players:', error);
      setPlayersExist(false);
    }
  }

  async function handleSeedPlayers() {
    setIsSeeding(true);
    setSeedMessage('');

    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

      const response = await fetch(`${supabaseUrl}/functions/v1/seed-players`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseAnonKey}`,
          'Content-Type': 'application/json',
        },
      });

      const result = await response.json();

      if (response.ok) {
        setSeedMessage(result.message);
        setPlayersExist(true);
      } else {
        setSeedMessage(`Error: ${result.error}`);
      }
    } catch (error) {
      setSeedMessage(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsSeeding(false);
    }
  }

  return (
    <div style={{ padding: '40px', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '20px' }}>
        <UserMenu />
      </div>

      <h1>DraftMaster</h1>
      <p>Provider-agnostic fantasy sports draft engine</p>

      {playersExist === false && (
        <div style={{
          marginTop: '30px',
          padding: '20px',
          background: '#fef3c7',
          border: '1px solid #f59e0b',
          borderRadius: '8px',
          maxWidth: '500px'
        }}>
          <h3 style={{ margin: '0 0 10px 0', color: '#92400e' }}>No Players Found</h3>
          <p style={{ margin: '0 0 15px 0', color: '#78350f' }}>
            The player database is empty. Click the button below to seed sample players.
          </p>
          <button
            onClick={handleSeedPlayers}
            disabled={isSeeding}
            style={{
              padding: '10px 20px',
              background: isSeeding ? '#9ca3af' : '#f59e0b',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: isSeeding ? 'not-allowed' : 'pointer',
              fontWeight: '500'
            }}
          >
            {isSeeding ? 'Seeding...' : 'Seed Sample Players'}
          </button>
          {seedMessage && (
            <p style={{
              marginTop: '10px',
              color: seedMessage.includes('Error') ? '#dc2626' : '#059669',
              fontWeight: '500'
            }}>
              {seedMessage}
            </p>
          )}
        </div>
      )}

      <div style={{ marginTop: '30px', display: 'flex', gap: '15px', flexDirection: 'column', maxWidth: '300px' }}>
        {user ? (
          <>
            <Link to="/leagues" style={{ padding: '12px 24px', background: '#2563eb', color: 'white', textDecoration: 'none', borderRadius: '6px', textAlign: 'center' }}>
              View Leagues
            </Link>
            <Link to="/leagues/create" style={{ padding: '12px 24px', background: '#059669', color: 'white', textDecoration: 'none', borderRadius: '6px', textAlign: 'center' }}>
              Create League
            </Link>
          </>
        ) : (
          <Link to="/login" style={{ padding: '12px 24px', background: '#2563eb', color: 'white', textDecoration: 'none', borderRadius: '6px', textAlign: 'center' }}>
            Sign In to Get Started
          </Link>
        )}
      </div>
    </div>
  );
}
