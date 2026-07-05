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
      // Private per-visitor / internal paths that exist today. Admin is a SEPARATE app (not this origin).
      // `/tai-khoan` (+ its /dang-nhap, /dang-ky sub-routes) is the customer account (P1-s) — private, per
      // customer; a prefix disallow covers the whole subtree. Each of these also carries its own per-page
      // noindex (belt + suspenders). Checkout (Phase 2) will add its path here when it lands.
      disallow: ['/gio-hang', '/tra-cuu-don', '/tai-khoan', '/api/'],
    },
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
