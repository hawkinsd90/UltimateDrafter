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

  async function checkAdmin(userId: string) {
    const { data } = await supabase
      .from('admin_users')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle();
    setIsAdmin(!!data);
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

    getInitialSession(sessionResolveRef).then((session) => {
      authReadyRef.current = true;
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) checkAdmin(session.user.id);
    }).catch(() => {
      authReadyRef.current = true;
    }).finally(() => {
      setIsLoadingAuth(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event: AuthChangeEvent, session: Session | null) => {
      (async () => {
        if (event === 'INITIAL_SESSION' && authReadyRef.current) {
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
        }

        setSession(session);
        setUser(session?.user ?? null);
        setIsLoadingAuth(false);
        if (session?.user) checkAdmin(session.user.id);
        else setIsAdmin(false);

        if (event === 'SIGNED_OUT') {
          sessionStorage.removeItem(RETURN_URL_KEY);
          window.location.href = '/login?reason=signed_out';
        }

        if (event === 'TOKEN_REFRESHED') {
          console.log('[Auth] Session token refreshed');
        }

        if (event === 'USER_UPDATED') {
          console.log('[Auth] User data updated');
        }
      })();
    });

    return () => subscription.unsubscribe();
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
