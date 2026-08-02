import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { fetchPetPage } from '@/lib/pet-page';
import { getCustomerProfile } from '@/lib/customer-session';
import { NewTagWelcome, PetPageUnavailable } from '@/components/pet-page-states';
import { PetPage } from '@/components/pet-page';
import { PetOnboarding } from '@/components/pet-onboarding';
import { TrackScan } from '@/components/track-scan';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('petTag');
  // A public, per-pet page keyed by an unguessable shortId — keep it out of search indexes (storefront
  // rule §SEO, mirrors /o/{handle}). robots.ts already blocks /t via the sitemap; this is defence in depth.
  return { title: t('meta.title'), robots: { index: false, follow: false } };
}

// The pet page (spec §10, P3-t t-3). One URL, routed by tag status + auth:
//   • unknown shortId → not-found · UNENCODED (chip not written) → not-ready · fetch error → error
//   • ENCODED + signed in → the onboarding wizard (they claim the tag) · signed out → the "new tag" welcome
//   • ACTIVATED → the live 3-state pet page (owner-edit / stranger-home / stranger-lost), routed inside
//     PetPage by viewerIsOwner + lostMode (P3-t t-4a; the in-place editor + theme land in t-4c)
// Route params are async in Next 15. The status read forwards the customer cookie when present (so the owner
// is recognised); only the activate + lost-mode toggle POSTs are strictly authed.
export default async function PetTagPage({ params }: { params: Promise<{ shortId: string }> }) {
  const { shortId } = await params;
  const result = await fetchPetPage(shortId);

  if (result.status === 'notFound') return <PetPageUnavailable variant="notFound" />;
  if (result.status === 'error') return <PetPageUnavailable variant="error" />;

  const { page } = result;
  if (page.status === 'ACTIVATED' && page.profile) {
    return (
      <>
        <TrackScan state={page.profile.lostMode ? 'lost' : 'home'} />
        <PetPage page={page} />
      </>
    );
  }
  if (page.status === 'ENCODED') {
    // A resolved profile means a live session (the profile cookie is only ever set alongside the JWT —
    // see customer-session-cookie.ts) — reusing it both answers "signed in?" AND seeds step 2's contact
    // fields, one read instead of two. Display-only cache (never verified), so it's a SEED the shopper
    // can overwrite, not a source of truth.
    const profile = await getCustomerProfile();
    return (
      <>
        <TrackScan state="encoded" />
        {profile ? (
          <PetOnboarding
            shortId={shortId}
            contactSeed={{ name: profile.name, phone: profile.phone }}
          />
        ) : (
          <NewTagWelcome shortId={shortId} />
        )}
      </>
    );
  }
  // UNENCODED (or an ACTIVATED tag whose profile somehow failed to load) → not yet ready to open.
  return <PetPageUnavailable variant="notReady" />;
}
