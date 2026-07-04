import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ProductDetail } from '@/components/product-detail';
import { fetchProductBySlug } from '@/lib/catalog';

// Dynamic route params are async in Next 15 (awaited below). The fetch is request-memoised, so calling
// fetchProductBySlug in BOTH generateMetadata and the page issues a single network read.
type PageProps = { params: Promise<{ slug: string }> };

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
// throws → app/error.tsx retry boundary. Loading is the segment loading.tsx skeleton.
export default async function ProductDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const product = await fetchProductBySlug(slug);

  if (!product) {
    notFound();
  }

  return <ProductDetail product={product} />;
}
