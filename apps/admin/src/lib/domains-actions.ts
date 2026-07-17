'use server';

import { cookies } from 'next/headers';
import { createApiClient, type components } from '@lumin/api-client';
import { SESSION_COOKIE, coreApiBaseUrl } from './session';

// Server Actions for the domains writes (quản lý domain). Owner-only at core-api; every write
// collapses to a small view-safe code — the raw error envelope never leaks (ADR-032). Mirrors
// ./settings-actions.

type DomainInput = components['schemas']['DomainInput'];
type DomainTargetUpdate = components['schemas']['DomainTargetUpdate'];

/** `forbidden` = staff hit the owner-only edge (403); `validation` = bad/reserved subdomain
 *  (400); `conflict` = subdomain already provisioned (409); `notFound` = delete of an unmanaged
 *  name (404); `unavailable` = core-api has no in-cluster k8s access (503); `error` = transient. */
type DomainsErrorCode =
  | 'forbidden'
  | 'validation'
  | 'conflict'
  | 'notFound'
  | 'unavailable'
  | 'error';

export type DomainsResult = { ok: true } | { ok: false; code: DomainsErrorCode };

function codeFor(status: number): DomainsErrorCode {
  if (status === 403) return 'forbidden';
  if (status === 409) return 'conflict';
  if (status === 404) return 'notFound';
  if (status === 503) return 'unavailable';
  if (status === 400) return 'validation';
  return 'error';
}

async function authedClient() {
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  return createApiClient({
    baseUrl: coreApiBaseUrl(),
    headers: session ? { cookie: `${SESSION_COOKIE}=${session}` } : {},
  });
}

/** Provision a new customer-site subdomain (POST /admin/domains). */
export async function createDomain(body: DomainInput): Promise<DomainsResult> {
  try {
    const client = await authedClient();
    const { data, response } = await client.POST('/admin/domains', { body });
    return data ? { ok: true } : { ok: false, code: codeFor(response.status) };
  } catch {
    return { ok: false, code: 'error' };
  }
}

/** Repoint an existing domain's target service/port (PATCH /admin/domains/{subdomain}). */
export async function updateDomain(
  subdomain: string,
  body: DomainTargetUpdate,
): Promise<DomainsResult> {
  try {
    const client = await authedClient();
    const { data, response } = await client.PATCH('/admin/domains/{subdomain}', {
      params: { path: { subdomain } },
      body,
    });
    return data ? { ok: true } : { ok: false, code: codeFor(response.status) };
  } catch {
    return { ok: false, code: 'error' };
  }
}

/** Remove a provisioned subdomain (DELETE /admin/domains/{subdomain}). */
export async function deleteDomain(subdomain: string): Promise<DomainsResult> {
  try {
    const client = await authedClient();
    const { response } = await client.DELETE('/admin/domains/{subdomain}', {
      params: { path: { subdomain } },
    });
    if (response.ok) return { ok: true }; // 204 No Content
    return { ok: false, code: codeFor(response.status) };
  } catch {
    return { ok: false, code: 'error' };
  }
}
