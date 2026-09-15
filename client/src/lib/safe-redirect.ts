export function safeRedirect(value: string | null): string | null {
  if (!value) {
    return null;
  }
  if (!value.startsWith('/') || value.startsWith('//')) {
    return null;
  }
  // WHATWG URL parsing treats `\` as `/` in http(s) URLs, so `/\evil.com` would be protocol-relative.
  if (value.includes('\\')) {
    return null;
  }
  try {
    const parsed = new URL(value, 'http://placeholder.invalid');
    if (parsed.origin !== 'http://placeholder.invalid') {
      return null;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}
