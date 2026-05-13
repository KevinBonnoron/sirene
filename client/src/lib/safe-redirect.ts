/** Returns the `?redirect=` target only if it's safe to navigate to. The
 *  CLI device-code flow uses this param to bounce the user from /login back
 *  to /cli-auth, so the value comes from a URL we don't fully control.
 *
 *  Per WHATWG URL Standard, U+005C (`\`) is treated as `/` in special
 *  (http/https) URLs during authority parsing, so a value like `/\evil.com`
 *  or `\\evil.com` can be interpreted as a protocol-relative redirect.
 *  Rejecting only leading `//` is therefore not enough. We require a single
 *  leading `/`, disallow both `//` and `\` anywhere, and parse the result
 *  against a dummy origin to catch anything else odd. */
export function safeRedirect(value: string | null): string | null {
  if (!value) {
    return null;
  }
  if (!value.startsWith('/') || value.startsWith('//')) {
    return null;
  }
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
