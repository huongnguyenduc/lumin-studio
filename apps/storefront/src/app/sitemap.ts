import type { MetadataRoute } from 'next';
import { fetchAllProductSlugs } from '@/lib/catalog';
import { siteBaseUrl } from '@/lib/site';

// XML sitemap (plan §3 P1-q): the two indexable static surfaces + every active product detail page.
// Private/noindex routes (cart, lookup) are deliberately absent. No `lastModified` — the card projection
// carries no updatedAt, and a build-time timestamp would be non-deterministic (conventions §determinism);
// changeFrequency/priority are enough signal for a small made-to-order catalog.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteBaseUrl();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: 'daily', priority: 1 },
    { url: `${base}/danh-muc`, changeFrequency: 'daily', priority: 0.8 },
  ];

  let slugs: string[] = [];
  try {
    slugs = await fetchAllProductSlugs();
  } catch (err) {
    // A transient core-api failure during a sitemap (re)generation degrades to the static routes rather
    // than 500-ing /sitemap.xml — the next revalidation (tag `catalog` + 300s) picks the products back
    // up. Logged for ops. (Contrast the home page, which throws to its error boundary — a broken sitemap
    // should stay valid-but-partial, not error the crawler.)
    console.error('sitemap: product listing failed, emitting static routes only', err);
  }

  const productRoutes: MetadataRoute.Sitemap = slugs.map((slug) => ({
    url: `${base}/san-pham/${encodeURIComponent(slug)}`,
    changeFrequency: 'weekly',
    priority: 0.6,
  }));

  return [...staticRoutes, ...productRoutes];
}
