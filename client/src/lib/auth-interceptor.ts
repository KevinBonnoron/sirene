import { withInterceptor } from 'universal-client';
import { pb } from './pocketbase';

const AUTH_TOKEN_KEY = 'sirene-auth-token';

export function getStoredToken(): string | null {
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

export function setStoredToken(token: string): void {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
  pb.authStore.save(token, null);
}

export function clearStoredToken(): void {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  pb.authStore.clear();
}

export function getCurrentUserId(): string | null {
  const token = getStoredToken();
  if (!token) {
    return null;
  }

  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.id ?? null;
  } catch {
    return null;
  }
}

export const authInterceptor = withInterceptor({
  onBeforeRequest: (context) => {
    const token = getStoredToken();
    if (token) {
      return {
        headers: {
          ...context.headers,
          Authorization: `Bearer ${token}`,
        },
      };
    }
    return undefined;
  },
});
