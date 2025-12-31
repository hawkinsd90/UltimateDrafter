# DraftMaster

Provider-agnostic fantasy sports draft engine.

## MVP Security Model

**Current State (No Authentication):**
- All tables have strict Row Level Security (RLS) enabled
- Anonymous users have **READ-ONLY** access to all tables
- **NO public write access** - all INSERT/UPDATE/DELETE operations require authentication
- Authentication will be added in a future phase

**RLS Policy Summary:**
```
players              - SELECT: anon/authenticated
leagues              - SELECT: anon/authenticated | INSERT/UPDATE: authenticated (owner)
drafts               - SELECT: anon/authenticated | INSERT/UPDATE: authenticated (owner)
draft_participants   - SELECT: anon/authenticated | INSERT/UPDATE: authenticated (self)
draft_picks          - SELECT: anon/authenticated | INSERT: authenticated (participant)
notifications_outbox - SELECT: anon/authenticated | ALL: service_role
user_settings        - SELECT: anon/authenticated | INSERT/UPDATE: authenticated (self)
```

## Development Setup

### Prerequisites
- Node.js 18+
- Supabase account with project

### Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure environment variables:
   ```bash
   cp .env.example .env
   ```
   Edit `.env` with your Supabase credentials.

4. Run development server:
   ```bash
   npm run dev
   ```

### Seeding Players

The app requires players in the database to function. There are two methods:

**Method 1: Manual Seed Button (Recommended)**
1. Open the app in your browser
2. If no players exist, a "Seed Sample Players" button will appear on the home page
3. Click the button to populate the database with sample players via Edge Function

**Method 2: Supabase Dashboard**
1. Log into your Supabase dashboard
2. Navigate to the SQL Editor
3. Run this query to insert sample players:
   ```sql
   INSERT INTO players (name, position, team, sport, metadata)
   VALUES
     ('Patrick Mahomes', 'QB', 'Kansas City Chiefs', 'football', '{}'),
     ('Josh Allen', 'QB', 'Buffalo Bills', 'football', '{}'),
     -- Add more players as needed
   ```

## Notifications Outbox System

DraftMaster uses a reliable outbox pattern for all notifications (email, SMS, voice). All notifications are stored in the database first, then processed by a background worker.

### How It Works

1. **Enqueue**: Application calls `enqueueNotification()` which creates a row in `notifications_outbox`
2. **Validate**: System checks for destination availability and user consent (for SMS/Voice)
3. **Process**: Background worker (Edge Function) runs every minute via pg_cron
4. **Retry**: Failed notifications are retried with exponential backoff (1m, 5m, 15m, 60m)
5. **Audit**: All lifecycle events are logged to `audit_events` table

### Channel Status

- **Email**: Mock implementation (ready for SES integration)
- **SMS**: Queued + mocked (Telnyx integration pending)
- **Voice**: Queued + mocked (Telnyx integration pending)
- **Push**: Not implemented

**Note:** Draft turn events now trigger all three channels (email, SMS, voice). The edge function applies consent and destination gating automatically. Until Telnyx is enabled, SMS/Voice notifications are queued and marked as "sent" with mock provider responses.

### User Configuration

Users can configure notification preferences at `/settings/notifications`:
- Phone number (E.164 format)
- SMS consent (optional, default unchecked)
- Voice consent (optional, default unchecked)

**Important**: Notifications are optional. Users can use DraftMaster without providing a phone number.

### Manual Worker Trigger

To manually trigger the notification worker (useful for local development):

```sql
SELECT process_notifications_worker();
```

Or call the Edge Function directly:
```bash
curl -X POST \
  "${SUPABASE_URL}/functions/v1/process-notifications-outbox" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json"
```

### Testing End-to-End

**Manual Test Checklist:**

1. **Trigger a draft turn event:**
   - Create a league and draft
   - Add at least 2 participants with user accounts
   - Start the draft
   - Make a pick (this triggers the notification for the next user)
   - Check browser console for: `[DraftBoard] Notification enqueued:`

2. **Verify outbox row appears (pending):**
   ```sql
   SELECT id, channel, destination, status, message_text, created_at
   FROM notifications_outbox
   WHERE status = 'pending'
   ORDER BY created_at DESC
   LIMIT 5;
   ```

3. **Run worker (or wait for cron):**
   ```sql
   -- Manual trigger
   SELECT process_notifications_worker();
   ```
   Or wait up to 1 minute for automatic cron execution.

4. **Verify row becomes sent + audit_event exists:**
   ```sql
   -- Check notification status
   SELECT id, channel, status, sent_at, provider, provider_message_id
   FROM notifications_outbox
   ORDER BY created_at DESC
   LIMIT 5;

   -- Check audit trail
   SELECT event_type, created_at, payload
   FROM audit_events
   WHERE event_type IN ('notification_enqueued', 'notification_sent')
   ORDER BY created_at DESC
   LIMIT 10;
   ```

**Expected Behavior:**
- Status changes: `pending` → `processing` → `sent`
- `sent_at` timestamp is populated
- `provider` = 'mock' (until real providers are configured)
- Two audit events: `notification_enqueued` and `notification_sent`

### Monitoring

View recent notification activity:
```sql
-- Recent notifications
SELECT id, channel, destination, status, created_at, sent_at
FROM notifications_outbox
ORDER BY created_at DESC
LIMIT 20;

-- Recent audit events
SELECT event_type, created_at, payload
FROM audit_events
WHERE event_type LIKE 'notification_%'
ORDER BY created_at DESC
LIMIT 20;

-- Cron job status
SELECT * FROM cron.job_run_details
WHERE jobname = 'process-notifications-worker'
ORDER BY start_time DESC
LIMIT 10;
```

### Implementation Details

**Database Tables:**
- `notifications_outbox` - Queued notifications with retry logic
- `user_notification_settings` - Phone numbers and consent flags
- `audit_events` - Full lifecycle audit trail

**Key Files:**
- `app/src/utils/notifications.ts` - `enqueueNotification()` helper
- `app/src/types/notifications.ts` - TypeScript types and constants
- `app/src/pages/NotificationSettings.tsx` - User settings UI
- `supabase/functions/process-notifications-outbox/` - Background worker
- `supabase/migrations/*notifications*` - Database schema

## Project Structure

See [STRUCTURE.md](./STRUCTURE.md) for detailed architecture documentation.

## Roadmap

- [x] Core draft engine
- [x] RLS security policies
- [x] Player seeding via Edge Function
- [ ] Authentication (email/password via Supabase Auth)
- [ ] User-specific data access
- [ ] Offline-first capabilities
- [ ] Real-time draft updates