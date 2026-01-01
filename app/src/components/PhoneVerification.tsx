import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { normalizePhoneToE164, formatPhoneDisplay } from '../utils/phone';

interface PhoneVerificationProps {
  onVerified: () => void;
  onSkip?: () => void;
}

export default function PhoneVerification({ onVerified, onSkip }: PhoneVerificationProps) {
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [smsConsent, setSmsConsent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(null);

  useEffect(() => {
    if (resendCooldown > 0) {
      const timer = setTimeout(() => setResendCooldown(resendCooldown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [resendCooldown]);

  async function handleSendCode() {
    setError('');
    setLoading(true);

    const phoneE164 = normalizePhoneToE164(phone);

    if (!phoneE164) {
      setError('Please enter a valid phone number');
      setLoading(false);
      return;
    }

    try {
      console.log('Supabase URL:', import.meta.env.VITE_SUPABASE_URL);
      console.log('Sending verification request for phone:', phoneE164);

      const { data, error } = await supabase.functions.invoke('start-phone-verification', {
        body: { phone: phoneE164 }
      });

      console.log('Invoke result:', { data, error });

      if (error) {
        if (error.message?.includes('429')) {
          setError('Too many attempts. Please wait before trying again.');
          setResendCooldown(30);
        } else {
          setError(error.message || 'Failed to send verification code');
        }
        setLoading(false);
        return;
      }

      if (data?.error) {
        if (data.retryAfter) {
          setError(data.error);
          setResendCooldown(data.retryAfter);
        } else {
          setError(data.error);
        }
        setLoading(false);
        return;
      }

      setStep('code');
      setResendCooldown(30);
      setLoading(false);
    } catch (err) {
      console.error('Error sending code:', err);
      setError('Failed to send code. Please try again.');
      setLoading(false);
    }
  }

  async function handleVerifyCode() {
    setError('');
    setLoading(true);

    if (!code || code.length !== 6) {
      setError('Please enter the 6-digit code');
      setLoading(false);
      return;
    }

    try {
      console.log('Verifying code:', code.substring(0, 2) + '****');

      const { data, error } = await supabase.functions.invoke('verify-phone-code', {
        body: { code, smsConsent }
      });

      console.log('Verify result:', { data, error });

      if (error) {
        setError(error.message || 'Failed to verify code');
        setLoading(false);
        return;
      }

      if (data?.error) {
        setError(data.error || 'Invalid verification code');
        if (data.attemptsLeft !== undefined) {
          setAttemptsLeft(data.attemptsLeft);
        }
        setLoading(false);
        return;
      }

      onVerified();
    } catch (err) {
      console.error('Error verifying code:', err);
      setError('Failed to verify code. Please try again.');
      setLoading(false);
    }
  }

  async function handleResend() {
    setCode('');
    setAttemptsLeft(null);
    await handleSendCode();
  }

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0, 0, 0, 0.7)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      padding: '20px'
    }}>
      <div style={{
        background: 'white',
        borderRadius: '12px',
        padding: '32px',
        maxWidth: '500px',
        width: '100%',
        boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)'
      }}>
        <h2 style={{ margin: '0 0 12px 0', fontSize: '24px', fontWeight: '600' }}>
          {step === 'phone' ? 'Verify Your Phone Number' : 'Enter Verification Code'}
        </h2>

        <p style={{ margin: '0 0 24px 0', color: '#6b7280', lineHeight: '1.5' }}>
          {step === 'phone'
            ? 'We need to verify your phone number to send you draft notifications via SMS.'
            : `We sent a 6-digit code to ${formatPhoneDisplay(normalizePhoneToE164(phone) || phone)}`
          }
        </p>

        {step === 'phone' ? (
          <>
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500', fontSize: '14px' }}>
                Phone Number
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+1 (555) 123-4567"
                style={{
                  width: '100%',
                  padding: '12px',
                  border: '1px solid #d1d5db',
                  borderRadius: '8px',
                  fontSize: '16px'
                }}
              />
              <p style={{ margin: '6px 0 0 0', fontSize: '13px', color: '#6b7280' }}>
                Enter your phone number with country code
              </p>
            </div>

            <div style={{
              padding: '16px',
              background: '#f3f4f6',
              borderRadius: '8px',
              marginBottom: '20px'
            }}>
              <label style={{ display: 'flex', alignItems: 'start', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={smsConsent}
                  onChange={(e) => setSmsConsent(e.target.checked)}
                  style={{ marginTop: '2px', marginRight: '10px' }}
                />
                <span style={{ fontSize: '14px', color: '#374151', lineHeight: '1.5' }}>
                  I agree to receive SMS notifications for draft activity. Message and data rates may apply.
                </span>
              </label>
            </div>

            {error && (
              <div style={{
                padding: '12px',
                background: '#fee2e2',
                border: '1px solid #ef4444',
                borderRadius: '6px',
                color: '#dc2626',
                marginBottom: '20px',
                fontSize: '14px'
              }}>
                {error}
              </div>
            )}

            <div style={{ display: 'flex', gap: '12px' }}>
              {onSkip && (
                <button
                  onClick={onSkip}
                  disabled={loading}
                  style={{
                    flex: 1,
                    padding: '12px 24px',
                    background: 'white',
                    color: '#374151',
                    border: '1px solid #d1d5db',
                    borderRadius: '8px',
                    cursor: loading ? 'not-allowed' : 'pointer',
                    fontWeight: '500',
                    fontSize: '16px'
                  }}
                >
                  Skip for now
                </button>
              )}
              <button
                onClick={handleSendCode}
                disabled={loading || !phone || !smsConsent || resendCooldown > 0}
                style={{
                  flex: 1,
                  padding: '12px 24px',
                  background: (loading || !phone || !smsConsent || resendCooldown > 0) ? '#9ca3af' : '#059669',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: (loading || !phone || !smsConsent || resendCooldown > 0) ? 'not-allowed' : 'pointer',
                  fontWeight: '500',
                  fontSize: '16px'
                }}
              >
                {loading ? 'Sending...' : resendCooldown > 0 ? `Wait ${resendCooldown}s` : 'Send Code'}
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500', fontSize: '14px' }}>
                Verification Code
              </label>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                maxLength={6}
                style={{
                  width: '100%',
                  padding: '12px',
                  border: '1px solid #d1d5db',
                  borderRadius: '8px',
                  fontSize: '24px',
                  letterSpacing: '8px',
                  textAlign: 'center'
                }}
                autoFocus
              />
              {attemptsLeft !== null && (
                <p style={{ margin: '6px 0 0 0', fontSize: '13px', color: '#dc2626' }}>
                  {attemptsLeft > 0
                    ? `${attemptsLeft} attempts remaining`
                    : 'Too many failed attempts. Please request a new code.'
                  }
                </p>
              )}
            </div>

            {error && (
              <div style={{
                padding: '12px',
                background: '#fee2e2',
                border: '1px solid #ef4444',
                borderRadius: '6px',
                color: '#dc2626',
                marginBottom: '20px',
                fontSize: '14px'
              }}>
                {error}
              </div>
            )}

            <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
              <button
                onClick={() => setStep('phone')}
                disabled={loading}
                style={{
                  flex: 1,
                  padding: '12px 24px',
                  background: 'white',
                  color: '#374151',
                  border: '1px solid #d1d5db',
                  borderRadius: '8px',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  fontWeight: '500',
                  fontSize: '16px'
                }}
              >
                Change Number
              </button>
              <button
                onClick={handleVerifyCode}
                disabled={loading || code.length !== 6}
                style={{
                  flex: 1,
                  padding: '12px 24px',
                  background: (loading || code.length !== 6) ? '#9ca3af' : '#059669',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: (loading || code.length !== 6) ? 'not-allowed' : 'pointer',
                  fontWeight: '500',
                  fontSize: '16px'
                }}
              >
                {loading ? 'Verifying...' : 'Verify'}
              </button>
            </div>

            <div style={{ textAlign: 'center' }}>
              <button
                onClick={handleResend}
                disabled={loading || resendCooldown > 0}
                style={{
                  background: 'none',
                  border: 'none',
                  color: resendCooldown > 0 ? '#9ca3af' : '#2563eb',
                  cursor: (loading || resendCooldown > 0) ? 'not-allowed' : 'pointer',
                  textDecoration: 'underline',
                  fontSize: '14px'
                }}
              >
                {resendCooldown > 0
                  ? `Resend code in ${resendCooldown}s`
                  : 'Resend code'
                }
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
