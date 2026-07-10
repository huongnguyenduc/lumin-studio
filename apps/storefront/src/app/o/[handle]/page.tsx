import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { parseTrackHandle } from '@/lib/order-lookup-view';
import { TrackInvalid, WaitScreen } from '@/components/wait-screen';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('track');
  // A private, per-order tracking page whose token is a bearer capability — keep it out of search
  // indexes (storefront rule §SEO: chặn index order-lookup/checkout).
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

// Phone-less order tracking deep link `/o/{code}-{token}` (P2-g, D-P2-8). Route params are async in
// Next 15. The handle is parsed here (pure, no round-trip): a malformed one renders the invalid-link
// state without touching core-api; a valid one hands the code + token to the shared wait-screen, which
// polls GET /orders/track and shows the live timeline (a wrong/expired token funnels to the same
// invalid-link state via the poll's uniform 404).
export default async function TrackByLinkPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const parsed = parseTrackHandle(handle);
  if (!parsed) {
    return (
      <section className="mx-auto w-full max-w-[560px] px-4 py-6 md:px-6 md:py-10">
        <TrackInvalid />
      </section>
    );
  }
  return <WaitScreen code={parsed.code} token={parsed.token} />;
}
