import { Link } from 'react-router-dom';

export default function Home() {
  return (
    <div style={{ padding: '40px', fontFamily: 'system-ui, sans-serif' }}>
      <h1>DraftMaster</h1>
      <p>Provider-agnostic fantasy sports draft engine</p>

      <div style={{ marginTop: '30px', display: 'flex', gap: '15px', flexDirection: 'column', maxWidth: '300px' }}>
        <Link to="/leagues" style={{ padding: '12px 24px', background: '#2563eb', color: 'white', textDecoration: 'none', borderRadius: '6px', textAlign: 'center' }}>
          View Leagues
        </Link>
        <Link to="/leagues/create" style={{ padding: '12px 24px', background: '#059669', color: 'white', textDecoration: 'none', borderRadius: '6px', textAlign: 'center' }}>
          Create League
        </Link>
      </div>
    </div>
  );
}
