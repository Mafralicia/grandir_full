import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, setUnauthorizedHandler } from './api';

export type Role = 'OWNER' | 'ADMIN' | 'ANALYST' | 'VIEWER';

export interface Me {
  user: { id: string; email: string; firstName: string; lastName: string; role: Role; mfaEnabled: boolean };
  tenant: { id: string; name: string; currency: string; feeRateBps: number; country: string; storeCount: number; demoData: boolean };
}

interface AuthState {
  me: Me | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  can: (role: Role) => boolean;
}

const RANK: Record<Role, number> = { VIEWER: 0, ANALYST: 1, ADMIN: 2, OWNER: 3 };
const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setMe(await api<Me>('/auth/me'));
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    setMe(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => setMe(null));
    void refresh();
    return () => setUnauthorizedHandler(null);
  }, [refresh]);

  const value = useMemo<AuthState>(
    () => ({ me, loading, refresh, logout, can: (role) => !!me && RANK[me.user.role] >= RANK[role] }),
    [me, loading, refresh, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth fora de AuthProvider');
  return value;
}
