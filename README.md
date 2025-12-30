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