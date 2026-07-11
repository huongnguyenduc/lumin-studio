import type { components } from '@lumin/api-client';

// Pure, framework-free adapters for the settings surface (P3-i). No React, no fetch — unit-tested in
// test/settings.test.ts. The SERVER is authoritative for everything here (owner-only writes, variable
// derivation, fee resolution); these helpers only shape data for display.

type BankAccount = components['schemas']['BankAccount'];
type Settings = components['schemas']['Settings'];
type ShippingRule = components['schemas']['ShippingRule'];

/** The wildcard province: its fee is the fallback applied when no exact province matches, so the shop
 *  can set one flat default (pricing.ShippingFee). Shown in the UI as a labelled default row. */
export const WILDCARD_PROVINCE = '*';

/**
 * Whether the shop can take a web payment. This MIRRORS core-api's checkout gate exactly
 * (stkFromSettings: bin + accountNumber non-empty) so the "checkout blocked" warning is truthful — it
 * fires precisely when GET /checkout/config / POST /orders would return NO_STK_CONFIGURED (P2-a gate;
 * admin rule "thiếu STK ⇒ chặn checkout web"). accountName is required to SAVE an STK (cleanBankUpdate)
 * but is not part of the payment gate, so it is not checked here.
 */
export function isStkConfigured(bank: BankAccount | undefined): boolean {
  return Boolean(bank?.bin?.trim() && bank?.accountNumber?.trim());
}

/** The shipping-rule rows as a definite array (the DTO field is optional/`?`). */
export function shippingRulesOf(settings: Settings): ShippingRule[] {
  return settings.shippingRules ?? [];
}

/**
 * The {token} placeholders in a reply-template body, unique + first-seen order. PREVIEW ONLY — the
 * server re-derives the authoritative list on write (extractTemplateVariables in Go); this mirror just
 * lets the editor show which variables it detected as the operator types (design screen 9).
 */
export function extractVariables(body: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of body.matchAll(/\{[^{}]+\}/g)) {
    if (seen.has(m[0])) continue;
    seen.add(m[0]);
    out.push(m[0]);
  }
  return out;
}
