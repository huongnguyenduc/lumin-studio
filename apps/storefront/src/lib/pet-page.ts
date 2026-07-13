import 'server-only';

import { cookies } from 'next/headers';
import { createApiClient } from '@lumin/api-client';
import { coreApiBaseUrl } from './core-api';
import { CUSTOMER_COOKIE } from './customer-session-cookie';

// Server-only reads for the public pet page (/t/{shortId}, P3-t t-3). The page is public — anyone who taps
// the chip reads it — so fetchPetPage forwards NO cookie; the activation POST (pet-actions.ts) is the only
// authed call. The wire shape is mapped to a storefront-owned type so the page never depends on the
// generated API types (mirrors customer-session.ts). Importing next/headers + CORE_API_URL keeps this off
// the client bundle.

export type PetTagStatus = 'UNENCODED' | 'ENCODED' | 'ACTIVATED';
export type PetSpecies = 'dog' | 'cat' | 'other';

export type PetPageProfile = {
  handle: string;
  petName: string;
  species: PetSpecies;
  photoUrl?: string;
};

export type PetPage = {
  shortId: string;
  status: PetTagStatus;
  profile?: PetPageProfile;
};

export type PetPageResult =
  | { status: 'ok'; page: PetPage }
  | { status: 'notFound' } // unknown shortId (404) → a friendly "not found" state
  | { status: 'error' }; // network / 5xx — retryable

export async function fetchPetPage(shortId: string): Promise<PetPageResult> {
  try {
    const client = createApiClient({ baseUrl: coreApiBaseUrl() });
    // Status flips on activation, so read live (never a cached poll).
    const { data, response } = await client.GET('/pet-tags/{shortId}', {
      params: { path: { shortId } },
      cache: 'no-store',
    });
    if (data) {
      const page: PetPage = {
        shortId: data.shortId,
        status: data.status as PetTagStatus,
        ...(data.profile
          ? {
              profile: {
                handle: data.profile.handle,
                petName: data.profile.petName,
                species: data.profile.species as PetSpecies,
                ...(data.profile.photoUrl ? { photoUrl: data.profile.photoUrl } : {}),
              },
            }
          : {}),
      };
      return { status: 'ok', page };
    }
    if (response.status === 404) return { status: 'notFound' };
    return { status: 'error' };
  } catch {
    return { status: 'error' };
  }
}

/** Whether a customer session cookie is present — the /t/{shortId} page uses it to route an unactivated
 *  tag: signed-in → onboarding (they claim it), signed-out → the "new tag" welcome + login. The activation
 *  POST is the real gate (an expired cookie there → 401 surfaced as "session expired"), so a soft
 *  cookie-presence check here is enough. */
export async function hasCustomerSession(): Promise<boolean> {
  return Boolean((await cookies()).get(CUSTOMER_COOKIE)?.value);
}
