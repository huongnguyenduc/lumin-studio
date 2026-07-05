/**
 * Analytics consent state (P1-p, PDPL / ADR-015). The gate that keeps Umami OFF until the visitor
 * explicitly opts in: no analytics script is fetched — and therefore no analytics network call is
 * made — before consent is `granted`. Guest consent lives in localStorage only (the `consent_grants`
 * table is customer-scoped; the plan §5 scopes the server-side guest audit as deferred — the
 * no-pre-consent-call gate is what P1-p owes).
 *
 * This module is the pure/thin core; <ConsentBanner> is the UI + gated loader that consumes it.
 */

export type ConsentDecision = 'granted' | 'denied';

/** localStorage key. Namespaced so it can't collide with cart-store or other app keys. */
export const CONSENT_KEY = 'lumin.analytics-consent';

/**
 * Interpret a raw stored value. PURE (no browser) so the state logic is unit-testable. Anything that
 * isn't exactly one of the two decisions — legacy junk, a truncated write, a hand-edited value — reads
 * as "undecided" (null) so the banner asks again rather than silently loading analytics off garbage.
 */
export function parseConsent(raw: string | null | undefined): ConsentDecision | null {
  return raw === 'granted' || raw === 'denied' ? raw : null;
}

/** Read the persisted decision. SSR-/private-mode-safe: any storage failure ⇒ undecided (null). */
export function readConsent(): ConsentDecision | null {
  if (typeof window === 'undefined') return null;
  try {
    return parseConsent(window.localStorage.getItem(CONSENT_KEY));
  } catch {
    return null; // Safari private mode / storage disabled ⇒ treat as undecided, never assume consent.
  }
}

/** Persist the decision. Best-effort: a storage failure just means we'll ask again next visit. */
export function writeConsent(decision: ConsentDecision): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CONSENT_KEY, decision);
  } catch {
    // ponytail: swallow — worst case the banner reappears next load; never a data-loss/money path.
  }
}

/**
 * Umami config from the (public) build-time env. Both vars are required — a half-config never loads a
 * script. When null, there is nothing to consent to, so the banner never shows and no script is ever
 * injected (the local/dev default). The website id + host are public by design (they'd be in the
 * script tag on every page), so NEXT_PUBLIC_ is correct here (unlike CORE_API_URL, which is server-only).
 */
export function umamiConfig(): { src: string; websiteId: string } | null {
  const src = process.env.NEXT_PUBLIC_UMAMI_SRC;
  const websiteId = process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID;
  return src && websiteId ? { src, websiteId } : null;
}
