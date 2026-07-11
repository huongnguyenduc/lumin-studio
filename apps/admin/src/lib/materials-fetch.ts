import { cookies } from 'next/headers';
import { createApiClient, type components } from '@lumin/api-client';
import { SESSION_COOKIE, coreApiBaseUrl } from './session';

// Server-side reads for the Vật tư & chi phí surface (ADR-039, design screen 8), forwarding the
// httpOnly admin session cookie. Four independent GETs (materials · machines · aux-costs · costing
// summary) fired in parallel — this slice is read-only (the write dialogs are a later slice), so
// no-store keeps the costing dashboard live. Importing next/headers makes this module server-only (the
// JWT never reaches client JS). Mirrors ./settings-fetch. A present-but-invalid cookie → core-api 401
// → thrown → the route error boundary ((app)/error.tsx); the unauth path is handled by middleware.

export interface CostingBundle {
  materials: components['schemas']['FilamentMaterial'][];
  machines: components['schemas']['Machine'][];
  auxCosts: components['schemas']['AuxCost'][];
  summary: components['schemas']['CostingSummary'];
}

export async function fetchCostingBundle(): Promise<CostingBundle> {
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  const client = createApiClient({
    baseUrl: coreApiBaseUrl(),
    headers: session ? { cookie: `${SESSION_COOKIE}=${session}` } : {},
  });

  const [materials, machines, auxCosts, summary] = await Promise.all([
    client.GET('/admin/filament-materials', { cache: 'no-store' }),
    client.GET('/admin/machines', { cache: 'no-store' }),
    client.GET('/admin/aux-costs', { cache: 'no-store' }),
    client.GET('/admin/costing-summary', { cache: 'no-store' }),
  ]);

  if (materials.error || !materials.data) {
    throw new Error(`admin filament-materials fetch failed (${materials.response.status})`);
  }
  if (machines.error || !machines.data) {
    throw new Error(`admin machines fetch failed (${machines.response.status})`);
  }
  if (auxCosts.error || !auxCosts.data) {
    throw new Error(`admin aux-costs fetch failed (${auxCosts.response.status})`);
  }
  if (summary.error || !summary.data) {
    throw new Error(`admin costing-summary fetch failed (${summary.response.status})`);
  }

  return {
    materials: materials.data,
    machines: machines.data,
    auxCosts: auxCosts.data,
    summary: summary.data,
  };
}
