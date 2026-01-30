import { Link } from 'react-router-dom';

export default function SmsConsent() {
  return (
    <div style={{ padding: '40px', fontFamily: 'system-ui, sans-serif', maxWidth: '800px', margin: '0 auto', minHeight: '100vh', background: '#1a2332', color: '#cbd5e0' }}>
      <Link to="/" style={{ color: '#10b981', textDecoration: 'none' }}>← Back to Home</Link>

      <h1 style={{ marginTop: '20px', color: '#ffffff' }}>SMS Consent & Messaging Information</h1>
      <p style={{ color: '#9ca3af' }}>Last updated: {new Date().toLocaleDateString()}</p>

      <section style={{ marginTop: '30px' }}>
        <h2 style={{ color: '#ffffff' }}>SMS Opt-In Workflow</h2>
        <p>Offline4ever DraftMaster uses SMS text messaging exclusively for account security and transactional notifications. Here is how the opt-in process works:</p>
        <ol>
          <li><strong>Phone Number Entry:</strong> You provide your mobile phone number during account setup</li>
          <li><strong>Explicit Consent:</strong> You check a consent checkbox acknowledging that you agree to receive SMS messages</li>
          <li><strong>OTP Verification:</strong> We send a one-time password (OTP) code to your phone number</li>
          <li><strong>Verification Complete:</strong> After you enter the correct code, your phone number is verified and active</li>
        </ol>
        <p>Messages are only sent after you complete this verification process and provide explicit consent.</p>
      </section>

      <section style={{ marginTop: '30px' }}>
        <h2 style={{ color: '#ffffff' }}>Visual Proof of SMS Opt-In & Phone Verification</h2>
        <p>Below is a screenshot of the actual phone verification and SMS consent interface that users see in the application:</p>

        <div style={{
          marginTop: '20px',
          marginBottom: '20px',
          background: '#2d3748',
          padding: '20px',
          borderRadius: '8px',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center'
        }}>
          <img
            src="/image.png"
            alt="Phone verification modal showing phone number input field, SMS & Voice Consent checkbox with full consent language including purposes (OTP verification, draft notifications, security alerts), message frequency notice, STOP/HELP instructions, no marketing statement, and express written consent confirmation. Send Code button is visible at the bottom."
            style={{
              maxWidth: '100%',
              height: 'auto',
              borderRadius: '8px',
              boxShadow: '0 4px 6px rgba(0, 0, 0, 0.3)'
            }}
          />
        </div>

        <p style={{
          fontSize: '14px',
          fontStyle: 'italic',
          color: '#9ca3af',
          marginTop: '10px',
          padding: '15px',
          background: '#2d3748',
          borderRadius: '6px',
          borderLeft: '4px solid #10b981'
        }}>
          <strong style={{ color: '#10b981' }}>Caption:</strong> After authentication, users are required to enter their phone number and explicitly confirm SMS & voice consent before receiving a one-time password (OTP). No messages are sent until this step is completed.
        </p>

        <div style={{
          marginTop: '20px',
          padding: '20px',
          background: '#2d3748',
          borderRadius: '8px',
          border: '1px solid #4a5568'
        }}>
          <h3 style={{ color: '#ffffff', marginTop: '0', marginBottom: '15px' }}>Complete Consent Flow Sequence</h3>
          <ol style={{ lineHeight: '1.8', color: '#cbd5e0' }}>
            <li><strong style={{ color: '#10b981' }}>Pre-Authentication Consent (Login Screen):</strong> Users must check the SMS & Voice consent checkbox on the login screen before they can authenticate with Google. This ensures consent is obtained before account creation.</li>
            <li><strong style={{ color: '#10b981' }}>Authentication:</strong> After providing consent, users complete Google authentication.</li>
            <li><strong style={{ color: '#10b981' }}>Phone Number Collection (Post-Authentication):</strong> Once authenticated, users are presented with the phone verification modal (shown above) where they enter their phone number and reconfirm their consent.</li>
            <li><strong style={{ color: '#10b981' }}>OTP Verification:</strong> Only after the user clicks "Send Code" with consent confirmed is an OTP message sent to their phone number for verification.</li>
          </ol>
          <p style={{ marginTop: '15px', marginBottom: '0', color: '#9ca3af', fontSize: '14px' }}>
            This multi-step process ensures explicit, informed consent at multiple touchpoints before any SMS or voice communication occurs.
          </p>
        </div>
      </section>

      <section style={{ marginTop: '30px' }}>
        <h2 style={{ color: '#ffffff' }}>What Messages We Send</h2>
        <p><strong style={{ color: '#ffffff' }}>Offline4ever DraftMaster collects phone numbers solely for account security and draft-related notifications. We do not send marketing messages.</strong></p>

        <h3 style={{ marginTop: '20px', color: '#ffffff' }}>1. OTP Verification Messages</h3>
        <p>When you verify your phone number, you will receive a message like:</p>
        <div style={{ background: '#2d3748', padding: '15px', borderRadius: '6px', fontFamily: 'monospace', marginTop: '10px', color: '#e2e8f0' }}>
          "Your Offline4ever DraftMaster verification code is: 123456"
        </div>

        <h3 style={{ marginTop: '20px', color: '#ffffff' }}>2. Draft Turn Notifications</h3>
        <p>When it's your turn to pick in a draft (if you have opted in to notifications), you will receive:</p>
        <div style={{ background: '#2d3748', padding: '15px', borderRadius: '6px', fontFamily: 'monospace', marginTop: '10px', color: '#e2e8f0' }}>
          "Offline4ever DraftMaster: It's your turn to pick in the draft. Please make your selection."
        </div>

        <h3 style={{ marginTop: '20px', color: '#ffffff' }}>3. Security Alerts</h3>
        <p>Critical account security notifications (e.g., password changes, suspicious login attempts)</p>
      </section>

      <section style={{ marginTop: '30px', padding: '20px', background: '#854d0e', borderRadius: '8px', border: '1px solid #a16207' }}>
        <h2 style={{ marginTop: '0', color: '#fef3c7' }}>Important: Transactional Messages Only</h2>
        <ul style={{ marginBottom: '0', color: '#fef3c7' }}>
          <li><strong>No marketing messages:</strong> We do not send promotional or marketing SMS</li>
          <li><strong>No spam:</strong> All messages are directly related to your account or draft activity</li>
          <li><strong>Transactional only:</strong> Messages are sent only for verification, draft turns, and security</li>
        </ul>
      </section>

      <section style={{ marginTop: '30px' }}>
        <h2 style={{ color: '#ffffff' }}>Opt-Out Instructions</h2>
        <p>You can opt out of draft notifications at any time:</p>
        <ul>
          <li><strong>Reply STOP:</strong> Text "STOP" in response to any message to unsubscribe from draft notifications</li>
          <li><strong>Reply HELP:</strong> Text "HELP" to receive support information</li>
          <li><strong>Account Settings:</strong> Manage your notification preferences in your account settings</li>
        </ul>
        <p><strong>Note:</strong> You cannot opt out of critical account security messages or OTP verification codes, as these are required for account functionality.</p>
      </section>

      <section style={{ marginTop: '30px' }}>
        <h2 style={{ color: '#ffffff' }}>Message Frequency</h2>
        <ul>
          <li><strong>OTP Messages:</strong> Sent only when you request phone verification (typically once during account setup)</li>
          <li><strong>Draft Notifications:</strong> Sent only when it's your turn in an active draft (frequency varies based on draft participation)</li>
          <li><strong>Security Alerts:</strong> Sent only when critical account security events occur (rare)</li>
        </ul>
      </section>

      <section style={{ marginTop: '30px' }}>
        <h2 style={{ color: '#ffffff' }}>Message and Data Rates</h2>
        <p>Message and data rates may apply based on your mobile carrier's plan. Offline4ever DraftMaster does not charge for SMS messages, but your carrier may charge for received messages depending on your plan.</p>
      </section>

      <section style={{ marginTop: '30px' }}>
        <h2 style={{ color: '#ffffff' }}>SMS Service Provider</h2>
        <p>We use Telnyx as our SMS delivery provider. Your phone number is shared with Telnyx solely for the purpose of delivering transactional messages.</p>
      </section>

      <section style={{ marginTop: '30px' }}>
        <h2 style={{ color: '#ffffff' }}>Contact and Support</h2>
        <p>For questions about SMS messaging or to request support:</p>
        <ul>
          <li><strong>Email:</strong> <a href="mailto:admin@offline4ever.com" style={{ color: '#10b981' }}>admin@offline4ever.com</a></li>
          <li><strong>Phone:</strong> +1 (734) 358-8854</li>
          <li><strong>Text "HELP":</strong> Reply to any SMS message with "HELP" for automated support</li>
        </ul>
      </section>

      <div style={{ marginTop: '50px', paddingTop: '20px', borderTop: '1px solid #2d3748' }}>
        <Link to="/privacy" style={{ color: '#10b981', textDecoration: 'none', marginRight: '20px' }}>Privacy Policy</Link>
        <Link to="/terms" style={{ color: '#10b981', textDecoration: 'none', marginRight: '20px' }}>Terms of Service</Link>
        <Link to="/about" style={{ color: '#10b981', textDecoration: 'none', marginRight: '20px' }}>About</Link>
        <Link to="/" style={{ color: '#10b981', textDecoration: 'none' }}>Home</Link>
      </div>
    </div>
  );
}
