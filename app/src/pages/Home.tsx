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
    <div style={{ fontFamily: 'system-ui, sans-serif', minHeight: '100vh', background: '#1a2332' }}>
      {/* Navigation Bar */}
      <nav style={{
        background: '#1a2332',
        borderBottom: '1px solid #2d3748',
        padding: '0 40px'
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          maxWidth: '1200px',
          margin: '0 auto',
          height: '60px'
        }}>
          <div style={{ display: 'flex', gap: '30px', alignItems: 'center' }}>
            <Link to="/" style={{ fontWeight: '600', fontSize: '18px', color: '#ffffff', textDecoration: 'none' }}>
              DraftMaster
            </Link>
            {user && (
              <>
                <Link to="/leagues" style={{ color: '#cbd5e0', textDecoration: 'none', fontSize: '14px' }}>
                  Leagues
                </Link>
                <Link to="/drafts" style={{ color: '#cbd5e0', textDecoration: 'none', fontSize: '14px' }}>
                  Drafts
                </Link>
                <Link to="/notification-settings" style={{ color: '#cbd5e0', textDecoration: 'none', fontSize: '14px' }}>
                  Notifications
                </Link>
              </>
            )}
            <Link to="/about" style={{ color: '#cbd5e0', textDecoration: 'none', fontSize: '14px' }}>
              About
            </Link>
          </div>
          <UserMenu />
        </div>
      </nav>

      {/* Main Content */}
      <div style={{ padding: '40px', maxWidth: '1200px', margin: '0 auto' }}>
        <h1 style={{ fontSize: '48px', fontWeight: '700', margin: '0 0 10px 0', color: '#ffffff' }}>DraftMaster</h1>
        <p style={{ fontSize: '18px', color: '#cbd5e0', margin: '0 0 30px 0' }}>Provider-agnostic fantasy sports draft engine</p>

        {user ? (
          <div style={{ marginTop: '30px', display: 'flex', gap: '15px', flexDirection: 'column', maxWidth: '400px' }}>
            <Link to="/leagues" style={{ padding: '14px 28px', background: '#10b981', color: '#1a2332', textDecoration: 'none', borderRadius: '6px', textAlign: 'center', fontWeight: '600', fontSize: '16px' }}>
              View Leagues
            </Link>
            <Link to="/leagues/create" style={{ padding: '14px 28px', background: '#10b981', color: '#1a2332', textDecoration: 'none', borderRadius: '6px', textAlign: 'center', fontWeight: '600', fontSize: '16px' }}>
              Create League
            </Link>
          </div>
        ) : (
          <Link to="/login" style={{ padding: '14px 28px', background: '#10b981', color: '#1a2332', textDecoration: 'none', borderRadius: '6px', textAlign: 'center', display: 'inline-block', maxWidth: '400px', fontWeight: '600', fontSize: '16px' }}>
            Sign In to Get Started
          </Link>
        )}

        {playersExist === false && (
          <div style={{
            marginTop: '40px',
            padding: '20px',
            background: '#2d3748',
            border: '1px solid #4a5568',
            borderRadius: '8px',
            maxWidth: '600px'
          }}>
            <h3 style={{ margin: '0 0 10px 0', color: '#ffffff' }}>No Players Found</h3>
            <p style={{ margin: '0 0 15px 0', color: '#cbd5e0' }}>
              The player database is empty. Click the button below to seed sample players.
            </p>
            <button
              onClick={handleSeedPlayers}
              disabled={isSeeding}
              style={{
                padding: '10px 20px',
                background: isSeeding ? '#4a5568' : '#10b981',
                color: isSeeding ? '#cbd5e0' : '#1a2332',
                border: 'none',
                borderRadius: '6px',
                cursor: isSeeding ? 'not-allowed' : 'pointer',
                fontWeight: '600'
              }}
            >
              {isSeeding ? 'Seeding...' : 'Seed Sample Players'}
            </button>
            {seedMessage && (
              <p style={{
                marginTop: '10px',
                color: seedMessage.includes('Error') ? '#f87171' : '#10b981',
                fontWeight: '500'
              }}>
                {seedMessage}
              </p>
            )}
          </div>
        )}

        <hr style={{ margin: '60px 0', border: 'none', borderTop: '1px solid #2d3748' }} />

        <div style={{ marginBottom: '40px' }}>
          <h2 style={{ margin: '0 0 15px 0', fontSize: '24px', fontWeight: '600', color: '#ffffff' }}>About Offline4ever DraftMaster</h2>
          <p style={{ margin: '0', color: '#cbd5e0', lineHeight: '1.6', fontSize: '16px' }}>
            A provider-agnostic fantasy sports draft engine for organizing recreational drafts.
            <strong style={{ color: '#ffffff' }}> We do not support gambling, wagering, paid entry, or cash prizes.</strong>
          </p>
        </div>

        <div style={{ padding: '20px', background: '#2d3748', borderRadius: '8px', maxWidth: '600px' }}>
          <h3 style={{ margin: '0 0 15px 0', fontSize: '16px', fontWeight: '600', color: '#ffffff' }}>Contact Information</h3>
          <p style={{ margin: '8px 0', fontSize: '14px', color: '#cbd5e0' }}>
            <strong>Email:</strong> <a href="mailto:admin@offline4ever.com" style={{ color: '#10b981', textDecoration: 'none' }}>admin@offline4ever.com</a>
          </p>
          <p style={{ margin: '8px 0', fontSize: '14px', color: '#cbd5e0' }}>
            <strong>Phone:</strong> +1 (734) 358-8854
          </p>
          <p style={{ margin: '8px 0', fontSize: '14px', color: '#cbd5e0' }}>
            <strong>Location:</strong> Wayne, Michigan, USA
          </p>
        </div>

        <div style={{ marginTop: '40px', display: 'flex', gap: '25px', flexWrap: 'wrap', fontSize: '14px' }}>
          <Link to="/about" style={{ color: '#10b981', textDecoration: 'none' }}>About</Link>
          <Link to="/privacy" style={{ color: '#10b981', textDecoration: 'none' }}>Privacy Policy</Link>
          <Link to="/terms" style={{ color: '#10b981', textDecoration: 'none' }}>Terms of Service</Link>
          <Link to="/sms-consent" style={{ color: '#10b981', textDecoration: 'none' }}>SMS Consent</Link>
        </div>
      </div>
    </div>
  );
}
