import type { User } from '@sirene/shared';
import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useMemo } from 'react';
import { clearStoredToken, getStoredToken, setStoredToken } from '@/lib/auth-interceptor';
import { config } from '@/lib/config';
import { desktopSecret } from '@/lib/desktop';

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name?: string, invitation?: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const AUTH_QUERY_KEY = ['auth-me'];

async function authRequest(path: string, body: Record<string, string>) {
  const res = await fetch(`${config.server.url}/auth${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ code: 'requestFailed' }));
    throw new Error(data.code || `requestFailed`);
  }
  return res.json() as Promise<{ token: string; user: User }>;
}

// The desktop window has no password to type: it holds the secret its own process gave it.
async function signInAsDesktop(): Promise<User | null> {
  const secret = desktopSecret();
  if (!secret) {
    return null;
  }
  const data = await authRequest('/desktop', { secret }).catch(() => null);
  if (!data) {
    return null;
  }
  setStoredToken(data.token);
  return data.user;
}

async function fetchCurrentUser(): Promise<User | null> {
  const token = getStoredToken();
  if (!token) {
    return signInAsDesktop();
  }
  let res: Response;
  try {
    res = await fetch(`${config.server.url}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new Error('auth.unavailable:network');
  }
  if (res.ok) {
    return res.json() as Promise<User>;
  }
  if (res.status === 401 || res.status === 403) {
    clearStoredToken();
    return signInAsDesktop();
  }
  // Only outages are worth retrying; another 4xx would fail the same way five times.
  throw new Error(`${res.status >= 500 ? 'auth.unavailable' : 'auth.failed'}:${res.status}`);
}

export const authMeQueryOptions = queryOptions({
  queryKey: AUTH_QUERY_KEY,
  queryFn: fetchCurrentUser,
  retry: (count, err) => count < 5 && err instanceof Error && err.message.startsWith('auth.unavailable'),
  retryDelay: 1000,
  staleTime: Number.POSITIVE_INFINITY,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const { data: user = null, isLoading } = useQuery(authMeQueryOptions);

  const login = useCallback(
    async (email: string, password: string) => {
      const data = await authRequest('/login', { email, password });
      setStoredToken(data.token);
      qc.setQueryData(AUTH_QUERY_KEY, data.user);
    },
    [qc],
  );

  const register = useCallback(
    async (email: string, password: string, name?: string, invitation?: string) => {
      const data = await authRequest('/register', { email, password, passwordConfirm: password, ...(name ? { name } : {}), ...(invitation ? { invitation } : {}) });
      setStoredToken(data.token);
      qc.setQueryData(AUTH_QUERY_KEY, data.user);
    },
    [qc],
  );

  const refresh = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: AUTH_QUERY_KEY });
  }, [qc]);

  const logout = useCallback(() => {
    clearStoredToken();
    window.location.href = '/login';
  }, []);

  const value = useMemo(() => ({ user, isLoading, login, register, logout, refresh }), [user, isLoading, login, register, logout, refresh]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
