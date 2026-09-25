const SECRET_KEY = 'sirene-desktop-secret';

// Session storage: a reload or an expired token can sign in again, and it dies with the window.
export function captureDesktopSecret(): void {
  const match = window.location.hash.match(/(?:^#|&)desktop=([^&]+)/);
  if (!match?.[1]) {
    return;
  }
  try {
    sessionStorage.setItem(SECRET_KEY, match[1]);
  } catch {
    return;
  }
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
}

export function desktopSecret(): string | null {
  try {
    return sessionStorage.getItem(SECRET_KEY);
  } catch {
    return null;
  }
}
