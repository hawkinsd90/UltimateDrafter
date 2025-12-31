# Security TODO

## TL;DR — Pre-Prod Blockers

- [ ] **Restrict leagues SELECT via RLS** (owner or membership)
- [ ] **Re-enable post-login "most recent league" routing** (Login.tsx)
- [ ] **Add league-level access guards for routes** (/leagues/:id, /drafts/:id, etc.)
- [ ] **Verify cross-user league isolation** with two test accounts

---

## Context

During MVP development, the `leagues` table SELECT policy was intentionally made permissive to allow all authenticated users to view all leagues. This enabled rapid feature development and testing without access control blocking progress.

**Current permissive policy** (applied in migration `20251231182904_fix_all_select_policy_conflicts.sql`):
```sql
CREATE POLICY "Allow authenticated users to read all leagues during MVP"
  ON leagues FOR SELECT
  TO authenticated
  USING (true);
```

This approach works for MVP but **must be tightened before production** to prevent unauthorized access to league data.

---

## Files Requiring Changes

### 1. `app/src/pages/Login.tsx:37-54`
**Issue:** Post-login routing always goes to `/leagues` because we cannot safely determine the user's "most recent league" when all leagues are visible to everyone.

**Required change:** After RLS is tightened, re-enable the logic that routes to the user's most recent league.

### 2. `app/src/pages/LeagueList.tsx:17-27`
**Issue:** The query `select('*').from('leagues')` returns ALL leagues, not just those the user owns or is a member of.

**Required change:** After RLS is tightened, verify this query only returns authorized leagues.

### 3. Database RLS Policies (Future Migration)
**Issue:** The current SELECT policy on `leagues` uses `USING (true)`, which allows all authenticated users to view all leagues.

**Required change:** Replace with a restrictive policy:
```sql
-- Drop permissive policy
DROP POLICY "Allow authenticated users to read all leagues during MVP" ON leagues;

-- Add restrictive policy
CREATE POLICY "Users can view own leagues or leagues they are members of"
  ON leagues FOR SELECT
  TO authenticated
  USING (
    created_by = auth.uid() OR
    EXISTS (
      SELECT 1 FROM league_memberships
      WHERE league_memberships.league_id = leagues.id
      AND league_memberships.user_id = auth.uid()
    )
  );
```

---

## Manual Test Plan

### Before Tightening RLS
1. Sign in as User A
2. Create League X
3. Sign in as User B
4. Navigate to `/leagues`
5. **Expected (MVP):** User B can see League X (created by User A)

### After Tightening RLS
1. Sign in as User A
2. Create League X
3. Sign in as User B
4. Navigate to `/leagues`
5. **Expected (Production):** User B CANNOT see League X
6. Add User B as a member of League X (via league_memberships)
7. Refresh `/leagues` as User B
8. **Expected:** User B CAN now see League X

### Route-Level Access Guards
Test with two accounts (User A owns League X, User B does not):
- User B attempts to access `/leagues/[League X ID]/drafts`
- **Expected:** Redirect to `/leagues` with error message "You don't have access to this league"

---

## Additional Notes

- **Drafts table:** Also review RLS policies on `drafts`, `draft_picks`, `draft_participants` tables to ensure they inherit proper league-level access control.
- **Real-time subscriptions:** If using Supabase Realtime, verify that RLS policies apply to subscription queries.
- **API surface:** Audit all Supabase queries in the codebase to ensure none bypass RLS or make assumptions about data visibility.

---

## Priority

**High.** Must be resolved before any production deployment or public demo with real user data.
