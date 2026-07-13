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

// unauthenticated = no/expired session; forbidden = signed in but not this pet's owner (the SQL owner guard);
// error = network / 5xx / bad link (retryable). The toggle is owner-only, so these are the meaningful cases.
export type ToggleLostModeResult =
  | { ok: true }
  | { ok: false; code: 'unauthenticated' | 'forbidden' | 'error' };

// toggleLostMode bridges the owner's lost-mode switch to PATCH /pet-tags/{shortId}/lost-mode (P3-t t-4a).
// The switch runs in the browser but CORE_API_URL is server-only, so it calls this Server Action, which
// forwards the customer cookie (the endpoint is customer-authed + owner-guarded server-side). On success the
// caller router.refresh()es so the server component re-renders in the new view-state.
export async function toggleLostMode(
  shortId: string,
  lostMode: boolean,
): Promise<ToggleLostModeResult> {
  const jwt = (await cookies()).get(CUSTOMER_COOKIE)?.value;
  if (!jwt) return { ok: false, code: 'unauthenticated' }; // no session → skip the round-trip
  try {
    const client = createApiClient({
      baseUrl: coreApiBaseUrl(),
      headers: { cookie: `${CUSTOMER_COOKIE}=${jwt}` },
    });
    const { data, response } = await client.PATCH('/pet-tags/{shortId}/lost-mode', {
      params: { path: { shortId } },
      body: { lostMode },
    });
    if (data) return { ok: true };
    if (response.status === 401) return { ok: false, code: 'unauthenticated' };
    if (response.status === 403) return { ok: false, code: 'forbidden' };
    return { ok: false, code: 'error' };
  } catch {
    return { ok: false, code: 'error' };
  }
}

// The wire payload for the in-place editor's save (P3-t t-4c-1) — the full editable page content. petName +
// species + ownerContact are required; the rest optional (an absent field clears it). Mirrors the server's
// PetProfileUpdateInput; theme/blocks/lostMode/handle are NOT here (their own endpoints / t-4c-2).
export type ProfileUpdateInput = {
  petName: string;
  species: PetSpecies;
  breed?: string;
  age?: string;
  weight?: string;
  photoUrl?: string;
  bio?: string;
  gallery?: string[];
  favorites?: string[];
  medical?: { vaccinated?: boolean; neutered?: boolean; allergies?: string; vetClinic?: string };
  ownerContact: { name: string; phone: string; zalo?: string };
  socials?: { platform: string; handle: string }[];
};

// unauthenticated = no/expired session; forbidden = signed in but not this pet's owner (the SQL owner guard);
// validation = a rejected field (the client mirrors the rules, so this is a rare race); error = network / 5xx.
export type UpdateProfileResult =
  | { ok: true }
  | { ok: false; code: 'unauthenticated' | 'forbidden' | 'validation' | 'error' };

// updatePetProfile bridges the in-place editor's save to PATCH /pet-tags/{shortId}/profile (P3-t t-4c-1). The
// editor runs in the browser but CORE_API_URL is server-only, so it calls this Server Action, which forwards
// the customer cookie (the endpoint is customer-authed + owner-guarded server-side). On success the caller
// router.refresh()es so the server component re-renders with the edited content.
export async function updatePetProfile(
  shortId: string,
  input: ProfileUpdateInput,
): Promise<UpdateProfileResult> {
  const jwt = (await cookies()).get(CUSTOMER_COOKIE)?.value;
  if (!jwt) return { ok: false, code: 'unauthenticated' }; // no session → skip the round-trip
  try {
    const client = createApiClient({
      baseUrl: coreApiBaseUrl(),
      headers: { cookie: `${CUSTOMER_COOKIE}=${jwt}` },
    });
    const { data, response } = await client.PATCH('/pet-tags/{shortId}/profile', {
      params: { path: { shortId } },
      body: input,
    });
    if (data) return { ok: true };
    if (response.status === 401) return { ok: false, code: 'unauthenticated' };
    if (response.status === 403) return { ok: false, code: 'forbidden' };
    if (response.status === 400) return { ok: false, code: 'validation' };
    return { ok: false, code: 'error' };
  } catch {
    return { ok: false, code: 'error' };
  }
}

// The wire payload for the theme sheet + reorder mode save (P3-t t-4c-2) — a full replace of the page
// appearance (theme + block order/visibility), mirroring the server's PetAppearanceInput. Content fields
// (name/bio/…) are NOT here — they have their own PATCH (updatePetProfile). Kept apart so a theme change
// never risks the page text and vice versa.
export type AppearanceInput = {
  theme: {
    palette: string;
    background: string;
    bgImageUrl?: string;
    bgOpacity: number;
    nameFont: string;
  };
  blocks: { type: string; order: number; visible: boolean }[];
};

// updatePetAppearance bridges the theme sheet + reorder mode to PATCH /pet-tags/{shortId}/appearance (P3-t
// t-4c-2). Owner-only + customer-authed + owner-guarded server-side (the SQL owner_account_id guard), exactly
// like updatePetProfile. On success the caller router.refresh()es so the server component re-renders with the
// new theme + block order. validation is a rare race (the sheet only offers the fixed valid choices).
export async function updatePetAppearance(
  shortId: string,
  input: AppearanceInput,
): Promise<UpdateProfileResult> {
  const jwt = (await cookies()).get(CUSTOMER_COOKIE)?.value;
  if (!jwt) return { ok: false, code: 'unauthenticated' }; // no session → skip the round-trip
  try {
    const client = createApiClient({
      baseUrl: coreApiBaseUrl(),
      headers: { cookie: `${CUSTOMER_COOKIE}=${jwt}` },
    });
    const { data, response } = await client.PATCH('/pet-tags/{shortId}/appearance', {
      params: { path: { shortId } },
      body: input,
    });
    if (data) return { ok: true };
    if (response.status === 401) return { ok: false, code: 'unauthenticated' };
    if (response.status === 403) return { ok: false, code: 'forbidden' };
    if (response.status === 400) return { ok: false, code: 'validation' };
    return { ok: false, code: 'error' };
  } catch {
    return { ok: false, code: 'error' };
  }
}

// notLost = the pet was un-flagged (409) between page-load and submit — a rare race; error = network / 404 / 400
// / 429 / else. A denied browser-geolocation permission never reaches here (it is handled in the client).
export type ShareLocationResult = { ok: true } | { ok: false; code: 'notLost' | 'error' };

// sharePetLocation bridges the finder's one-shot location share to POST /pet-tags/{shortId}/share-location
// (P3-t t-4b). PUBLIC — the finder is an anonymous stranger, so NO cookie is required or forwarded. The lat/lng
// come from the browser geolocation API (the finder already granted permission client-side); core-api records
// ONE lost_events row. CORE_API_URL is server-only, so the client control calls this Server Action.
export async function sharePetLocation(
  shortId: string,
  lat: number,
  lng: number,
): Promise<ShareLocationResult> {
  try {
    const client = createApiClient({ baseUrl: coreApiBaseUrl() });
    const { data, response } = await client.POST('/pet-tags/{shortId}/share-location', {
      params: { path: { shortId } },
      body: { lat, lng },
    });
    if (data) return { ok: true };
    if (response.status === 409) return { ok: false, code: 'notLost' };
    return { ok: false, code: 'error' };
  } catch {
    return { ok: false, code: 'error' };
  }
}
