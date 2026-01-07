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
    <div style={{ fontFamily: 'system-ui, sans-serif', minHeight: '100vh' }}>
      {/* Navigation Bar */}
      <nav style={{
        background: '#ffffff',
        borderBottom: '1px solid #e5e7eb',
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
            <Link to="/" style={{ fontWeight: '600', fontSize: '18px', color: '#111827', textDecoration: 'none' }}>
              DraftMaster
            </Link>
            {user && (
              <>
                <Link to="/leagues" style={{ color: '#6b7280', textDecoration: 'none', fontSize: '14px' }}>
                  Leagues
                </Link>
                <Link to="/drafts" style={{ color: '#6b7280', textDecoration: 'none', fontSize: '14px' }}>
                  Drafts
                </Link>
                <Link to="/notification-settings" style={{ color: '#6b7280', textDecoration: 'none', fontSize: '14px' }}>
                  Notifications
                </Link>
              </>
            )}
            <Link to="/about" style={{ color: '#6b7280', textDecoration: 'none', fontSize: '14px' }}>
              About
            </Link>
          </div>
          <UserMenu />
        </div>
      </nav>

      {/* Main Content */}
      <div style={{ padding: '40px', maxWidth: '1200px', margin: '0 auto' }}>
        <h1 style={{ fontSize: '48px', fontWeight: '700', margin: '0 0 10px 0' }}>DraftMaster</h1>
        <p style={{ fontSize: '18px', color: '#6b7280', margin: '0 0 30px 0' }}>Provider-agnostic fantasy sports draft engine</p>

        {user ? (
          <div style={{ marginTop: '30px', display: 'flex', gap: '15px', flexDirection: 'column', maxWidth: '400px' }}>
            <Link to="/leagues" style={{ padding: '14px 28px', background: '#2563eb', color: 'white', textDecoration: 'none', borderRadius: '6px', textAlign: 'center', fontWeight: '500', fontSize: '16px' }}>
              View Leagues
            </Link>
            <Link to="/leagues/create" style={{ padding: '14px 28px', background: '#059669', color: 'white', textDecoration: 'none', borderRadius: '6px', textAlign: 'center', fontWeight: '500', fontSize: '16px' }}>
              Create League
            </Link>
          </div>
        ) : (
          <Link to="/login" style={{ padding: '14px 28px', background: '#2563eb', color: 'white', textDecoration: 'none', borderRadius: '6px', textAlign: 'center', display: 'inline-block', maxWidth: '400px', fontWeight: '500', fontSize: '16px' }}>
            Sign In to Get Started
          </Link>
        )}

        {playersExist === false && (
          <div style={{
            marginTop: '40px',
            padding: '20px',
            background: '#fef3c7',
            border: '1px solid #f59e0b',
            borderRadius: '8px',
            maxWidth: '600px'
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

        <hr style={{ margin: '60px 0', border: 'none', borderTop: '1px solid #e5e7eb' }} />

        <div style={{ marginBottom: '40px' }}>
          <h2 style={{ margin: '0 0 15px 0', fontSize: '24px', fontWeight: '600' }}>About Offline4ever DraftMaster</h2>
          <p style={{ margin: '0', color: '#6b7280', lineHeight: '1.6', fontSize: '16px' }}>
            A provider-agnostic fantasy sports draft engine for organizing recreational drafts.
            <strong style={{ color: '#374151' }}> We do not support gambling, wagering, paid entry, or cash prizes.</strong>
          </p>
        </div>

        <div style={{ padding: '20px', background: '#f9fafb', borderRadius: '8px', maxWidth: '600px' }}>
          <h3 style={{ margin: '0 0 15px 0', fontSize: '16px', fontWeight: '600' }}>Contact Information</h3>
          <p style={{ margin: '8px 0', fontSize: '14px', color: '#374151' }}>
            <strong>Email:</strong> <a href="mailto:admin@offline4ever.com" style={{ color: '#2563eb', textDecoration: 'none' }}>admin@offline4ever.com</a>
          </p>
          <p style={{ margin: '8px 0', fontSize: '14px', color: '#374151' }}>
            <strong>Phone:</strong> +1 (734) 358-8854
          </p>
          <p style={{ margin: '8px 0', fontSize: '14px', color: '#374151' }}>
            <strong>Location:</strong> Wayne, Michigan, USA
          </p>
        </div>

        <div style={{ marginTop: '40px', display: 'flex', gap: '25px', flexWrap: 'wrap', fontSize: '14px' }}>
          <Link to="/about" style={{ color: '#2563eb', textDecoration: 'none' }}>About</Link>
          <Link to="/privacy" style={{ color: '#2563eb', textDecoration: 'none' }}>Privacy Policy</Link>
          <Link to="/terms" style={{ color: '#2563eb', textDecoration: 'none' }}>Terms of Service</Link>
          <Link to="/sms-consent" style={{ color: '#2563eb', textDecoration: 'none' }}>SMS Consent</Link>
        </div>
      </div>
    </div>
  );
}
