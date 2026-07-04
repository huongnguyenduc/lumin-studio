import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ProductDetail } from '@/components/product-detail';
import { ProductReviews } from '@/components/product-reviews';
import { fetchProductBySlug, fetchProductReviews } from '@/lib/catalog';
import { totalPages } from '@/lib/catalog-params';
import { parseReviewsPage } from '@/lib/product-view';

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
  // Unknown/draft/archived → a neutral 404 title (the page below renders the not-found view).
  if (!product) {
    return { title: t('notFoundTitle') };
  }
  return { title: t('metaTitle', { name: product.name }) };
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

  return (
    <>
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
