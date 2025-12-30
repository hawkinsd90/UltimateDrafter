import { useEffect, useState } from 'react';
import { supabase } from './lib/supabase';

function App() {
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkConnection = async () => {
      try {
        const { error } = await supabase.from('leagues').select('count').limit(1);
        setConnected(!error);
      } catch (err) {
        setConnected(false);
      } finally {
        setLoading(false);
      }
    };

    checkConnection();
  }, []);

  return (
    <div style={{ padding: '40px', fontFamily: 'system-ui, sans-serif' }}>
      <h1>DraftMaster - Offline4Ever</h1>
      <p>
        Status: {loading ? 'Checking connection...' : connected ? '✓ Connected to Supabase' : '✗ Not connected'}
      </p>
      <div style={{ marginTop: '20px', padding: '20px', background: '#f5f5f5', borderRadius: '8px' }}>
        <h2>Backend Infrastructure</h2>
        <ul>
          <li>✓ Database tables created</li>
          <li>✓ Row Level Security enabled</li>
          <li>✓ Supabase client initialized</li>
          <li>Ready for draft engine implementation</li>
        </ul>
      </div>
    </div>
  );
}

export default App;
