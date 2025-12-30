# DraftMaster Application

Provider-agnostic fantasy sports draft engine built on Supabase.

## Project Structure

```
/app
├── index.html              # Application entry point
└── src/
    ├── main.tsx            # React application bootstrap
    ├── App.tsx             # Root React component
    ├── lib/
    │   └── supabase.ts     # Supabase client (singleton)
    └── types/
        └── supabase.ts     # Generated database types
```

## Environment Variables

Required environment variables (configured in `.env`):

- `VITE_SUPABASE_URL` - Your Supabase project URL
- `VITE_SUPABASE_ANON_KEY` - Your Supabase anonymous key

See `.env.example` for template.

## Supabase Client

The Supabase client is initialized once in `/app/src/lib/supabase.ts` and exported for reuse throughout the application.

```typescript
import { supabase } from './lib/supabase';
```

## Database Schema

The following tables are available with Row Level Security enabled:

- **leagues** - League information and settings
- **drafts** - Draft sessions (snake/linear/auction)
- **players** - Provider-agnostic player database
- **draft_participants** - Links users to drafts
- **draft_picks** - Record of all picks made
- **notifications_outbox** - SMS/email notification queue
- **user_settings** - User notification preferences

## Type Safety

All database operations are fully typed using the generated types in `/app/src/types/supabase.ts`.

Example:

```typescript
import type { Database } from './types/supabase';

type League = Database['public']['Tables']['leagues']['Row'];
type DraftInsert = Database['public']['Tables']['drafts']['Insert'];
```

## Development

The application is built with Vite and serves from the `/app` directory.

Build command: `npm run build`
