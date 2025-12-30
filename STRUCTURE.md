# DraftMaster (Offline4Ever) - Project Structure

## Overview

Provider-agnostic fantasy sports draft engine built with Supabase, React, and TypeScript.

## Directory Structure

```
/
├── index.html                      # Landing page (Telnyx compliance - DO NOT MODIFY)
├── package.json                    # Project dependencies
├── vite.config.ts                  # Vite configuration (root: './app')
├── tsconfig.json                   # TypeScript configuration
├── .env                            # Environment variables (gitignored)
├── .env.example                    # Environment variable template
│
├── /app                            # Application code
│   ├── index.html                  # App entry point
│   ├── README.md                   # App-specific documentation
│   └── /src
│       ├── main.tsx                # React bootstrap
│       ├── App.tsx                 # Root component
│       ├── /lib
│       │   └── supabase.ts         # Supabase client (singleton)
│       └── /types
│           └── supabase.ts         # Generated database types
│
└── /supabase
    ├── /migrations                 # Database migrations
    │   └── *.sql
    └── /functions                  # Edge Functions
        └── /process-notifications
            └── index.ts            # Notification processor
```

## Environment Variables

### Frontend (VITE_ prefix)
- `VITE_SUPABASE_URL` - Supabase project URL
- `VITE_SUPABASE_ANON_KEY` - Supabase anonymous key (safe for frontend)

### Backend (Edge Functions)
- `SUPABASE_URL` - Auto-configured in Supabase environment
- `SUPABASE_SERVICE_ROLE_KEY` - Auto-configured in Supabase environment

**IMPORTANT**: Never commit `.env` file. Use `.env.example` as template only.

## Database Tables

All tables have Row Level Security (RLS) enabled:

1. **leagues** - League metadata and settings
2. **drafts** - Draft sessions (snake/linear/auction support)
3. **players** - Provider-agnostic player database
4. **draft_participants** - User-draft associations with positions
5. **draft_picks** - Complete pick history
6. **notifications_outbox** - SMS/email notification queue (service role only)
7. **user_settings** - User notification preferences

## Supabase Client Usage

Import the singleton client:

```typescript
import { supabase } from './lib/supabase';

// Type-safe queries
const { data, error } = await supabase
  .from('leagues')
  .select('*')
  .eq('owner_id', userId);
```

## Type Safety

All database operations are fully typed:

```typescript
import type { Database } from './types/supabase';

type League = Database['public']['Tables']['leagues']['Row'];
type DraftInsert = Database['public']['Tables']['drafts']['Insert'];
type DraftUpdate = Database['public']['Tables']['drafts']['Update'];
```

## Edge Functions

### process-notifications

Processes pending notifications from the outbox queue.

**Endpoint**: `${VITE_SUPABASE_URL}/functions/v1/process-notifications`

**Purpose**:
- Reads pending notifications from `notifications_outbox`
- Marks them as sent/failed
- Uses service role key (auto-configured)
- Does NOT call external APIs yet (placeholder)

**Authentication**: Requires Bearer token with anon key

## Build & Development

```bash
# Install dependencies
npm install

# Build for production
npm run build

# Development server
npm run dev
```

## Key Constraints

1. **Landing Page**: `/index.html` must remain intact for Telnyx compliance
2. **App Code**: All application code lives in `/app` directory
3. **Environment**: Never commit `.env` file
4. **Security**: All tables use RLS policies
5. **Types**: Database types auto-generated from schema

## Architecture Principles

- Single Supabase client instance (no duplicates)
- Type-safe database operations
- Row Level Security on all tables
- Provider-agnostic design (no ESPN/Sleeper dependencies)
- Transactional notifications only
