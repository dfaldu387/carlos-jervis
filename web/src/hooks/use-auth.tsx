import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, setUnauthorizedHandler } from '@/lib/api';
import type { User } from '@/lib/types';

type Status = 'loading' | 'authenticated' | 'anonymous';

interface AuthContextValue {
  user: User | null;
  status: Status;
  signIn: (user: User) => void;
  signOut: () => Promise<void>;
  setUser: (user: User) => void;
  hasPermission: (permission: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<Status>('loading');

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null);
      setStatus('anonymous');
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  useEffect(() => {
    api
      .me()
      .then((data) => {
        setUser(data.user);
        setStatus('authenticated');
      })
      .catch(() => setStatus('anonymous'));
  }, []);

  const signIn = useCallback((next: User) => {
    setUser(next);
    setStatus('authenticated');
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      /* clear regardless */
    }
    setUser(null);
    setStatus('anonymous');
  }, []);

  const hasPermission = useCallback((permission: string) => Boolean(user?.permissions?.includes(permission)), [user]);

  const value = useMemo<AuthContextValue>(() => ({ user, status, signIn, signOut, setUser, hasPermission }), [user, status, signIn, signOut, hasPermission]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
