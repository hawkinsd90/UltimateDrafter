import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function UserMenu() {
  const { user, signOut } = useAuth();

  if (!user) return null;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      padding: '8px 16px',
      background: '#f9fafb',
      borderRadius: '6px',
      fontSize: '14px'
    }}>
      <span style={{ color: '#374151' }}>{user.email}</span>
      <Link
        to="/settings/notifications"
        style={{
          padding: '6px 12px',
          background: 'white',
          color: '#374151',
          border: '1px solid #d1d5db',
          borderRadius: '4px',
          textDecoration: 'none',
          fontSize: '14px',
          fontWeight: '500'
        }}
      >
        Notifications
      </Link>
      <button
        onClick={signOut}
        style={{
          padding: '6px 12px',
          background: 'white',
          color: '#374151',
          border: '1px solid #d1d5db',
          borderRadius: '4px',
          cursor: 'pointer',
          fontSize: '14px',
          fontWeight: '500'
        }}
      >
        Sign out
      </button>
    </div>
  );
}
