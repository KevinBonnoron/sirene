import type { User } from '@sirene/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useMemo } from 'react';
import { clearStoredToken, getStoredToken, setStoredToken } from '@/lib/auth-interceptor';
import { config } from '@/lib/config';

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name?: string) => Promise<void>;
  logout: () => void;
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

async function fetchCurrentUser(): Promise<User | null> {
  const token = getStoredToken();
  if (!token) {
    return null;
  }
  const res = await fetch(`${config.server.url}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.ok) {
    return res.json() as Promise<User>;
  }
  clearStoredToken();
  return null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const { data: user = null, isLoading } = useQuery({
    queryKey: AUTH_QUERY_KEY,
    queryFn: fetchCurrentUser,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });

  const login = useCallback(
    async (email: string, password: string) => {
      const data = await authRequest('/login', { email, password });
      setStoredToken(data.token);
      qc.setQueryData(AUTH_QUERY_KEY, data.user);
    },
    [qc],
  );

  const register = useCallback(
    async (email: string, password: string, name?: string) => {
      const data = await authRequest('/register', { email, password, passwordConfirm: password, ...(name ? { name } : {}) });
      setStoredToken(data.token);
      qc.setQueryData(AUTH_QUERY_KEY, data.user);
    },
    [qc],
  );

  const logout = useCallback(() => {
    clearStoredToken();
    window.location.href = '/login';
  }, []);

  const value = useMemo(() => ({ user, isLoading, login, register, logout }), [user, isLoading, login, register, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
