import type { MetadataRoute } from 'next';
import { siteBaseUrl } from '@/lib/site';

// Site-wide robots.txt (plan §3 P1-q / storefront rule §SEO: chặn index checkout/lookup). Complements the
// per-page `robots: { index: false }` that private pages already set (cart gio-hang, lookup tra-cuu-don):
// this file is the crawl-level backstop + the sitemap pointer.
export default function robots(): MetadataRoute.Robots {
  const base = siteBaseUrl();
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // Private per-visitor / internal paths that exist today. Admin is a SEPARATE app (not this origin);
      // checkout (Phase 2) and the customer account (P1-s) don't exist yet — each will carry its own
      // per-page noindex when it lands (the cart/lookup pattern), so no speculative path is listed here.
      disallow: ['/gio-hang', '/tra-cuu-don', '/api/'],
    },
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
