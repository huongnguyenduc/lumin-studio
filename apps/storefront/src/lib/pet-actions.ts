'use server';

import { cookies } from 'next/headers';
import { createApiClient } from '@lumin/api-client';
import { coreApiBaseUrl } from './core-api';
import { CUSTOMER_COOKIE } from './customer-session-cookie';
import type { PetSpecies } from './pet-page';

// The client bridge to POST /pet-tags/{shortId}/activate (P3-t t-3): onboarding completion. The wizard runs
// in the browser but CORE_API_URL is server-only, so it calls this Server Action, which forwards the
// customer session cookie (the endpoint is customer-authed). core-api attaches the tag to the signed-in
// account, creates the profile, records the PDPL consent grant, and flips the tag ACTIVATED — all atomic.
// Failures map to a small closed `code`; the raw Vietnamese envelope is never forwarded (always-must #3).

export type ActivateInput = {
  petName: string;
  species: PetSpecies;
  breed?: string;
  age?: string;
  weight?: string;
  photoUrl?: string;
  medical?: {
    vaccinated?: boolean;
    neutered?: boolean;
    allergies?: string;
    vetClinic?: string;
  };
  ownerContact: { name: string; phone: string; zalo?: string };
  socials?: { platform: string; handle: string }[];
  consent: boolean;
};

export type ActivateResult =
  | { ok: true; handle: string; shortId: string }
  // unauthenticated = no/expired session (re-login); conflict = tag already activated; validation = a
  // rejected field; error = network / 5xx (retryable).
  | { ok: false; code: 'unauthenticated' | 'conflict' | 'validation' | 'error' };

export async function activatePetTag(
  shortId: string,
  input: ActivateInput,
): Promise<ActivateResult> {
  const jwt = (await cookies()).get(CUSTOMER_COOKIE)?.value;
  if (!jwt) return { ok: false, code: 'unauthenticated' }; // no session → skip the round-trip
  try {
    const client = createApiClient({
      baseUrl: coreApiBaseUrl(),
      headers: { cookie: `${CUSTOMER_COOKIE}=${jwt}` },
    });
    const { data, response } = await client.POST('/pet-tags/{shortId}/activate', {
      params: { path: { shortId } },
      body: input,
    });
    if (data) return { ok: true, handle: data.profile?.handle ?? '', shortId: data.shortId };
    if (response.status === 401) return { ok: false, code: 'unauthenticated' };
    if (response.status === 409) return { ok: false, code: 'conflict' };
    if (response.status === 400) return { ok: false, code: 'validation' };
    return { ok: false, code: 'error' };
  } catch {
    return { ok: false, code: 'error' };
  }
}
