import 'server-only';

import { cookies } from 'next/headers';
import { createApiClient } from '@lumin/api-client';
import { coreApiBaseUrl } from './core-api';
import { CUSTOMER_COOKIE } from './customer-session-cookie';

// Server-only reads for the public pet page (/t/{shortId}, P3-t t-3/t-4a). The page is public — anyone who
// taps the chip reads it — but the customer cookie is forwarded WHEN PRESENT so core-api can recognise the
// owner (viewerIsOwner → un-masked contact). Masking is decided server-side (core-api), never here, so the
// raw phone never reaches the browser in the masked case. The wire shape is mapped to storefront-owned types
// so the page never depends on the generated API types (mirrors customer-session.ts). Importing next/headers
// + CORE_API_URL keeps this off the client bundle.

export type PetTagStatus = 'UNENCODED' | 'ENCODED' | 'ACTIVATED';
export type PetSpecies = 'dog' | 'cat' | 'other';

export type PetContact = {
  masked: boolean;
  phoneMasked: string;
  phone?: string;
  zalo?: string;
  email?: string;
  name?: string;
};

export type PetMedical = {
  vaccinated?: boolean;
  neutered?: boolean;
  allergies?: string;
  vetClinic?: string;
};

export type PetSocial = { platform: string; handle: string };

// The page theme (spec §10) — 5 brand colorways + Đêm cocoa, a background style + opacity, a name font. This
// slice (t-4c-1) carries the type + reads it through, but does NOT apply it; the theme sheet that writes it +
// the render that applies it land in t-4c-2 (safety colours are never themed).
export type PetTheme = {
  palette?: string;
  background?: string;
  bgImageUrl?: string;
  bgOpacity?: number;
  nameFont?: string;
};

// One content block's placement (spec §10 ProfileBlock). Read through here; the reorder mode that writes it
// lands in t-4c-2. photo_name is always first and can't be hidden.
export type PetBlock = { type: string; order: number; visible: boolean };

export type PetPageProfile = {
  handle: string;
  petName: string;
  species: PetSpecies;
  photoUrl?: string;
  breed?: string;
  age?: string;
  weight?: string;
  bio?: string;
  gallery?: string[];
  favorites?: string[];
  lostMode: boolean;
  medical?: PetMedical;
  socials?: PetSocial[];
  theme?: PetTheme;
  blocks?: PetBlock[];
  contact: PetContact;
};

// One finder location-share surfaced to the OWNER as an in-app notify (spec §10 D4, t-4b). Present in
// PetPage.recentScans only for the owner; mapUrl is an OpenStreetMap link to where the pet was scanned.
export type PetLostScan = { scannedAt: string; mapUrl: string };

export type PetPage = {
  shortId: string;
  status: PetTagStatus;
  viewerIsOwner: boolean;
  profile?: PetPageProfile;
  recentScans?: PetLostScan[];
};

export type PetPageResult =
  | { status: 'ok'; page: PetPage }
  | { status: 'notFound' } // unknown shortId (404) → a friendly "not found" state
  | { status: 'error' }; // network / 5xx — retryable

export async function fetchPetPage(shortId: string): Promise<PetPageResult> {
  try {
    const jwt = (await cookies()).get(CUSTOMER_COOKIE)?.value;
    const client = createApiClient({
      baseUrl: coreApiBaseUrl(),
      // Forward the customer session (if any) so the owner is recognised; a stale cookie is harmless
      // (core-api resolves it optionally and just falls back to the masked stranger view).
      ...(jwt ? { headers: { cookie: `${CUSTOMER_COOKIE}=${jwt}` } } : {}),
    });
    // Status + lostMode flip live, so read fresh (never a cached poll); the owner cookie also makes it per-user.
    const { data, response } = await client.GET('/pet-tags/{shortId}', {
      params: { path: { shortId } },
      cache: 'no-store',
    });
    if (data) {
      // Map wire → storefront types inline (data.profile is fully typed here). exactOptionalPropertyTypes
      // forbids assigning `undefined` to an optional key, so optional fields are conditionally spread.
      let profile: PetPageProfile | undefined;
      if (data.profile) {
        const p = data.profile;
        const c = p.contact;
        profile = {
          handle: p.handle,
          petName: p.petName,
          species: p.species as PetSpecies,
          lostMode: p.lostMode,
          contact: {
            masked: c.masked,
            phoneMasked: c.phoneMasked,
            ...(c.phone ? { phone: c.phone } : {}),
            ...(c.zalo ? { zalo: c.zalo } : {}),
            ...(c.email ? { email: c.email } : {}),
            ...(c.name ? { name: c.name } : {}),
          },
          ...(p.photoUrl ? { photoUrl: p.photoUrl } : {}),
          ...(p.breed ? { breed: p.breed } : {}),
          ...(p.age ? { age: p.age } : {}),
          ...(p.weight ? { weight: p.weight } : {}),
          ...(p.bio ? { bio: p.bio } : {}),
          ...(p.gallery && p.gallery.length ? { gallery: p.gallery } : {}),
          ...(p.favorites && p.favorites.length ? { favorites: p.favorites } : {}),
          ...(p.medical ? { medical: p.medical } : {}),
          ...(p.socials && p.socials.length ? { socials: p.socials } : {}),
          ...(p.theme ? { theme: p.theme } : {}),
          ...(p.blocks && p.blocks.length ? { blocks: p.blocks } : {}),
        };
      }
      const page: PetPage = {
        shortId: data.shortId,
        status: data.status as PetTagStatus,
        viewerIsOwner: data.viewerIsOwner,
        ...(profile ? { profile } : {}),
        // recentScans is present only for the owner (core-api gates it); a stranger's page omits it.
        ...(data.recentScans && data.recentScans.length ? { recentScans: data.recentScans } : {}),
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
