import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import * as api from '@/lib/api';
import { setUnauthorizedHandler } from '@/lib/api';
import { tokenStorage } from '@/lib/token-storage';
import { registerForPushNotifications } from '@/lib/push-notifications';
import type { AuthUser } from '@/types/api';

interface AuthContextValue {
  isReady: boolean;
  isAuthenticated: boolean;
  user: AuthUser | null;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isReady, setIsReady] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    tokenStorage
      .get()
      .then(async (token) => {
        if (!token) return;
        try {
          setUser(await api.fetchProfile());
          void registerForPushNotifications();
        } catch {
          // Expired/invalid token — the response interceptor already clears it on a 401.
        }
      })
      .finally(() => setIsReady(true));
    setUnauthorizedHandler(() => setUser(null));
  }, []);

  const signIn = async (username: string, password: string) => {
    const result = await api.login(username, password);
    await tokenStorage.set(result.token);
    setUser(result.user);
    void registerForPushNotifications();
  };

  const signOut = async () => {
    await tokenStorage.clear();
    setUser(null);
  };

  const value = useMemo<AuthContextValue>(
    () => ({ isReady, isAuthenticated: !!user, user, signIn, signOut }),
    [isReady, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
