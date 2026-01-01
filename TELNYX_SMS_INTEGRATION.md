# Telnyx SMS Integration - Testing Guide

This document describes the production-ready Telnyx SMS integration with phone verification.

## Overview

The system now supports:
- SMS sending via Telnyx API
- OTP-based phone verification
- User consent tracking
- Automatic retry with exponential backoff
- Delivery status tracking via webhooks
- Comprehensive security and rate limiting

## Architecture

### Database

**user_profile table**
- Stores phone numbers in E.164 format (+13135551234)
- Tracks verification status and timestamps
- Stores hashed OTP codes (never raw codes)
- Manages SMS consent flag
- Rate limiting: max 5 verification attempts per hour

### Edge Functions

1. **start-phone-verification**
   - Validates and normalizes phone number to E.164
   - Generates 6-digit OTP code
   - Hashes code with SHA-256 before storing
   - Enqueues verification SMS via notifications_outbox
   - Rate limits: 30s cooldown, 5 attempts/hour

2. **verify-phone-code**
   - Validates 6-digit code against hashed value
   - Marks phone as verified on success
   - Tracks failed attempts (max 10 per code)
   - Codes expire after 10 minutes
   - Optional SMS consent can be set during verification

3. **process-notifications-outbox** (updated)
   - Sends SMS via Telnyx Messaging API v2
   - Handles success/failure status updates
   - Implements exponential backoff (60s, 5m, 15m, 60m)
   - Max 6 retry attempts before marking as failed
   - Logs masked phone numbers (e.g., ******4567)

4. **telnyx-delivery-webhook**
   - Receives Telnyx delivery status callbacks
   - Updates notifications_outbox with delivery status
   - Tracks provider timestamps

5. **enqueue-notification** (updated)
   - Checks phone_verified = true for SMS
   - Checks sms_consent = true for SMS
   - Blocks SMS if verification or consent missing
   - Creates audit trail for blocked notifications

### Frontend

**PhoneVerification component**
- Two-step flow: phone entry → code verification
- SMS consent checkbox (required)
- Real-time cooldown timer for resend
- Attempts remaining counter
- Error handling with user-friendly messages
- Can be skipped (stored in sessionStorage)

**PhoneVerificationGate component**
- Wraps app to show verification modal on first login
- Checks user_profile.phone_verified status
- Allows skipping (persisted per session)
- Reloads profile after successful verification

## Configuration

### Environment Variables

Set in Supabase Edge Functions secrets:

```
TELNYX_API_KEY=KEY...  # Your Telnyx API key
TELNYX_FROM_NUMBER=+13135146003  # Your Telnyx long code
VERIFICATION_SALT=random-salt-value  # For OTP hashing (optional, has default)
```

### Telnyx Setup

1. Verify number is active: +13135146003
2. Configure messaging profile
3. Set webhook URL for delivery receipts:
   ```
   https://your-project.supabase.co/functions/v1/telnyx-delivery-webhook
   ```
4. Enable webhook events:
   - message.sent
   - message.finalized
   - message.delivery_failed

## Testing Guide

### Local Testing

1. **Start Development Server**
   ```bash
   npm run dev
   ```

2. **Create Test User**
   - Sign up via the app
   - Login with test credentials

3. **Phone Verification Flow**
   - Modal appears automatically after login
   - Enter phone number: +1 (555) 123-4567
   - Check SMS consent checkbox
   - Click "Send Code"
   - Check SMS inbox for 6-digit code
   - Enter code and click "Verify"

4. **Verify Database State**
   ```sql
   -- Check user profile
   SELECT user_id, phone_e164, phone_verified, sms_consent
   FROM user_profile;

   -- Check verification attempts
   SELECT user_id, phone_verification_attempts, phone_verification_sent_at
   FROM user_profile;
   ```

5. **Test SMS Sending**
   ```javascript
   // In browser console after login
   const session = (await supabase.auth.getSession()).data.session;

   await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/enqueue-notification`, {
     method: 'POST',
     headers: {
       'Authorization': `Bearer ${session.access_token}`,
       'Content-Type': 'application/json'
     },
     body: JSON.stringify({
       channel: 'sms',
       userId: session.user.id,
       messageText: 'Test SMS message from DraftMaster!'
     })
   });
   ```

6. **Check Outbox Processing**
   ```sql
   -- View pending notifications
   SELECT id, channel, destination, status, attempt_count, last_error
   FROM notifications_outbox
   ORDER BY created_at DESC
   LIMIT 10;

   -- View sent notifications
   SELECT id, channel, destination, status, provider, sent_at
   FROM notifications_outbox
   WHERE status = 'sent'
   ORDER BY sent_at DESC
   LIMIT 10;
   ```

### Rate Limit Testing

1. **Test Send Cooldown**
   - Send verification code
   - Try to resend immediately (should show 30s cooldown)
   - Wait 30s and try again (should succeed)

2. **Test Hourly Limit**
   - Send verification code 5 times
   - 6th attempt should return 429 error
   - Wait 1 hour or reset attempts in DB

3. **Test Verify Attempts**
   - Enter wrong code 10 times
   - 11th attempt should fail with "too many attempts"
   - Request new code to reset

### Error Scenarios

1. **Invalid Phone Number**
   - Enter: "12345"
   - Expected: "Invalid phone number" error

2. **Expired Code**
   - Wait 11 minutes after receiving code
   - Expected: "Verification code expired" error

3. **Wrong Code**
   - Enter: "000000"
   - Expected: "Invalid verification code" + attempts remaining

4. **No Verification**
   - Try to send SMS without phone verification
   - Expected: notification blocked with reason "Phone number not verified"

5. **No Consent**
   - Verify phone but don't check SMS consent
   - Try to send SMS
   - Expected: notification blocked with reason "SMS consent not granted"

### Delivery Status Testing

1. **Check Webhook URL**
   ```bash
   curl -X POST https://your-project.supabase.co/functions/v1/telnyx-delivery-webhook \
     -H "Content-Type: application/json" \
     -d '{
       "data": {
         "event_type": "message.sent",
         "payload": {
           "id": "test-message-id"
         }
       }
     }'
   ```

2. **Verify Delivery Updates**
   ```sql
   SELECT id, status, delivery_status, provider_delivered_at
   FROM notifications_outbox
   WHERE provider_message_id = 'actual-telnyx-message-id';
   ```

## Security Features

### Data Protection
- Phone numbers stored in E.164 format only
- OTP codes hashed with SHA-256 before storage
- Masked phone numbers in logs (e.g., ******4567)
- Never log raw OTP codes

### Rate Limiting
- 30 second cooldown between verification sends
- Max 5 verification sends per hour
- Max 10 code verification attempts
- Codes expire after 10 minutes

### Access Control
- RLS policies on user_profile table
- Users can only read/update own profile
- Verification fields (code_hash, verified) only writable via SECURITY DEFINER functions
- Edge functions use service role for sensitive operations

### Consent Management
- Explicit SMS consent required
- Consent checkbox during verification
- SMS blocked without consent
- Audit trail for all consent decisions

## Monitoring

### Audit Events
```sql
-- View verification events
SELECT event_type, user_id, metadata, created_at
FROM audit_events
WHERE event_type IN ('phone_verified', 'notification_blocked', 'notification_sent')
ORDER BY created_at DESC;
```

### Notification Status
```sql
-- Success rate
SELECT
  status,
  COUNT(*) as count,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 2) as percentage
FROM notifications_outbox
WHERE channel = 'sms'
GROUP BY status;

-- Retry distribution
SELECT
  attempt_count,
  COUNT(*) as count
FROM notifications_outbox
WHERE channel = 'sms' AND status IN ('sent', 'failed')
GROUP BY attempt_count
ORDER BY attempt_count;
```

### Error Analysis
```sql
-- Most common errors
SELECT
  last_error,
  COUNT(*) as count
FROM notifications_outbox
WHERE status IN ('failed', 'retry_scheduled')
  AND channel = 'sms'
GROUP BY last_error
ORDER BY count DESC
LIMIT 10;
```

## Troubleshooting

### SMS Not Received

1. Check user_profile:
   ```sql
   SELECT phone_e164, phone_verified, sms_consent
   FROM user_profile WHERE user_id = 'user-id';
   ```

2. Check notifications_outbox:
   ```sql
   SELECT status, last_error, attempt_count
   FROM notifications_outbox
   WHERE user_id = 'user-id' AND channel = 'sms'
   ORDER BY created_at DESC LIMIT 1;
   ```

3. Check Telnyx dashboard for delivery status

### Verification Code Not Sent

1. Check rate limits:
   ```sql
   SELECT phone_verification_attempts, phone_verification_sent_at
   FROM user_profile WHERE user_id = 'user-id';
   ```

2. Check outbox for verification messages:
   ```sql
   SELECT status, message_text, last_error
   FROM notifications_outbox
   WHERE user_id = 'user-id'
     AND channel = 'sms'
     AND message_text LIKE '%verification code%'
   ORDER BY created_at DESC;
   ```

### Phone Number Format Issues

Use utility functions for normalization:
```javascript
import { normalizePhoneToE164, validateE164 } from './utils/phone';

const normalized = normalizePhoneToE164('(555) 123-4567');
// Result: +15551234567

const isValid = validateE164('+15551234567');
// Result: true
```

## Next Steps

1. **Production Configuration**
   - Configure production Telnyx credentials
   - Set production webhook URL
   - Update ALLOWED_ORIGINS in enqueue-notification

2. **Monitoring Setup**
   - Set up alerts for high failure rates
   - Monitor rate limit hits
   - Track delivery success rates

3. **Future Enhancements**
   - Email fallback when SMS fails
   - International phone number support
   - SMS delivery reports to users
   - Voice call verification option
