import { Link } from 'react-router-dom';

export default function Privacy() {
  return (
    <div style={{ padding: '40px', fontFamily: 'system-ui, sans-serif', maxWidth: '800px', margin: '0 auto' }}>
      <Link to="/" style={{ color: '#2563eb', textDecoration: 'none' }}>← Back to Home</Link>

      <h1 style={{ marginTop: '20px' }}>Privacy Policy</h1>
      <p style={{ color: '#6b7280' }}>Last updated: {new Date().toLocaleDateString()}</p>

      <section style={{ marginTop: '30px' }}>
        <h2>Information We Collect</h2>
        <p>When you use DraftMaster, we collect:</p>
        <ul>
          <li><strong>Account Information:</strong> Email address and username</li>
          <li><strong>Phone Number:</strong> We collect your phone number for SMS-based one-time password (OTP) verification and draft notifications</li>
          <li><strong>League and Draft Data:</strong> Information about leagues, drafts, and participants you create or join</li>
        </ul>
      </section>

      <section style={{ marginTop: '30px' }}>
        <h2>SMS Verification and Notifications</h2>
        <p>We use SMS text messaging for:</p>
        <ul>
          <li><strong>Phone Verification:</strong> We send a one-time verification code to confirm your phone number</li>
          <li><strong>Draft Notifications:</strong> We send alerts when it's your turn to pick in a draft (if you opt in)</li>
        </ul>
        <p>By providing your phone number, you consent to receive these SMS messages. Message and data rates may apply based on your carrier's plan.</p>
      </section>

      <section style={{ marginTop: '30px' }}>
        <h2>SMS Opt-Out and Help</h2>
        <ul>
          <li><strong>Stop Notifications:</strong> Reply <strong>STOP</strong> to any message to opt out of draft notifications</li>
          <li><strong>Get Help:</strong> Reply <strong>HELP</strong> to receive support information</li>
        </ul>
        <p>You can also manage notification preferences in your account settings.</p>
      </section>

      <section style={{ marginTop: '30px' }}>
        <h2>Marketing Communications</h2>
        <p>We do not send marketing messages or promotional SMS. All text messages are transactional and related to account verification or draft activity you've explicitly opted into.</p>
      </section>

      <section style={{ marginTop: '30px' }}>
        <h2>How We Use Your Information</h2>
        <p>We use the information we collect to:</p>
        <ul>
          <li>Verify your identity and secure your account</li>
          <li>Facilitate draft participation and notifications</li>
          <li>Improve and maintain the DraftMaster service</li>
          <li>Communicate important service updates</li>
        </ul>
      </section>

      <section style={{ marginTop: '30px' }}>
        <h2>Data Security</h2>
        <p>We implement industry-standard security measures to protect your personal information, including phone numbers. However, no method of transmission over the Internet is 100% secure.</p>
      </section>

      <section style={{ marginTop: '30px' }}>
        <h2>Data Retention</h2>
        <p>We retain your information for as long as your account is active or as needed to provide services. You may request deletion of your account and associated data at any time.</p>
      </section>

      <section style={{ marginTop: '30px' }}>
        <h2>Third-Party Services</h2>
        <p>We use Telnyx as our SMS provider to deliver text messages. Your phone number is shared with this service provider solely for message delivery purposes.</p>
      </section>

      <section style={{ marginTop: '30px' }}>
        <h2>Contact Us</h2>
        <p>If you have questions about this Privacy Policy, please contact us through the app or at the email address associated with your account.</p>
      </section>

      <div style={{ marginTop: '50px', paddingTop: '20px', borderTop: '1px solid #e5e7eb' }}>
        <Link to="/terms" style={{ color: '#2563eb', textDecoration: 'none', marginRight: '20px' }}>Terms of Service</Link>
        <Link to="/" style={{ color: '#2563eb', textDecoration: 'none' }}>Home</Link>
      </div>
    </div>
  );
}
