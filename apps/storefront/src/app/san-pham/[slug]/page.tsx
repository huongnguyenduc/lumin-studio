import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ProductDetail } from '@/components/product-detail';
import { ProductReviews } from '@/components/product-reviews';
import { fetchProductBySlug, fetchProductReviews } from '@/lib/catalog';
import { totalPages } from '@/lib/catalog-params';
import { parseReviewsPage } from '@/lib/product-view';
import {
  BRAND,
  buildProductJsonLd,
  jsonLdScriptContent,
  productOgImages,
} from '@/lib/product-jsonld';
import { siteBaseUrl } from '@/lib/site';

// Dynamic route params + searchParams are async in Next 15 (awaited below). The product fetch is
// request-memoised, so calling fetchProductBySlug in BOTH generateMetadata and the page issues a single
// network read. `reviewsPage` paginates the reviews section server-side (URL is the source of truth).
type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ reviewsPage?: string | string[] }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const t = await getTranslations('productDetail');
  const product = await fetchProductBySlug(slug);
  // Unknown/draft/archived → a neutral 404 title + NOINDEX so crawlers don't index the not-found view
  // (rendered below); no leak of which state it is (P1-a uniform 404).
  if (!product) {
    return { title: t('notFoundTitle'), robots: { index: false, follow: false } };
  }

  const title = t('metaTitle', { name: product.name });
  // og:image = the real product photo (images[0]) when it's absolute — the highest-value share image for
  // the inbox/MXH sales channel — else the site's default branded card. productOgImages ALWAYS returns a
  // non-empty list: Next fully REPLACES the parent openGraph here (see below), so an omitted images key
  // would strip the inherited default card and leave the product share imageless.
  const ogImages = productOgImages(product.images[0]);

  // Re-declare siteName/locale/type: Next shallow-REPLACES the whole openGraph object when a child sets
  // it (it does not deep-merge the layout's defaults), so they must be repeated here or they'd be lost.
  return {
    title,
    description: product.description,
    alternates: { canonical: `/san-pham/${encodeURIComponent(slug)}` },
    openGraph: {
      type: 'website',
      siteName: BRAND,
      locale: 'vi_VN',
      title,
      description: product.description,
      images: ogImages,
    },
  };
}

// Server component: fetches one active product by slug (CORE_API_URL stays server-side). A 404 (unknown
// slug OR draft/archived — uniform, no leak) → notFound() → the route not-found.tsx. Any other failure
// throws → app/error.tsx retry boundary. Loading is the segment loading.tsx skeleton. The reviews section
// (P1-m) paginates via `?reviewsPage=`, fetched after the product so a 404 short-circuits to notFound().
export default async function ProductDetailPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const product = await fetchProductBySlug(slug);

  if (!product) {
    notFound();
  }

  const reviewsPage = parseReviewsPage((await searchParams).reviewsPage);
  const reviews = await fetchProductReviews(slug, reviewsPage);

  // Out-of-range page on a non-empty product (e.g. ?reviewsPage=9 of a 2-page product) → redirect to the
  // last page rather than showing a false-empty section with a dead pager (the adjudicated P1-g fix). The
  // #reviews fragment lands the reader at the section. total === 0 is left alone → the empty state renders.
  const pageCount = totalPages(reviews.total, reviews.pageSize);
  if (reviews.total > 0 && reviewsPage > pageCount) {
    const base = `/san-pham/${encodeURIComponent(slug)}`;
    redirect(pageCount <= 1 ? `${base}#reviews` : `${base}?reviewsPage=${pageCount}#reviews`);
  }

  // schema.org Product/Offer for rich results (P1-q): PreOrder availability, no AggregateRating yet.
  // The canonical product URL is absolute (siteBaseUrl); jsonLdScriptContent escapes `<` so admin text
  // can't break out of the <script>.
  const jsonLd = jsonLdScriptContent(
    buildProductJsonLd(product, `${siteBaseUrl()}/san-pham/${encodeURIComponent(slug)}`),
  );

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
      <ProductDetail product={product} />
      <ProductReviews
        slug={product.slug}
        reviews={reviews.items}
        total={reviews.total}
        page={reviews.page}
        pageSize={reviews.pageSize}
        productRating={product.rating}
      />
    </>
  );
}
