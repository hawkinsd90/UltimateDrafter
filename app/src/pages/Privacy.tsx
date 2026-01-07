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
        <h2>Phone Number Collection and SMS Usage</h2>
        <p><strong>Offline4ever DraftMaster collects phone numbers solely for account security and draft-related notifications. We do not send marketing or promotional messages.</strong></p>
        <p>We use SMS text messaging exclusively for:</p>
        <ul>
          <li><strong>SMS OTP Verification:</strong> We send one-time password (OTP) codes to verify your phone number and secure your account</li>
          <li><strong>Draft Turn Notifications:</strong> We send alerts when it's your turn to pick in a draft (only if you opt in)</li>
          <li><strong>Security Alerts:</strong> Critical account security notifications when necessary</li>
        </ul>
        <p>By providing your phone number and completing verification, you consent to receive these SMS messages. Message and data rates may apply based on your carrier's plan.</p>
      </section>

      <section style={{ marginTop: '30px' }}>
        <h2>SMS Opt-Out and Help</h2>
        <ul>
          <li><strong>Stop Notifications:</strong> Reply <strong>STOP</strong> to any message to opt out of draft notifications</li>
          <li><strong>Get Help:</strong> Reply <strong>HELP</strong> to receive support information</li>
        </ul>
        <p>You can also manage notification preferences in your account settings. For more information about our SMS practices, see our <Link to="/sms-consent" style={{ color: '#2563eb' }}>SMS Consent page</Link>.</p>
      </section>

      <section style={{ marginTop: '30px' }}>
        <h2>Marketing Communications</h2>
        <p><strong>We do not send marketing messages.</strong> All SMS text messages from Offline4ever DraftMaster are transactional and related exclusively to:</p>
        <ul>
          <li>Account verification (OTP codes)</li>
          <li>Draft turn notifications (if opted in)</li>
          <li>Critical security alerts</li>
        </ul>
        <p>We will never send promotional, advertising, or marketing messages via SMS.</p>
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
        <p>If you have questions about this Privacy Policy, please contact us:</p>
        <ul>
          <li><strong>Email:</strong> <a href="mailto:admin@offline4ever.com" style={{ color: '#2563eb' }}>admin@offline4ever.com</a></li>
          <li><strong>Phone:</strong> +1 (734) 358-8854</li>
          <li><strong>Location:</strong> Wayne, Michigan, USA</li>
        </ul>
      </section>

      <div style={{ marginTop: '50px', paddingTop: '20px', borderTop: '1px solid #e5e7eb' }}>
        <Link to="/terms" style={{ color: '#2563eb', textDecoration: 'none', marginRight: '20px' }}>Terms of Service</Link>
        <Link to="/sms-consent" style={{ color: '#2563eb', textDecoration: 'none', marginRight: '20px' }}>SMS Consent</Link>
        <Link to="/about" style={{ color: '#2563eb', textDecoration: 'none', marginRight: '20px' }}>About</Link>
        <Link to="/" style={{ color: '#2563eb', textDecoration: 'none' }}>Home</Link>
      </div>
    </div>
  );
}
