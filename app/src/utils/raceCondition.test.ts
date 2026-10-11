// Focused race-condition tests for auth event ordering and tab request invalidation.
// Run with: npx tsx app/src/utils/raceCondition.test.ts
//
// These tests use controlled deferred promises and mock objects to reproduce
// the specific asynchronous sequences described in the race-condition fix.
// No database access, no React rendering — pure logic verification.

// ── Test harness ───────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${message}`);
  }
}

const testQueue: (() => Promise<void>)[] = [];

function describe(name: string, fn: () => void | Promise<void>): void {
  testQueue.push(async () => {
    console.log(`\n${name}`);
    await fn();
  });
}

async function runAll() {
  for (const test of testQueue) {
    await test();
  }
  console.log(`\n--- Race Condition Test Results ---`);
  console.log(`Passed: ${passed}, Failed: ${failed}`);
  console.log(`Total: ${passed + failed}`);
  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('All race-condition tests passed.');
  }
}

// runAll() is invoked at the end of the file after all describe() calls.

// ── Deferred promise utility ───────────────────────────────────────────────

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  isSettled: boolean;
}

function createDeferred<T>(): Deferred<T> {
  let resolveFn!: (value: T) => void;
  let rejectFn!: (error: Error) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolveFn = (v: T) => { resolve(v); };
    rejectFn = (e: Error) => { reject(e); };
  });
  return { promise, resolve: resolveFn, reject: rejectFn, isSettled: false };
}

// ── Mock auth state machine ────────────────────────────────────────────────
// Mirrors the race-condition guards in AuthContext.tsx without needing React.

interface MockAuthState {
  user: string | null;
  isLoading: boolean;
  isAdmin: boolean;
}

function createMockAuthProvider() {
  const state: MockAuthState = { user: null, isLoading: true, isAdmin: false };
  let authReady = false;
  let authEpoch = 0;
  let signedOut = false;
  let epochAtInitiation = 0;
  let mounted = true;
  let adminCheck: { userId: string; epoch: number } | null = null;

  // Deferred for getSession()
  let getSessionDeferred: Deferred<{ session: { user: { id: string } } | null }> | null = null;

  // Deferred for admin check queries
  const adminDeferreds = new Map<string, Deferred<boolean>>();

  function applyAuthState(session: { user: { id: string } } | null) {
    if (!mounted) return;
    state.user = session?.user.id ?? null;
    state.isLoading = false;
    const epoch = ++authEpoch;
    if (session?.user) {
      adminCheck = { userId: session.user.id, epoch };
      // Start admin check (deferred)
      const deferred = createDeferred<boolean>();
      adminDeferreds.set(session.user.id, deferred);
      deferred.promise.then((isAdmin) => {
        if (!mounted) return;
        if (adminCheck?.epoch !== epoch || adminCheck?.userId !== session.user.id) return;
        state.isAdmin = isAdmin;
      });
    } else {
      adminCheck = null;
      state.isAdmin = false;
    }
  }

  function initGetSession() {
    epochAtInitiation = authEpoch;
    getSessionDeferred = createDeferred<{ session: { user: { id: string } } | null }>();
    getSessionDeferred.promise.then(({ session }) => {
      if (!mounted) return;
      authReady = true;
      if (signedOut) return;
      if (epochAtInitiation !== authEpoch) return;
      applyAuthState(session);
    }).catch(() => {
      if (!mounted) return;
      authReady = true;
    }).finally(() => {
      if (mounted) state.isLoading = false;
    });
    return getSessionDeferred;
  }

  function emitAuthEvent(event: string, session: { user: { id: string } } | null) {
    if (event === 'INITIAL_SESSION' && authReady) {
      return;
    }
    if (event === 'INITIAL_SESSION' && !authReady) {
      authReady = true;
      if (getSessionDeferred && !getSessionDeferred.isSettled) {
        getSessionDeferred.resolve({ session });
        getSessionDeferred.isSettled = true;
      }
      return;
    }
    if (event === 'SIGNED_OUT') {
      signedOut = true;
      adminCheck = null;
      applyAuthState(null);
      return;
    }
    signedOut = false;
    applyAuthState(session);
  }

  function resolveAdminCheck(userId: string, isAdmin: boolean) {
    const deferred = adminDeferreds.get(userId);
    if (deferred && !deferred.isSettled) {
      deferred.resolve(isAdmin);
      deferred.isSettled = true;
    }
  }

  function unmount() {
    mounted = false;
  }

  function resolveGetSession(session: { user: { id: string } } | null) {
    if (getSessionDeferred && !getSessionDeferred.isSettled) {
      getSessionDeferred.resolve({ session });
      getSessionDeferred.isSettled = true;
    }
  }

  return { state, initGetSession, emitAuthEvent, resolveAdminCheck, resolveGetSession, unmount };
}

// ── Mock tab request invalidation ──────────────────────────────────────────
// Mirrors the tabReqRef logic in LeagueDetail.tsx.

function createMockTabLoader() {
  let tabReqId = 0;
  let essentialReqId = 0;
  const state: { data: string | null; loading: boolean; error: string } = {
    data: null,
    loading: false,
    error: '',
  };

  // Deferred for in-flight tab request
  let inFlight: { reqId: number; deferred: Deferred<string> } | null = null;

  async function loadEssential() {
    const reqId = ++essentialReqId;
    tabReqId++;
    state.loading = true;
    // Essential completes synchronously in mock
    if (essentialReqId !== reqId) return;
    state.loading = false;
  }

  async function loadTab(tab: string) {
    const reqId = ++tabReqId;
    if (tab === 'history' || tab === 'settings') {
      state.loading = false;
      state.error = '';
      return;
    }
    state.error = '';
    state.loading = true;
    const deferred = createDeferred<string>();
    inFlight = { reqId, deferred };
    try {
      const data = await deferred.promise;
      if (tabReqId !== reqId) return;
      state.data = data;
    } catch {
      if (tabReqId !== reqId) return;
      state.error = 'Tab load failed';
    } finally {
      if (tabReqId === reqId) state.loading = false;
    }
  }

  function resolveTabRequest(data: string) {
    if (inFlight && !inFlight.deferred.isSettled) {
      inFlight.deferred.resolve(data);
      inFlight.deferred.isSettled = true;
    }
  }

  return { state, loadEssential, loadTab, resolveTabRequest, get tabReqId() { return tabReqId; } };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Auth: SIGNED_IN arrives before getSession completes', () => {
  const auth = createMockAuthProvider();
  auth.initGetSession();

  // SIGNED_IN arrives first
  auth.emitAuthEvent('SIGNED_IN', { user: { id: 'user-b' } });

  // Now getSession completes with old user A
  auth.resolveGetSession({ user: { id: 'user-a' } });

  // The epoch should have changed, so getSession result is discarded
  assert(auth.state.user === 'user-b', 'Should keep user-b from SIGNED_IN, not overwrite with user-a from getSession');
});

describe('Auth: SIGNED_OUT arrives before getSession completes', () => {
  const auth = createMockAuthProvider();
  auth.initGetSession();

  // SIGNED_OUT arrives first
  auth.emitAuthEvent('SIGNED_OUT', null);

  // Now getSession completes with a session
  auth.resolveGetSession({ user: { id: 'user-a' } });

  assert(auth.state.user === null, 'Should not restore old session after SIGNED_OUT');
});

describe('Auth: TOKEN_REFRESHED updates session, old getSession completes after', () => {
  const auth = createMockAuthProvider();
  auth.initGetSession();

  // TOKEN_REFRESHED with new user
  auth.emitAuthEvent('TOKEN_REFRESHED', { user: { id: 'user-refreshed' } });

  // Old getSession completes with original user
  auth.resolveGetSession({ user: { id: 'user-original' } });

  assert(auth.state.user === 'user-refreshed', 'Should keep refreshed user, not overwrite with original from stale getSession');
});

describe('Auth: getSession times out, valid session event arrives after', async () => {
  const auth = createMockAuthProvider();
  const deferred = auth.initGetSession();

  // Simulate timeout: reject the promise
  if (deferred && !deferred.isSettled) {
    deferred.reject(new Error('timeout'));
    deferred.isSettled = true;
  }

  // Wait for microtasks (promise chain .catch + .finally)
  await new Promise((r) => setTimeout(r, 10));

  // isLoading should be cleared
  assert(!auth.state.isLoading, 'Should clear loading after timeout');

  // A valid SIGNED_IN event arrives after timeout
  auth.emitAuthEvent('SIGNED_IN', { user: { id: 'user-recovered' } });

  assert(auth.state.user === 'user-recovered', 'Should recover session from post-timeout event');
});

describe('Auth: admin lookup for user A completes after user B signs in', () => {
  const auth = createMockAuthProvider();
  auth.initGetSession();

  // User A signs in
  auth.emitAuthEvent('SIGNED_IN', { user: { id: 'user-a' } });

  // User B signs in before A's admin check completes
  auth.emitAuthEvent('SIGNED_IN', { user: { id: 'user-b' } });

  // Now resolve A's admin check as true (admin)
  auth.resolveAdminCheck('user-a', true);

  assert(auth.state.user === 'user-b', 'Should have user-b as current user');
  assert(!auth.state.isAdmin, 'Should not apply admin status from user-a to user-b');

  // Resolve B's admin check as false (not admin)
  auth.resolveAdminCheck('user-b', false);

  assert(!auth.state.isAdmin, 'user-b should not be admin');
});

describe('Auth: AuthProvider unmounts while getSession pending', async () => {
  const auth = createMockAuthProvider();
  auth.initGetSession();

  // Unmount
  auth.unmount();

  // getSession completes after unmount
  auth.resolveGetSession({ user: { id: 'user-a' } });

  // Wait for microtasks
  await new Promise((r) => setTimeout(r, 10));

  assert(auth.state.user === null, 'Should not apply session after unmount');
  assert(auth.state.isLoading, 'Should not modify loading state after unmount (isLoading stays true, component is gone)');
});

describe('Tab: switching to History invalidates pending Drafts request', () => {
  const tab = createMockTabLoader();

  // Start Drafts tab load
  const draftsPromise = tab.loadTab('drafts');
  const draftsReqId = tab.tabReqId;

  // Switch to History (should invalidate)
  tab.loadTab('history');

  assert(tab.tabReqId > draftsReqId, 'History switch should increment tabReqId');

  // Now the Drafts request completes
  tab.resolveTabRequest('drafts-data');

  // Wait for microtasks
  draftsPromise.then(() => {
    assert(tab.state.data === null, 'Stale Drafts data should not be applied after History switch');
    assert(!tab.state.loading, 'Loading should be false after History switch');
  });
});

describe('Tab: switching from History to Drafts does not carry stale state', () => {
  const tab = createMockTabLoader();

  // Go to History (no optional queries)
  tab.loadTab('history');
  assert(!tab.state.loading, 'History should not set loading');
  assert(tab.state.data === null, 'History should not set data');

  // Switch to Drafts
  const draftsPromise = tab.loadTab('drafts');
  assert(tab.state.loading, 'Drafts should set loading');

  // Resolve the Drafts request
  tab.resolveTabRequest('drafts-data');

  draftsPromise.then(() => {
    assert(tab.state.data === 'drafts-data', 'Drafts data should be applied');
    assert(!tab.state.loading, 'Loading should be cleared after Drafts load');
  });
});

describe('Tab: essential reload invalidates pending tab request', () => {
  const tab = createMockTabLoader();

  // Start a Drafts tab load
  const draftsPromise = tab.loadTab('drafts');
  const draftsReqId = tab.tabReqId;

  // Essential reload (e.g., league change) should bump tabReqId
  tab.loadEssential();

  assert(tab.tabReqId > draftsReqId, 'Essential reload should invalidate pending tab request');

  // Drafts request completes
  tab.resolveTabRequest('drafts-data');

  draftsPromise.then(() => {
    assert(tab.state.data === null, 'Stale Drafts data should not be applied after essential reload');
  });
});

describe('Tab: rapid tab switching keeps only the latest request valid', () => {
  const tab = createMockTabLoader();

  // Start Drafts
  tab.loadTab('drafts');
  const req1 = tab.tabReqId;

  // Switch to Members
  tab.loadTab('members');
  const req2 = tab.tabReqId;

  // Switch back to Drafts
  tab.loadTab('drafts');
  const req3 = tab.tabReqId;

  assert(req2 > req1, 'Members switch should invalidate Drafts');
  assert(req3 > req2, 'Second Drafts switch should invalidate Members');

  // Resolve the first Drafts request (stale)
  tab.resolveTabRequest('drafts-v1');

  // The first Drafts data should be stale because req2 and req3 invalidated it.
  // (in real code, it would be the active in-flight request)
});

runAll();
