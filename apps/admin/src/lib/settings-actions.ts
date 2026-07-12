'use server';

import { cookies } from 'next/headers';
import { createApiClient, type components } from '@lumin/api-client';
import { SESSION_COOKIE, coreApiBaseUrl } from './session';

// Server Actions for the settings writes (P3-i). CORE_API_URL is server-only, so the browser reaches
// core-api only through these; each forwards the httpOnly session cookie. Every write is owner-only at
// the server (authOwnerOnly) — a staff attempt collapses to `forbidden` here. Failures collapse to a
// small view-safe code — the raw Vietnamese error envelope never leaks (always-must #3, ADR-032).

type BankAccountUpdate = components['schemas']['BankAccountUpdate'];
type ShippingRule = components['schemas']['ShippingRule'];
type ReplyTemplateInput = components['schemas']['ReplyTemplateInput'];
type StaffInvite = components['schemas']['StaffInvite'];

/** `forbidden` = staff hit an owner-only edge (403); `validation` = the server rejected a field
 *  (400/422); `notFound` = the reply template id is gone (404); `conflict` = a duplicate (409, e.g. a
 *  staff email already registered); `error` = transient/5xx. */
export type SettingsResult =
  | { ok: true }
  | { ok: false; code: 'forbidden' | 'validation' | 'notFound' | 'conflict' | 'error' };

function codeFor(status: number): 'forbidden' | 'validation' | 'notFound' | 'conflict' | 'error' {
  if (status === 403) return 'forbidden';
  if (status === 404) return 'notFound';
  if (status === 409) return 'conflict';
  if (status === 400 || status === 422) return 'validation';
  return 'error';
}

async function authedClient() {
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  return createApiClient({
    baseUrl: coreApiBaseUrl(),
    headers: session ? { cookie: `${SESSION_COOKIE}=${session}` } : {},
  });
}

/** Change the VietQR STK (PATCH /admin/settings/bank-account) — owner-only + audited server-side. */
export async function updateBankAccount(body: BankAccountUpdate): Promise<SettingsResult> {
  try {
    const client = await authedClient();
    const { data, response } = await client.PATCH('/admin/settings/bank-account', { body });
    return data ? { ok: true } : { ok: false, code: codeFor(response.status) };
  } catch {
    return { ok: false, code: 'error' };
  }
}

/** Replace the shipping-fee table (PATCH /admin/settings/shipping-rules). Wholesale replace. */
export async function updateShippingRules(shippingRules: ShippingRule[]): Promise<SettingsResult> {
  try {
    const client = await authedClient();
    const { data, response } = await client.PATCH('/admin/settings/shipping-rules', {
      body: { shippingRules },
    });
    return data ? { ok: true } : { ok: false, code: codeFor(response.status) };
  } catch {
    return { ok: false, code: 'error' };
  }
}

/** Change the refund-policy text (PATCH /admin/settings/refund-policy). */
export async function updateRefundPolicy(refundPolicy: string): Promise<SettingsResult> {
  try {
    const client = await authedClient();
    const { data, response } = await client.PATCH('/admin/settings/refund-policy', {
      body: { refundPolicy },
    });
    return data ? { ok: true } : { ok: false, code: codeFor(response.status) };
  } catch {
    return { ok: false, code: 'error' };
  }
}

/** Create a reply template (POST /admin/reply-templates). Variables are derived server-side. */
export async function createReplyTemplate(body: ReplyTemplateInput): Promise<SettingsResult> {
  try {
    const client = await authedClient();
    const { data, response } = await client.POST('/admin/reply-templates', { body });
    return data ? { ok: true } : { ok: false, code: codeFor(response.status) };
  } catch {
    return { ok: false, code: 'error' };
  }
}

/** Replace a reply template (PATCH /admin/reply-templates/{id}). Unknown id → `notFound`. */
export async function updateReplyTemplate(
  id: string,
  body: ReplyTemplateInput,
): Promise<SettingsResult> {
  try {
    const client = await authedClient();
    const { data, response } = await client.PATCH('/admin/reply-templates/{id}', {
      params: { path: { id } },
      body,
    });
    return data ? { ok: true } : { ok: false, code: codeFor(response.status) };
  } catch {
    return { ok: false, code: 'error' };
  }
}

/** Delete a reply template (DELETE /admin/reply-templates/{id}). 204 → ok; unknown id → `notFound`. */
export async function deleteReplyTemplate(id: string): Promise<SettingsResult> {
  try {
    const client = await authedClient();
    const { response } = await client.DELETE('/admin/reply-templates/{id}', {
      params: { path: { id } },
    });
    if (response.ok) return { ok: true }; // 204 No Content
    return { ok: false, code: codeFor(response.status) };
  } catch {
    return { ok: false, code: 'error' };
  }
}

/** Invite a staff/owner account (POST /admin/staff, P3-q) — owner-only; a duplicate email → `conflict`.
 *  The owner sets the initial password here and shares it out-of-band (no email-invite flow yet). */
export async function inviteStaff(body: StaffInvite): Promise<SettingsResult> {
  try {
    const client = await authedClient();
    const { data, response } = await client.POST('/admin/staff', { body });
    return data ? { ok: true } : { ok: false, code: codeFor(response.status) };
  } catch {
    return { ok: false, code: 'error' };
  }
}
