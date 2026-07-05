import type { Metadata } from 'next';
import { Hero } from '@/components/hero';
import { FeaturedProducts } from '@/components/featured-products';
import { Trust } from '@/components/trust';
import { fetchNewArrivals } from '@/lib/catalog';

// Title/description inherit from the root layout; this only pins the canonical (the home canonical is the
// bare origin, so a `?utm=…`-tagged share still consolidates to `/`).
export function generateMetadata(): Metadata {
  return { alternates: { canonical: '/' } };
}

// Server component: fetches the "Mới về" grid from core-api (server-side, CORE_API_URL never reaches
// the client). A fetch failure throws → app/error.tsx retry boundary; an empty result → the grid's
// designed empty state (conventions §State). Caching (tag + backstop timer) is configured in the fetch.
//
// Rendering: the fetch is cached (revalidate + tag), so this route static-prerenders at `next build` —
// a prebuilt home that Cloudflare + Next serve even while the all-home origin is rebooting (ADR-009:
// accept downtime + cache catalog mạnh so the read-path survives). The one-time cost is that a deploy
// build expects core-api reachable (the owner controls deploy timing). `pnpm verify` (the CI gate)
// does NOT run `next build`, so this coupling doesn't touch the PR gates; it's an ops concern for when
// the storefront Dockerfile lands.
export default async function HomePage() {
  const products = await fetchNewArrivals();

  return (
    <>
      <Hero />
      <FeaturedProducts products={products} />
      <Trust />
    </>
  );
}
