// safeNextPath guards the post-login return URL against open redirects (P3-t t-3: the pet-tag welcome
// screen sends the user to login with ?next=/t/{shortId} and expects to come back). Only a same-origin
// ABSOLUTE-PATH is allowed: it must start with a single '/', and NOT '//' or '/\' (protocol-relative URLs
// that a browser would treat as another origin). Anything else — an absolute URL, a scheme, whitespace —
// falls back to the account hub. Pure + tiny so it's unit-tested and shared by the login + register forms.
const DEFAULT_NEXT = '/tai-khoan';

export function safeNextPath(next: string | null | undefined): string {
  if (!next) return DEFAULT_NEXT;
  // Must be an absolute path (starts with '/') but not a protocol-relative // or /\ that escapes origin.
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return DEFAULT_NEXT;
  return next;
}
