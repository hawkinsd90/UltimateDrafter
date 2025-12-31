import { createContext, useContext, useEffect, useState } from 'react';
import { User, Session, AuthChangeEvent } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  isLoadingAuth: boolean;
  signInWithGoogle: (returnTo?: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const RETURN_URL_KEY = 'auth_return_url';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);

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

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setIsLoadingAuth(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event: AuthChangeEvent, session: Session | null) => {
      (async () => {
        setSession(session);
        setUser(session?.user ?? null);
        setIsLoadingAuth(false);

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
