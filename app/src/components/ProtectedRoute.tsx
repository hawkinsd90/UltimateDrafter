import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useEffect } from 'react';

const RETURN_URL_KEY = 'auth_return_url';

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoadingAuth } = useAuth();
  const location = useLocation();

  useEffect(() => {
    if (!isLoadingAuth && !user && location.pathname !== '/login') {
      sessionStorage.setItem(RETURN_URL_KEY, `${location.pathname}${location.search}${location.hash}`);
    }
  }, [isLoadingAuth, user, location]);

  if (isLoadingAuth) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'system-ui, sans-serif',
        color: '#6b7280'
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: '40px',
            height: '40px',
            border: '3px solid #e5e7eb',
            borderTopColor: '#2563eb',
            borderRadius: '50%',
            margin: '0 auto 12px',
            animation: 'spin 0.8s linear infinite'
          }} />
          <style>{`
            @keyframes spin {
              to { transform: rotate(360deg); }
            }
          `}</style>
          Loading...
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login?reason=auth_required" replace />;
  }

  return <>{children}</>;
}
