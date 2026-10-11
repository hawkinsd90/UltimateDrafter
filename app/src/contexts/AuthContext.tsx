import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { User, Session, AuthChangeEvent } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  isLoadingAuth: boolean;
  isAdmin: boolean;
  signInWithGoogle: (returnTo?: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const RETURN_URL_KEY = 'auth_return_url';
const AUTH_SESSION_TIMEOUT_MS = 12000;

function getInitialSession(resolveRef: React.MutableRefObject<((session: Session | null) => void) | null>): Promise<Session | null> {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => reject(new Error('Authentication session lookup timed out.')), AUTH_SESSION_TIMEOUT_MS);
    resolveRef.current = (session) => {
      window.clearTimeout(timeoutId);
      resolve(session);
      resolveRef.current = null;
    };
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (error) {
        window.clearTimeout(timeoutId);
        resolveRef.current = null;
        reject(error);
      } else {
        const resolver = resolveRef.current;
        if (resolver) {
          resolver(session);
        } else {
          resolve(session);
        }
      }
    }).catch(() => {
      window.clearTimeout(timeoutId);
      resolveRef.current = null;
      reject(new Error('Authentication session lookup failed.'));
    });
  });
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const authReadyRef = useRef(false);
  const sessionResolveRef = useRef<((session: Session | null) => void) | null>(null);
  const authEpochRef = useRef(0);
  const signedOutRef = useRef(false);
  const adminCheckRef = useRef<{ userId: string; epoch: number } | null>(null);
  const mountedRef = useRef(true);
  const epochAtInitiationRef = useRef(0);
  const timedOutRef = useRef(false);

  async function checkAdmin(userId: string, epoch: number) {
    try {
      const { data } = await supabase
        .from('admin_users')
        .select('id')
        .eq('user_id', userId)
        .maybeSingle();
      if (!mountedRef.current) return;
      if (adminCheckRef.current?.epoch !== epoch || adminCheckRef.current?.userId !== userId) return;
      setIsAdmin(!!data);
    } catch {
      if (!mountedRef.current) return;
      if (adminCheckRef.current?.epoch !== epoch || adminCheckRef.current?.userId !== userId) return;
      setIsAdmin(false);
    }
  }

  function applyAuthState(session: Session | null) {
    if (!mountedRef.current) return;
    setSession(session);
    setUser(session?.user ?? null);
    setIsLoadingAuth(false);
    const epoch = ++authEpochRef.current;
    if (session?.user) {
      adminCheckRef.current = { userId: session.user.id, epoch };
      checkAdmin(session.user.id, epoch);
    } else {
      adminCheckRef.current = null;
      setIsAdmin(false);
    }
  }

  useEffect(() => {
    if (import.meta.env.DEV) {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

      if (!supabaseUrl || !supabaseKey) {
        console.warn(
          '[DEV WARNING] Missing Supabase environment variables:\n' +
          `VITE_SUPABASE_URL: ${supabaseUrl ? '✓' : '✗'}\n` +
          `VITE_SUPABASE_ANON_KEY: ${supabaseKey ? '✓' : '✗'}`
        );
      }
    }

    epochAtInitiationRef.current = authEpochRef.current;
    timedOutRef.current = false;
    getInitialSession(sessionResolveRef).then((session) => {
      if (!mountedRef.current) return;
      authReadyRef.current = true;
      if (signedOutRef.current) return;
      if (epochAtInitiationRef.current !== authEpochRef.current) return;
      applyAuthState(session);
    }).catch(() => {
      if (!mountedRef.current) return;
      authReadyRef.current = true;
      timedOutRef.current = true;
    }).finally(() => {
      if (mountedRef.current) setIsLoadingAuth(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event: AuthChangeEvent, session: Session | null) => {
      (async () => {
        if (event === 'INITIAL_SESSION' && authReadyRef.current) {
          if (timedOutRef.current && session && !signedOutRef.current && epochAtInitiationRef.current === authEpochRef.current) {
            timedOutRef.current = false;
            applyAuthState(session);
          }
          if (!session && sessionResolveRef.current) {
            sessionResolveRef.current(null);
            sessionResolveRef.current = null;
          }
          return;
        }

        if (event === 'INITIAL_SESSION' && !authReadyRef.current) {
          authReadyRef.current = true;
          if (sessionResolveRef.current) {
            sessionResolveRef.current(session);
            sessionResolveRef.current = null;
          }
          return;
        }

        if (event === 'SIGNED_OUT') {
          signedOutRef.current = true;
          adminCheckRef.current = null;
          applyAuthState(null);
          sessionStorage.removeItem(RETURN_URL_KEY);
          window.location.href = '/login?reason=signed_out';
          return;
        }

        signedOutRef.current = false;
        applyAuthState(session);

        if (event === 'TOKEN_REFRESHED') {
          console.log('[Auth] Session token refreshed');
        }

        if (event === 'USER_UPDATED') {
          console.log('[Auth] User data updated');
        }
      })();
    });

    return () => {
      mountedRef.current = false;
      subscription.unsubscribe();
    };
  }, []);

  const signInWithGoogle = async (returnTo?: string) => {
    const targetUrl = returnTo || sessionStorage.getItem(RETURN_URL_KEY) || `${window.location.origin}/leagues`;

    sessionStorage.removeItem(RETURN_URL_KEY);

    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: targetUrl
      }
    });
  };

  const signOut = async () => {
    sessionStorage.removeItem(RETURN_URL_KEY);
    await supabase.auth.signOut();
  };

  const value = {
    user,
    session,
    isLoadingAuth,
    isAdmin,
    signInWithGoogle,
    signOut
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
