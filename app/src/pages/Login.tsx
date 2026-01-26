import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const RETURN_URL_KEY = 'auth_return_url';

export default function Login() {
  const { user, isLoadingAuth, signInWithGoogle } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [isCheckingRouting, setIsCheckingRouting] = useState(false);
  const [smsConsent, setSmsConsent] = useState(false);

  const reason = searchParams.get('reason');

  const reasonMessages: Record<string, string> = {
    'signed_out': 'You have been signed out.',
    'auth_required': 'Please sign in to continue.',
    'session_expired': 'Your session has expired. Please sign in again.'
  };

  useEffect(() => {
    if (!isLoadingAuth && user) {
      handlePostLoginRouting();
    }
  }, [user, isLoadingAuth]);

  async function handlePostLoginRouting() {
    setIsCheckingRouting(true);

    const returnUrl = sessionStorage.getItem(RETURN_URL_KEY);
    if (returnUrl && returnUrl.startsWith('/')) {
      sessionStorage.removeItem(RETURN_URL_KEY);
      navigate(returnUrl);
      return;
    }

    // SECURITY TODO: Post-login routing is intentionally simplified during MVP
    //
    // CURRENT BEHAVIOR:
    // - Always routes to /leagues where leagues are currently visible to all
    //   authenticated users by design during MVP.
    // - "Most recent league" auto-routing is DISABLED because we cannot safely
    //   determine ownership when all leagues are visible to everyone.
    //
    // REASON:
    // The leagues table SELECT policy is currently permissive (all authenticated
    // users can view all leagues). This was a deliberate MVP choice to enable
    // testing and feature development without access control blocking progress.
    //
    // BEFORE PRODUCTION:
    // 1. Tighten leagues SELECT RLS to restrict by ownership or membership
    // 2. Re-enable "most recent league" routing logic here
    // 3. Add league-level access guards on routes like /leagues/:id
    //
    // See SECURITY_TODO.md for full checklist and test plan.
    navigate('/leagues');
    setIsCheckingRouting(false);
  }

  if (isLoadingAuth || isCheckingRouting) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'system-ui, sans-serif',
        background: '#f9fafb'
      }}>
        <div style={{ textAlign: 'center', color: '#6b7280' }}>
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
          {isCheckingRouting ? 'Setting up your dashboard...' : 'Loading...'}
        </div>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'system-ui, sans-serif',
      background: '#f9fafb'
    }}>
      <div style={{
        background: 'white',
        padding: '40px',
        borderRadius: '8px',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
        textAlign: 'center',
        maxWidth: '400px',
        width: '100%'
      }}>
        {reason && reasonMessages[reason] && (
          <div style={{
            marginBottom: '20px',
            padding: '12px',
            background: '#fef3c7',
            border: '1px solid #f59e0b',
            borderRadius: '6px',
            color: '#92400e',
            fontSize: '14px'
          }}>
            {reasonMessages[reason]}
          </div>
        )}

        <h1 style={{ marginBottom: '10px', fontSize: '24px', fontWeight: '600' }}>
          Welcome to DraftMaster
        </h1>
        <p style={{ color: '#6b7280', marginBottom: '30px' }}>
          Sign in to manage your fantasy drafts
        </p>

        <div style={{
          padding: '20px',
          background: '#f3f4f6',
          borderRadius: '8px',
          marginBottom: '24px',
          border: '1px solid #d1d5db',
          textAlign: 'left'
        }}>
          <label style={{ display: 'flex', alignItems: 'start', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={smsConsent}
              onChange={(e) => setSmsConsent(e.target.checked)}
              style={{
                marginTop: '4px',
                marginRight: '12px',
                width: '18px',
                height: '18px',
                flexShrink: 0,
                cursor: 'pointer'
              }}
              required
            />
            <div style={{ fontSize: '14px', color: '#1f2937', lineHeight: '1.6' }}>
              <strong style={{ display: 'block', marginBottom: '8px', fontSize: '15px' }}>SMS & Voice Consent</strong>
              <p style={{ margin: '0 0 8px 0' }}>
                I agree to receive SMS text messages and automated voice calls from Offline4ever DraftMaster for the following purposes:
              </p>
              <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
                <li>One-time password (OTP) verification codes</li>
                <li>Draft turn and draft-related notifications</li>
                <li>Account security alerts</li>
              </ul>
              <p style={{ margin: '8px 0 0 0', fontSize: '13px', color: '#4b5563' }}>
                Message frequency varies. Message and data rates may apply.
                Reply STOP to opt out at any time or HELP for help.
              </p>
              <p style={{ margin: '8px 0 0 0', fontSize: '13px', color: '#4b5563' }}>
                Offline4ever DraftMaster does not send marketing or promotional messages.
              </p>
              <p style={{ margin: '8px 0 0 0', fontSize: '13px', color: '#4b5563' }}>
                By checking this box, I provide my express written consent to receive these communications.
              </p>
            </div>
          </label>
        </div>

        <button
          onClick={() => {
            if (smsConsent) {
              sessionStorage.setItem('pending_sms_consent', JSON.stringify({
                consent: true,
                timestamp: new Date().toISOString(),
                source: 'login_screen'
              }));
              signInWithGoogle();
            }
          }}
          disabled={!smsConsent}
          style={{
            width: '100%',
            padding: '12px 24px',
            background: smsConsent ? 'white' : '#e5e7eb',
            color: smsConsent ? '#374151' : '#9ca3af',
            border: `1px solid ${smsConsent ? '#d1d5db' : '#d1d5db'}`,
            borderRadius: '6px',
            cursor: smsConsent ? 'pointer' : 'not-allowed',
            fontWeight: '500',
            fontSize: '16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '12px',
            transition: 'all 0.2s',
            opacity: smsConsent ? 1 : 0.6
          }}
          onMouseOver={(e) => {
            if (smsConsent) {
              e.currentTarget.style.background = '#f9fafb';
              e.currentTarget.style.borderColor = '#9ca3af';
            }
          }}
          onMouseOut={(e) => {
            if (smsConsent) {
              e.currentTarget.style.background = 'white';
              e.currentTarget.style.borderColor = '#d1d5db';
            }
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Continue with Google
        </button>

        <p style={{
          marginTop: '16px',
          fontSize: '13px',
          color: '#9ca3af'
        }}>
          Creates an account if you don't have one
        </p>
      </div>
    </div>
  );
}
