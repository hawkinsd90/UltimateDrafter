import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import PhoneVerification from './PhoneVerification';

interface PhoneVerificationGateProps {
  children: React.ReactNode;
}

export default function PhoneVerificationGate({ children }: PhoneVerificationGateProps) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [showVerification, setShowVerification] = useState(false);

  useEffect(() => {
    if (user) {
      loadProfile();
    } else {
      setLoading(false);
    }
  }, [user]);

  async function loadProfile() {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('user_profile')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (error) throw error;

      const skipKey = `phone_verification_skipped_${user.id}`;
      const skipped = sessionStorage.getItem(skipKey);

      if (!data?.phone_verified && !skipped) {
        setShowVerification(true);
      }
    } catch (err) {
      console.error('Failed to load profile:', err);
    } finally {
      setLoading(false);
    }
  }

  function handleVerified() {
    setShowVerification(false);
    loadProfile();
  }

  function handleSkip() {
    if (user) {
      const skipKey = `phone_verification_skipped_${user.id}`;
      sessionStorage.setItem(skipKey, 'true');
    }
    setShowVerification(false);
  }

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh'
      }}>
        Loading...
      </div>
    );
  }

  return (
    <>
      {children}
      {showVerification && (
        <PhoneVerification onVerified={handleVerified} onSkip={handleSkip} />
      )}
    </>
  );
}
