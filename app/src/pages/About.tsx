import { Link } from 'react-router-dom';

export default function About() {
  return (
    <div style={{ padding: '40px', fontFamily: 'system-ui, sans-serif', maxWidth: '800px', margin: '0 auto', minHeight: '100vh', background: '#1a2332', color: '#cbd5e0' }}>
      <Link to="/" style={{ color: '#10b981', textDecoration: 'none' }}>← Back to Home</Link>

      <h1 style={{ marginTop: '20px', color: '#ffffff' }}>About Offline4ever DraftMaster</h1>

      <section style={{ marginTop: '30px' }}>
        <h2 style={{ color: '#ffffff' }}>What is Offline4ever DraftMaster?</h2>
        <p>Offline4ever DraftMaster is a provider-agnostic fantasy sports draft engine that enables users to organize and conduct fantasy sports drafts with real-time turn notifications.</p>
        <p>Our platform facilitates:</p>
        <ul>
          <li>Creation and management of fantasy sports leagues</li>
          <li>Organizing draft events for league participants</li>
          <li>Real-time SMS notifications for draft turn alerts</li>
          <li>Secure account verification via SMS OTP</li>
        </ul>
      </section>

      <section style={{ marginTop: '30px' }}>
        <h2 style={{ color: '#ffffff' }}>What We Are NOT</h2>
        <p><strong style={{ color: '#ffffff' }}>Offline4ever DraftMaster does NOT support gambling, wagering, or any cash prize competitions.</strong></p>
        <p>This platform is strictly for organizing fantasy sports drafts for recreational purposes. There are:</p>
        <ul>
          <li>No paid entry fees</li>
          <li>No cash prizes</li>
          <li>No wagering or betting</li>
          <li>No monetary transactions for draft participation</li>
        </ul>
      </section>

      <section style={{ marginTop: '30px' }}>
        <h2 style={{ color: '#ffffff' }}>How It Works</h2>
        <ol>
          <li>Users create a free account with email and phone verification</li>
          <li>League commissioners create leagues and draft events</li>
          <li>Participants join leagues and receive SMS notifications when it's their turn to draft</li>
          <li>All messaging is transactional - we do not send marketing or promotional messages</li>
        </ol>
      </section>

      <section style={{ marginTop: '30px', padding: '20px', background: '#2d3748', borderRadius: '8px' }}>
        <h2 style={{ marginTop: '0', color: '#ffffff' }}>Contact Information</h2>
        <p><strong>Business Name:</strong> Offline4ever DraftMaster</p>
        <p><strong>Email:</strong> <a href="mailto:admin@offline4ever.com" style={{ color: '#10b981' }}>admin@offline4ever.com</a></p>
        <p><strong>Phone:</strong> +1 (734) 358-8854</p>
        <p><strong>Location:</strong> Wayne, Michigan, USA</p>
      </section>

      <section style={{ marginTop: '30px' }}>
        <h2 style={{ color: '#ffffff' }}>Privacy and Terms</h2>
        <p>For information about how we handle your data and the terms governing use of this service, please review:</p>
        <ul>
          <li><Link to="/privacy" style={{ color: '#10b981' }}>Privacy Policy</Link></li>
          <li><Link to="/terms" style={{ color: '#10b981' }}>Terms of Service</Link></li>
          <li><Link to="/sms-consent" style={{ color: '#10b981' }}>SMS Consent Information</Link></li>
        </ul>
      </section>

      <div style={{ marginTop: '50px', paddingTop: '20px', borderTop: '1px solid #2d3748' }}>
        <Link to="/" style={{ color: '#10b981', textDecoration: 'none' }}>Home</Link>
      </div>
    </div>
  );
}
