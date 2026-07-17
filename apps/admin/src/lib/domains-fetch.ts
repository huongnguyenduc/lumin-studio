import { cookies } from 'next/headers';
import { createApiClient, type components } from '@lumin/api-client';
import { SESSION_COOKIE, coreApiBaseUrl } from './session';

// Server-side reads for the domains surface (quản lý domain — customer-site subdomains on
// *.luminstudio.vn). Mirrors ./settings-fetch. Owner-only at core-api; a staff caller gets 403 →
// `forbidden`. core-api not running in-cluster (no k8s access) → 503 → `unavailable`. Any other
// failure throws → route error boundary.

async function adminClient() {
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  return createApiClient({
    baseUrl: coreApiBaseUrl(),
    headers: session ? { cookie: `${SESSION_COOKIE}=${session}` } : {},
  });
}

export type DomainsList =
  | { status: 'ok'; domains: components['schemas']['Domain'][] }
  | { status: 'forbidden' }
  | { status: 'unavailable' };

/** Fetch provisioned subdomains (GET /admin/domains). */
export async function fetchDomains(): Promise<DomainsList> {
  const client = await adminClient();
  const { data, error, response } = await client.GET('/admin/domains', { cache: 'no-store' });
  if (response.status === 403) return { status: 'forbidden' };
  if (response.status === 503) return { status: 'unavailable' };
  if (error || !data) {
    throw new Error(`admin domains fetch failed (${response.status})`);
  }
  return { status: 'ok', domains: data };
}

export type DomainTargetsList =
  | { status: 'ok'; targets: components['schemas']['DomainTarget'][] }
  | { status: 'forbidden' }
  | { status: 'unavailable' };

/** Fetch the Service picker for the create-domain form (GET /admin/domains/targets). */
export async function fetchDomainTargets(): Promise<DomainTargetsList> {
  const client = await adminClient();
  const { data, error, response } = await client.GET('/admin/domains/targets', {
    cache: 'no-store',
  });
  if (response.status === 403) return { status: 'forbidden' };
  if (response.status === 503) return { status: 'unavailable' };
  if (error || !data) {
    throw new Error(`admin domain-targets fetch failed (${response.status})`);
  }
  return { status: 'ok', targets: data };
}
