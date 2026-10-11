// Focused race-condition tests for auth event ordering and tab request invalidation.
// Run with: npx tsx app/src/utils/raceCondition.test.ts
//
// These tests use controlled deferred promises and mock objects to reproduce
// the specific asynchronous sequences described in the race-condition fix.
// No database access, no React rendering — pure logic verification.

declare const process: { exit(code: number): void };

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
  let timedOut = false;
  let authEpoch = 0;
  let signedOut = false;
  let epochAtInitiation = 0;
  let mounted = true;
  let adminCheck: { userId: string; epoch: number } | null = null;

  let getSessionDeferred: Deferred<{ session: { user: { id: string } } | null }> | null = null;
  const adminDeferreds = new Map<string, Deferred<boolean>>();

  function applyAuthState(session: { user: { id: string } } | null) {
    if (!mounted) return;
    state.user = session?.user.id ?? null;
    state.isLoading = false;
    const epoch = ++authEpoch;
    if (session?.user) {
      adminCheck = { userId: session.user.id, epoch };
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
    timedOut = false;
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
      timedOut = true;
    }).finally(() => {
      if (mounted) state.isLoading = false;
    });
    return getSessionDeferred;
  }

  function emitAuthEvent(event: string, session: { user: { id: string } } | null) {
    if (event === 'INITIAL_SESSION' && authReady) {
      if (timedOut && session && !signedOut && epochAtInitiation === authEpoch) {
        timedOut = false;
        applyAuthState(session);
      }
      if (!session && getSessionDeferred && !getSessionDeferred.isSettled) {
        getSessionDeferred.resolve({ session: null });
        getSessionDeferred.isSettled = true;
      }
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

  function rejectGetSession() {
    if (getSessionDeferred && !getSessionDeferred.isSettled) {
      getSessionDeferred.reject(new Error('timeout'));
      getSessionDeferred.isSettled = true;
    }
  }

  return { state, initGetSession, emitAuthEvent, resolveAdminCheck, resolveGetSession, rejectGetSession, unmount };
}

// ── Mock tab request invalidation ──────────────────────────────────────────
// Mirrors the tabReqRef/essentialReqRef logic in LeagueDetail.tsx.
// loadEssential does NOT bump tabReqId — only league/user changes do.

function createMockTabLoader() {
  let tabReqId = 0;
  let essentialReqId = 0;
  const state: { data: string | null; loading: boolean; error: string } = {
    data: null,
    loading: false,
    error: '',
  };

  let inFlight: { reqId: number; deferred: Deferred<string> } | null = null;

  async function loadEssential() {
    const reqId = ++essentialReqId;
    state.loading = true;
    if (essentialReqId !== reqId) return;
    state.loading = false;
  }

  function resetForLeagueOrUserChange() {
    tabReqId++;
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

  return { state, loadEssential, loadTab, resolveTabRequest, resetForLeagueOrUserChange, get tabReqId() { return tabReqId; } };
}

// Simulates the corrected effect ordering in LeagueDetail:
// the league/user invalidation effect runs BEFORE the tab-loading effect.
function simulateMountAndLoadTab(tab: ReturnType<typeof createMockTabLoader>, tabName: string) {
  tab.resetForLeagueOrUserChange();
  return tab.loadTab(tabName);
}

// ── Tests: Auth scenarios ──────────────────────────────────────────────────

describe('Auth: SIGNED_IN arrives before getSession completes', () => {
  const auth = createMockAuthProvider();
  auth.initGetSession();
  auth.emitAuthEvent('SIGNED_IN', { user: { id: 'user-b' } });
  auth.resolveGetSession({ user: { id: 'user-a' } });
  assert(auth.state.user === 'user-b', 'Should keep user-b from SIGNED_IN, not overwrite with user-a from getSession');
});

describe('Auth: SIGNED_OUT arrives before getSession completes', () => {
  const auth = createMockAuthProvider();
  auth.initGetSession();
  auth.emitAuthEvent('SIGNED_OUT', null);
  auth.resolveGetSession({ user: { id: 'user-a' } });
  assert(auth.state.user === null, 'Should not restore old session after SIGNED_OUT');
});

describe('Auth: TOKEN_REFRESHED updates session, old getSession completes after', () => {
  const auth = createMockAuthProvider();
  auth.initGetSession();
  auth.emitAuthEvent('TOKEN_REFRESHED', { user: { id: 'user-refreshed' } });
  auth.resolveGetSession({ user: { id: 'user-original' } });
  assert(auth.state.user === 'user-refreshed', 'Should keep refreshed user, not overwrite with original from stale getSession');
});

describe('Auth: getSession times out, valid SIGNED_IN arrives after', async () => {
  const auth = createMockAuthProvider();
  auth.initGetSession();
  auth.rejectGetSession();
  await new Promise((r) => setTimeout(r, 10));
  assert(!auth.state.isLoading, 'Should clear loading after timeout');
  auth.emitAuthEvent('SIGNED_IN', { user: { id: 'user-recovered' } });
  assert(auth.state.user === 'user-recovered', 'Should recover session from post-timeout SIGNED_IN');
});

describe('Auth: getSession times out, valid INITIAL_SESSION arrives after', async () => {
  const auth = createMockAuthProvider();
  auth.initGetSession();
  auth.rejectGetSession();
  await new Promise((r) => setTimeout(r, 10));
  assert(!auth.state.isLoading, 'Should clear loading after timeout');
  auth.emitAuthEvent('INITIAL_SESSION', { user: { id: 'user-late-init' } });
  assert(auth.state.user === 'user-late-init', 'Should recover session from late INITIAL_SESSION after timeout');
});

describe('Auth: timeout then SIGNED_OUT then stale INITIAL_SESSION', async () => {
  const auth = createMockAuthProvider();
  auth.initGetSession();
  auth.rejectGetSession();
  await new Promise((r) => setTimeout(r, 10));

  auth.emitAuthEvent('SIGNED_OUT', null);
  assert(auth.state.user === null, 'Should be signed out after SIGNED_OUT');

  auth.emitAuthEvent('INITIAL_SESSION', { user: { id: 'user-stale' } });
  assert(auth.state.user === null, 'Should not restore stale INITIAL_SESSION after SIGNED_OUT');
});

describe('Auth: SIGNED_IN then older INITIAL_SESSION arrives', () => {
  const auth = createMockAuthProvider();
  auth.initGetSession();
  auth.emitAuthEvent('SIGNED_IN', { user: { id: 'user-new' } });
  auth.emitAuthEvent('INITIAL_SESSION', { user: { id: 'user-old' } });
  assert(auth.state.user === 'user-new', 'Should keep SIGNED_IN user, not overwrite with older INITIAL_SESSION');
});

describe('Auth: normal successful initialization via INITIAL_SESSION', async () => {
  const auth = createMockAuthProvider();
  auth.initGetSession();
  auth.emitAuthEvent('INITIAL_SESSION', { user: { id: 'user-normal' } });
  await new Promise((r) => setTimeout(r, 10));
  assert(auth.state.user === 'user-normal', 'Should apply session from normal INITIAL_SESSION');
  assert(!auth.state.isLoading, 'Should clear loading after normal init');
});

describe('Auth: admin lookup for user A completes after user B signs in', () => {
  const auth = createMockAuthProvider();
  auth.initGetSession();
  auth.emitAuthEvent('SIGNED_IN', { user: { id: 'user-a' } });
  auth.emitAuthEvent('SIGNED_IN', { user: { id: 'user-b' } });
  auth.resolveAdminCheck('user-a', true);
  assert(auth.state.user === 'user-b', 'Should have user-b as current user');
  assert(!auth.state.isAdmin, 'Should not apply admin status from user-a to user-b');
  auth.resolveAdminCheck('user-b', false);
  assert(!auth.state.isAdmin, 'user-b should not be admin');
});

describe('Auth: pending admin lookup during identity change preserves correct user', () => {
  const auth = createMockAuthProvider();
  auth.initGetSession();
  auth.emitAuthEvent('SIGNED_IN', { user: { id: 'user-x' } });
  auth.emitAuthEvent('SIGNED_IN', { user: { id: 'user-y' } });
  auth.emitAuthEvent('SIGNED_IN', { user: { id: 'user-z' } });
  auth.resolveAdminCheck('user-x', true);
  auth.resolveAdminCheck('user-y', true);
  auth.resolveAdminCheck('user-z', false);
  assert(auth.state.user === 'user-z', 'Should have user-z as current user');
  assert(!auth.state.isAdmin, 'Should apply user-z admin result, not user-x or user-y');
});

describe('Auth: AuthProvider unmounts while getSession pending', async () => {
  const auth = createMockAuthProvider();
  auth.initGetSession();
  auth.unmount();
  auth.resolveGetSession({ user: { id: 'user-a' } });
  await new Promise((r) => setTimeout(r, 10));
  assert(auth.state.user === null, 'Should not apply session after unmount');
  assert(auth.state.isLoading, 'Should not modify loading state after unmount');
});

// ── Tests: Tab invalidation scenarios ──────────────────────────────────────

describe('Tab: switching to History invalidates pending Drafts request', () => {
  const tab = createMockTabLoader();
  const draftsPromise = tab.loadTab('drafts');
  const draftsReqId = tab.tabReqId;
  tab.loadTab('history');
  assert(tab.tabReqId > draftsReqId, 'History switch should increment tabReqId');
  tab.resolveTabRequest('drafts-data');
  draftsPromise.then(() => {
    assert(tab.state.data === null, 'Stale Drafts data should not be applied after History switch');
    assert(!tab.state.loading, 'Loading should be false after History switch');
  });
});

describe('Tab: switching from History to Drafts does not carry stale state', () => {
  const tab = createMockTabLoader();
  tab.loadTab('history');
  assert(!tab.state.loading, 'History should not set loading');
  assert(tab.state.data === null, 'History should not set data');
  const draftsPromise = tab.loadTab('drafts');
  assert(tab.state.loading, 'Drafts should set loading');
  tab.resolveTabRequest('drafts-data');
  draftsPromise.then(() => {
    assert(tab.state.data === 'drafts-data', 'Drafts data should be applied');
    assert(!tab.state.loading, 'Loading should be cleared after Drafts load');
  });
});

describe('Tab: same-league essential refresh preserves pending Drafts request', () => {
  const tab = createMockTabLoader();
  const draftsPromise = tab.loadTab('drafts');
  const draftsReqId = tab.tabReqId;
  tab.loadEssential();
  assert(tab.tabReqId === draftsReqId, 'Same-league essential refresh should NOT bump tabReqId');
  tab.resolveTabRequest('drafts-data');
  draftsPromise.then(() => {
    assert(tab.state.data === 'drafts-data', 'Drafts data should still be applied after essential refresh');
    assert(!tab.state.loading, 'Loading should be cleared after Drafts load');
  });
});

describe('Tab: same-league essential refresh preserves pending Members request', () => {
  const tab = createMockTabLoader();
  const membersPromise = tab.loadTab('members');
  const membersReqId = tab.tabReqId;
  tab.loadEssential();
  assert(tab.tabReqId === membersReqId, 'Same-league essential refresh should NOT bump tabReqId');
  tab.resolveTabRequest('members-data');
  membersPromise.then(() => {
    assert(tab.state.data === 'members-data', 'Members data should still be applied after essential refresh');
  });
});

describe('Tab: league switch invalidates pending Drafts request', () => {
  const tab = createMockTabLoader();
  const draftsPromise = tab.loadTab('drafts');
  const draftsReqId = tab.tabReqId;
  tab.resetForLeagueOrUserChange();
  assert(tab.tabReqId > draftsReqId, 'League switch should bump tabReqId');
  tab.resolveTabRequest('drafts-data');
  draftsPromise.then(() => {
    assert(tab.state.data === null, 'Stale Drafts data should not be applied after league switch');
  });
});

describe('Tab: rapid tab switching keeps only the latest request valid', () => {
  const tab = createMockTabLoader();
  tab.loadTab('drafts');
  const req1 = tab.tabReqId;
  tab.loadTab('members');
  const req2 = tab.tabReqId;
  tab.loadTab('drafts');
  const req3 = tab.tabReqId;
  assert(req2 > req1, 'Members switch should invalidate Drafts');
  assert(req3 > req2, 'Second Drafts switch should invalidate Members');
});

describe('Tab: initial Drafts tab load completes and displays data', async () => {
  const tab = createMockTabLoader();
  const promise = simulateMountAndLoadTab(tab, 'drafts');
  assert(tab.state.loading, 'Should be loading after initial mount');
  tab.resolveTabRequest('drafts-initial');
  await promise;
  assert(tab.state.data === 'drafts-initial', 'Drafts data should display after initial load');
  assert(!tab.state.loading, 'Loading should clear after initial Drafts load');
});

describe('Tab: initial Members tab load completes and displays data', async () => {
  const tab = createMockTabLoader();
  const promise = simulateMountAndLoadTab(tab, 'members');
  assert(tab.state.loading, 'Should be loading after initial mount');
  tab.resolveTabRequest('members-initial');
  await promise;
  assert(tab.state.data === 'members-initial', 'Members data should display after initial load');
  assert(!tab.state.loading, 'Loading should clear after initial Members load');
});

describe('Tab: initial History tab load does not start unrelated optional queries', () => {
  const tab = createMockTabLoader();
  simulateMountAndLoadTab(tab, 'history');
  assert(!tab.state.loading, 'History should not set loading');
  assert(tab.state.data === null, 'History should not set data');
});

describe('Tab: switching leagues discards old league pending requests', async () => {
  const tab = createMockTabLoader();
  const oldPromise = simulateMountAndLoadTab(tab, 'drafts');
  const oldReqId = tab.tabReqId;
  tab.resetForLeagueOrUserChange();
  assert(tab.tabReqId > oldReqId, 'League switch should bump tabReqId before new load');
  const newPromise = tab.loadTab('drafts');
  tab.resolveTabRequest('old-league-data');
  await oldPromise;
  assert(tab.state.data !== 'old-league-data', 'Old league data should be discarded');
  tab.resolveTabRequest('new-league-data');
  await newPromise;
  assert(tab.state.data === 'new-league-data', 'New league data should display');
});

(async () => {
  for (const test of testQueue) {
    await test();
    await new Promise((r) => setTimeout(r, 5));
  }
  const lines = [
    '',
    '--- Race Condition Test Results ---',
    `Passed: ${passed}, Failed: ${failed}`,
    `Total: ${passed + failed}`,
  ];
  if (failed > 0) {
    lines.push('');
  } else {
    lines.push('All race-condition tests passed.', '');
  }
  process.stderr.write(lines.join('\n') + '\n');
  if (failed > 0) process.exit(1);
})();
