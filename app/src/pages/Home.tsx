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

      <footer style={{ marginTop: '60px', paddingTop: '30px', borderTop: '2px solid #e5e7eb', maxWidth: '800px' }}>
        <div style={{ marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 10px 0', fontSize: '18px' }}>About Offline4ever DraftMaster</h3>
          <p style={{ margin: '0 0 15px 0', color: '#6b7280', lineHeight: '1.6' }}>
            A provider-agnostic fantasy sports draft engine for organizing recreational drafts.
            <strong> We do not support gambling, wagering, paid entry, or cash prizes.</strong>
          </p>
        </div>

        <div style={{ marginBottom: '20px', padding: '15px', background: '#f9fafb', borderRadius: '8px' }}>
          <h4 style={{ margin: '0 0 10px 0', fontSize: '14px', fontWeight: '600' }}>Contact Information</h4>
          <p style={{ margin: '5px 0', fontSize: '14px', color: '#374151' }}>
            <strong>Email:</strong> <a href="mailto:admin@offline4ever.com" style={{ color: '#2563eb', textDecoration: 'none' }}>admin@offline4ever.com</a>
          </p>
          <p style={{ margin: '5px 0', fontSize: '14px', color: '#374151' }}>
            <strong>Phone:</strong> +1 (734) 358-8854
          </p>
          <p style={{ margin: '5px 0', fontSize: '14px', color: '#374151' }}>
            <strong>Location:</strong> Wayne, Michigan, USA
          </p>
        </div>

        <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', fontSize: '14px' }}>
          <Link to="/about" style={{ color: '#2563eb', textDecoration: 'none' }}>About</Link>
          <Link to="/privacy" style={{ color: '#2563eb', textDecoration: 'none' }}>Privacy Policy</Link>
          <Link to="/terms" style={{ color: '#2563eb', textDecoration: 'none' }}>Terms of Service</Link>
          <Link to="/sms-consent" style={{ color: '#2563eb', textDecoration: 'none' }}>SMS Consent</Link>
        </div>
      </footer>
    </div>
  );
}
