'use server';

import { cookies } from 'next/headers';
import { createApiClient, type components } from '@lumin/api-client';
import { SESSION_COOKIE, coreApiBaseUrl } from './session';

// Server Actions for the Vật tư & chi phí writes (ADR-039 4d-2). CORE_API_URL is server-only, so the
// browser reaches core-api only through these; each forwards the httpOnly session cookie. Every write is
// owner-only at the server (authOwnerOnly, 4a/4c-1) — a staff attempt collapses to `forbidden` here.
// Failures collapse to a small view-safe code — the raw Vietnamese error envelope never leaks
// (always-must #3, ADR-032). Each endpoint returns the created/updated resource (201/200), so a
// truthy `data` means success; router.refresh() on the client re-reads the RSC dashboard.

type FilamentMaterialInput = components['schemas']['FilamentMaterialInput'];
type FilamentImportInput = components['schemas']['FilamentImportInput'];
type FilamentScrapInput = components['schemas']['FilamentScrapInput'];
type MachineInput = components['schemas']['MachineInput'];
type AuxCostInput = components['schemas']['AuxCostInput'];

/** `forbidden` = staff hit an owner-only edge (403); `validation` = the server rejected a field
 *  (400/422); `notFound` = the material id is gone (404); `error` = transient/5xx. */
export type MaterialsResult =
  | { ok: true }
  | { ok: false; code: 'forbidden' | 'validation' | 'notFound' | 'error' };

function codeFor(status: number): 'forbidden' | 'validation' | 'notFound' | 'error' {
  if (status === 403) return 'forbidden';
  if (status === 404) return 'notFound';
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

/** Add a filament colour (POST /admin/filament-materials). Cost/stock come from imports, not here. */
export async function createFilamentMaterial(
  body: FilamentMaterialInput,
): Promise<MaterialsResult> {
  try {
    const client = await authedClient();
    const { data, response } = await client.POST('/admin/filament-materials', { body });
    return data ? { ok: true } : { ok: false, code: codeFor(response.status) };
  } catch {
    return { ok: false, code: 'error' };
  }
}

/** Import a roll into a material (POST /admin/filament-materials/{id}/import) — one lot, weighted-avg
 *  cost recomputes server-side. Unknown material id → `notFound`. */
export async function importFilament(
  id: string,
  body: FilamentImportInput,
): Promise<MaterialsResult> {
  try {
    const client = await authedClient();
    const { data, response } = await client.POST('/admin/filament-materials/{id}/import', {
      params: { path: { id } },
      body,
    });
    return data ? { ok: true } : { ok: false, code: codeFor(response.status) };
  } catch {
    return { ok: false, code: 'error' };
  }
}

/** Log a scrap draw (POST /admin/filament-materials/{id}/scrap) — draws FIFO + feeds the waste factor.
 *  A shortfall clamps server-side (never errors); unknown material id → `notFound`. */
export async function scrapFilament(
  id: string,
  body: FilamentScrapInput,
): Promise<MaterialsResult> {
  try {
    const client = await authedClient();
    const { data, response } = await client.POST('/admin/filament-materials/{id}/scrap', {
      params: { path: { id } },
      body,
    });
    return data ? { ok: true } : { ok: false, code: codeFor(response.status) };
  } catch {
    return { ok: false, code: 'error' };
  }
}

/** Add a printer (POST /admin/machines). ₫/hour is derived server-side from price ÷ dep × hours. */
export async function createMachine(body: MachineInput): Promise<MaterialsResult> {
  try {
    const client = await authedClient();
    const { data, response } = await client.POST('/admin/machines', { body });
    return data ? { ok: true } : { ok: false, code: codeFor(response.status) };
  } catch {
    return { ok: false, code: 'error' };
  }
}

/** Add an overhead line (POST /admin/aux-costs). Per-order allocation is derived at rollup time. */
export async function createAuxCost(body: AuxCostInput): Promise<MaterialsResult> {
  try {
    const client = await authedClient();
    const { data, response } = await client.POST('/admin/aux-costs', { body });
    return data ? { ok: true } : { ok: false, code: codeFor(response.status) };
  } catch {
    return { ok: false, code: 'error' };
  }
}
