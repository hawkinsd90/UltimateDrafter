import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const STYLE_ID = 'user-menu-styles';

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = `
    .user-menu {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      background: #2d3748;
      border-radius: 6px;
      font-size: 14px;
      flex-shrink: 0;
      max-width: 100%;
      min-width: 0;
    }
    .user-menu-email {
      color: #cbd5e0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 160px;
      font-size: 13px;
    }
    .user-menu-btn {
      padding: 5px 10px;
      background: #1a2332;
      color: #cbd5e0;
      border: 1px solid #4a5568;
      border-radius: 4px;
      text-decoration: none;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      white-space: nowrap;
      flex-shrink: 0;
    }
    .user-menu-btn-admin {
      color: #f6ad55;
      border-color: #744210;
    }
    .user-menu-label {
      /* shown on desktop */
    }
    .user-menu-icon {
      display: none;
    }
    @media (max-width: 600px) {
      .user-menu {
        gap: 5px;
        padding: 4px 8px;
      }
      .user-menu-email {
        display: none;
      }
      .user-menu-label {
        display: none;
      }
      .user-menu-icon {
        display: inline;
      }
      .user-menu-btn {
        padding: 5px 8px;
        font-size: 13px;
      }
    }
  `;
  document.head.appendChild(el);
}

export default function UserMenu() {
  const { user, signOut, isAdmin } = useAuth();

  useEffect(() => { ensureStyles(); }, []);

  if (!user) return null;

  return (
    <div className="user-menu">
      <span className="user-menu-email">{user.email}</span>

      {isAdmin && (
        <Link to="/admin" className="user-menu-btn user-menu-btn-admin">
          <span className="user-menu-label">Admin</span>
          <span className="user-menu-icon" aria-label="Admin">⚙</span>
        </Link>
      )}

      <Link to="/settings/notifications" className="user-menu-btn">
        <span className="user-menu-label">Notifications</span>
        <span className="user-menu-icon" aria-label="Notifications">🔔</span>
      </Link>

      <button onClick={signOut} className="user-menu-btn">
        <span className="user-menu-label">Sign out</span>
        <span className="user-menu-icon" aria-label="Sign out">⏏</span>
      </button>
    </div>
  );
}
