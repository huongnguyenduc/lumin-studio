import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { fetchPetPage, hasCustomerSession } from '@/lib/pet-page';
import { NewTagWelcome, PetPageUnavailable } from '@/components/pet-page-states';
import { PetPage } from '@/components/pet-page';
import { PetOnboarding } from '@/components/pet-onboarding';

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
    return <PetPage page={page} />;
  }
  if (page.status === 'ENCODED') {
    const signedIn = await hasCustomerSession();
    return signedIn ? <PetOnboarding shortId={shortId} /> : <NewTagWelcome shortId={shortId} />;
  }
  // UNENCODED (or an ACTIVATED tag whose profile somehow failed to load) → not yet ready to open.
  return <PetPageUnavailable variant="notReady" />;
}
