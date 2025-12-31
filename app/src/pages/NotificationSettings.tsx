import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import UserMenu from '../components/UserMenu';
import { CONSENT_TEXT, CONSENT_TEXT_VERSION } from '../types/notifications';
import { formatPhoneForE164, validateE164PhoneNumber } from '../utils/notifications';

export default function NotificationSettings() {
  const { user } = useAuth();
  const [phoneInput, setPhoneInput] = useState('');
  const [consentSMS, setConsentSMS] = useState(false);
  const [consentVoice, setConsentVoice] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      loadSettings();
    }
  }, [user]);

  async function loadSettings() {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('user_notification_settings')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setPhoneInput(data.phone_e164 || '');
        setConsentSMS(data.consent_sms);
        setConsentVoice(data.consent_voice);
      }
    } catch (err) {
      console.error('Failed to load notification settings:', err);
      setError('Failed to load settings');
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!user) return;

    setError(null);
    setSuccess(null);
    setSaving(true);

    try {
      let formattedPhone: string | null = null;

      if (phoneInput.trim()) {
        formattedPhone = formatPhoneForE164(phoneInput.trim());

        if (!formattedPhone || !validateE164PhoneNumber(formattedPhone)) {
          setError('Please enter a valid phone number (e.g., +1234567890 or 234-567-8900)');
          setSaving(false);
          return;
        }
      }

      if ((consentSMS || consentVoice) && !formattedPhone) {
        setError('Phone number is required to enable SMS or Voice notifications');
        setSaving(false);
        return;
      }

      const settingsData = {
        user_id: user.id,
        phone_e164: formattedPhone,
        consent_sms: formattedPhone ? consentSMS : false,
        consent_voice: formattedPhone ? consentVoice : false,
        consent_updated_at: new Date().toISOString(),
        consent_text_version: CONSENT_TEXT_VERSION
      };

      const { error: upsertError } = await supabase
        .from('user_notification_settings')
        .upsert(settingsData, { onConflict: 'user_id' });

      if (upsertError) throw upsertError;

      setSuccess('Notification settings saved successfully');
      await loadSettings();
    } catch (err) {
      console.error('Failed to save notification settings:', err);
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div style={{ padding: '40px' }}>Loading...</div>;
  }

  return (
    <div style={{ padding: '40px', fontFamily: 'system-ui, sans-serif', maxWidth: '800px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <Link to="/" style={{ color: '#2563eb', textDecoration: 'none' }}>← Home</Link>
        <UserMenu />
      </div>

      <h1 style={{ marginBottom: '10px' }}>Notification Settings</h1>
      <p style={{ color: '#6b7280', marginBottom: '30px' }}>
        Configure how you receive draft notifications (optional).
      </p>

      {error && (
        <div style={{
          padding: '12px 16px',
          marginBottom: '20px',
          background: '#fee',
          border: '1px solid #fcc',
          borderRadius: '6px',
          color: '#c00'
        }}>
          {error}
        </div>
      )}

      {success && (
        <div style={{
          padding: '12px 16px',
          marginBottom: '20px',
          background: '#efe',
          border: '1px solid #cfc',
          borderRadius: '6px',
          color: '#060'
        }}>
          {success}
        </div>
      )}

      <div style={{
        background: 'white',
        border: '1px solid #e5e7eb',
        borderRadius: '8px',
        padding: '30px'
      }}>
        <div style={{ marginBottom: '24px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>
            Phone Number
          </label>
          <input
            type="tel"
            value={phoneInput}
            onChange={(e) => setPhoneInput(e.target.value)}
            placeholder="+1 (234) 567-8900"
            style={{
              width: '100%',
              padding: '10px',
              border: '1px solid #d1d5db',
              borderRadius: '6px',
              fontSize: '16px'
            }}
          />
          <p style={{ fontSize: '14px', color: '#6b7280', marginTop: '6px' }}>
            Enter your phone number in E.164 format (e.g., +1234567890) or US format.
          </p>
        </div>

        <div style={{ marginBottom: '24px' }}>
          <h3 style={{ marginBottom: '12px', fontSize: '16px', fontWeight: '500' }}>
            Notification Preferences
          </h3>

          <label style={{
            display: 'flex',
            alignItems: 'center',
            padding: '12px',
            marginBottom: '10px',
            border: '1px solid #e5e7eb',
            borderRadius: '6px',
            cursor: 'pointer'
          }}>
            <input
              type="checkbox"
              checked={consentSMS}
              onChange={(e) => setConsentSMS(e.target.checked)}
              disabled={!phoneInput.trim()}
              style={{ marginRight: '10px', width: '18px', height: '18px', cursor: 'pointer' }}
            />
            <div>
              <div style={{ fontWeight: '500' }}>SMS Draft Alerts (Optional)</div>
              <div style={{ fontSize: '14px', color: '#6b7280' }}>
                Receive text messages when it's your turn to draft
              </div>
            </div>
          </label>

          <label style={{
            display: 'flex',
            alignItems: 'center',
            padding: '12px',
            border: '1px solid #e5e7eb',
            borderRadius: '6px',
            cursor: 'pointer'
          }}>
            <input
              type="checkbox"
              checked={consentVoice}
              onChange={(e) => setConsentVoice(e.target.checked)}
              disabled={!phoneInput.trim()}
              style={{ marginRight: '10px', width: '18px', height: '18px', cursor: 'pointer' }}
            />
            <div>
              <div style={{ fontWeight: '500' }}>Voice Draft Alerts (Optional)</div>
              <div style={{ fontSize: '14px', color: '#6b7280' }}>
                Receive automated phone calls when it's your turn to draft
              </div>
            </div>
          </label>
        </div>

        <div style={{
          padding: '16px',
          background: '#f9fafb',
          border: '1px solid #e5e7eb',
          borderRadius: '6px',
          marginBottom: '24px'
        }}>
          <h4 style={{ margin: '0 0 8px 0', fontSize: '14px', fontWeight: '500' }}>
            Terms & Conditions
          </h4>
          <p style={{ margin: 0, fontSize: '13px', color: '#6b7280', lineHeight: '1.5' }}>
            {CONSENT_TEXT}
          </p>
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            padding: '12px 24px',
            background: saving ? '#9ca3af' : '#059669',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            fontSize: '16px',
            fontWeight: '500',
            cursor: saving ? 'not-allowed' : 'pointer'
          }}
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </button>

        <div style={{ marginTop: '24px', paddingTop: '24px', borderTop: '1px solid #e5e7eb' }}>
          <p style={{ fontSize: '13px', color: '#6b7280', margin: 0 }}>
            <strong>Note:</strong> Notification settings are optional. You can use DraftMaster
            without providing a phone number. Email notifications are automatically enabled
            using your account email.
          </p>
        </div>
      </div>
    </div>
  );
}
