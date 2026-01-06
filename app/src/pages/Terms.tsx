import { Link } from 'react-router-dom';

export default function Terms() {
  return (
    <div style={{ padding: '40px', fontFamily: 'system-ui, sans-serif', maxWidth: '800px', margin: '0 auto' }}>
      <Link to="/" style={{ color: '#2563eb', textDecoration: 'none' }}>← Back to Home</Link>

      <h1 style={{ marginTop: '20px' }}>Terms of Service</h1>
      <p style={{ color: '#6b7280' }}>Last updated: {new Date().toLocaleDateString()}</p>

      <section style={{ marginTop: '30px' }}>
        <h2>Acceptance of Terms</h2>
        <p>By accessing or using DraftMaster, you agree to be bound by these Terms of Service. If you do not agree to these terms, do not use the service.</p>
      </section>

      <section style={{ marginTop: '30px' }}>
        <h2>Service Provided As-Is</h2>
        <p>DraftMaster is provided on an "as-is" and "as-available" basis without warranties of any kind, either express or implied. We do not guarantee that the service will be uninterrupted, secure, or error-free.</p>
      </section>

      <section style={{ marginTop: '30px' }}>
        <h2>Account Responsibility</h2>
        <p>You are responsible for:</p>
        <ul>
          <li>Maintaining the confidentiality of your account credentials</li>
          <li>All activities that occur under your account</li>
          <li>Ensuring your account information (including phone number) is accurate and up-to-date</li>
          <li>Notifying us immediately of any unauthorized access to your account</li>
        </ul>
      </section>

      <section style={{ marginTop: '30px' }}>
        <h2>Acceptable Use</h2>
        <p>You agree not to:</p>
        <ul>
          <li>Use the service for any illegal or unauthorized purpose</li>
          <li>Interfere with or disrupt the service or servers</li>
          <li>Attempt to gain unauthorized access to any part of the service</li>
          <li>Use automated systems to access the service without permission</li>
          <li>Harass, abuse, or harm other users</li>
          <li>Upload or transmit malicious code or content</li>
        </ul>
      </section>

      <section style={{ marginTop: '30px' }}>
        <h2>SMS Consent Requirement</h2>
        <p>By providing your phone number, you expressly consent to receive SMS text messages from DraftMaster for:</p>
        <ul>
          <li>One-time password (OTP) verification codes</li>
          <li>Draft turn notifications (if you opt in)</li>
        </ul>
        <p>Consent to receive SMS messages is a condition of using certain features of the service. Message and data rates may apply based on your carrier's plan.</p>
      </section>

      <section style={{ marginTop: '30px' }}>
        <h2>SMS Opt-Out</h2>
        <p>You may opt out of draft notifications at any time by:</p>
        <ul>
          <li>Replying <strong>STOP</strong> to any SMS message</li>
          <li>Updating your notification preferences in account settings</li>
        </ul>
        <p>Opting out of notifications may impact your ability to participate effectively in time-sensitive drafts.</p>
      </section>

      <section style={{ marginTop: '30px' }}>
        <h2>User Content</h2>
        <p>You retain ownership of any content you create (league names, draft configurations, etc.). By using the service, you grant us a license to store and display this content as necessary to provide the service.</p>
      </section>

      <section style={{ marginTop: '30px' }}>
        <h2>Limitation of Liability</h2>
        <p>To the fullest extent permitted by law:</p>
        <ul>
          <li>DraftMaster and its operators shall not be liable for any indirect, incidental, special, consequential, or punitive damages</li>
          <li>Our total liability for any claims related to the service is limited to the amount you paid us in the last 12 months (if any)</li>
          <li>We are not responsible for any damages arising from service interruptions, data loss, or unauthorized access</li>
          <li>We are not liable for draft outcomes, disputes between users, or decisions made using the service</li>
        </ul>
      </section>

      <section style={{ marginTop: '30px' }}>
        <h2>Indemnification</h2>
        <p>You agree to indemnify and hold harmless DraftMaster and its operators from any claims, damages, losses, or expenses arising from your use of the service or violation of these terms.</p>
      </section>

      <section style={{ marginTop: '30px' }}>
        <h2>Service Modifications</h2>
        <p>We reserve the right to modify, suspend, or discontinue any part of the service at any time without notice. We may also update these Terms of Service periodically.</p>
      </section>

      <section style={{ marginTop: '30px' }}>
        <h2>Termination</h2>
        <p>We may terminate or suspend your account at any time for violation of these terms. You may also delete your account at any time through the service.</p>
      </section>

      <section style={{ marginTop: '30px' }}>
        <h2>Governing Law</h2>
        <p>These terms are governed by applicable laws. Any disputes shall be resolved in accordance with those laws.</p>
      </section>

      <section style={{ marginTop: '30px' }}>
        <h2>Contact</h2>
        <p>For questions about these Terms of Service, contact us through the app or at the email address associated with your account.</p>
      </section>

      <div style={{ marginTop: '50px', paddingTop: '20px', borderTop: '1px solid #e5e7eb' }}>
        <Link to="/privacy" style={{ color: '#2563eb', textDecoration: 'none', marginRight: '20px' }}>Privacy Policy</Link>
        <Link to="/" style={{ color: '#2563eb', textDecoration: 'none' }}>Home</Link>
      </div>
    </div>
  );
}
