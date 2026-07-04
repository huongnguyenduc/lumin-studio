import { useTranslations } from 'next-intl';
import { CtaLink } from './cta-link';
import { SearchIcon } from './icons';
import { CatalogCard } from './catalog-card';
import { buildCatalogHref, emptyStateKind, type CatalogParams } from '@/lib/catalog-params';
import type { ProductCardView } from '@/lib/product-view';

const BASE = '/danh-muc';

/** Centred empty-state block: icon + title + body + a recovery CTA (conventions §State: empty needs a
 *  USEFUL CTA). Shared shell so the three cases differ only in copy + CTA target. */
function EmptyState({
  title,
  body,
  cta,
}: {
  title: string;
  body: string;
  cta?: { href: string; label: string };
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-16 text-center">
      <span
        className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-dashed border-border-default bg-surface-sunken text-text-subtle"
        aria-hidden="true"
      >
        <SearchIcon className="h-9 w-9" />
      </span>
      <h2 className="font-display text-lg font-bold text-text-strong">{title}</h2>
      <p className="max-w-sm text-sm text-text-muted">{body}</p>
      {cta ? (
        <CtaLink href={cta.href} className="mt-2">
          {cta.label}
        </CtaLink>
      ) : null}
    </div>
  );
}

/**
 * The catalog-browse results region (/danh-muc): the product grid, or — when a page has zero matches —
 * ONE of three distinct empty states (plan §3 P1-g "empty-filter vs empty-search distinguished"):
 *   • search  → a search found nothing (clear the search)
 *   • filter  → a category filter found nothing (clear the filter)
 *   • catalog → the catalog itself is bare (nothing to recover to; link home)
 * A server component — no interactivity, the grid + cards are all server-rendered (SEO/CWV). Loading is
 * the route loading.tsx skeleton; a fetch failure is the route error.tsx boundary.
 */
export function CatalogResults({
  products,
  params,
}: {
  products: ProductCardView[];
  params: CatalogParams;
}) {
  const t = useTranslations('catalog');

  if (products.length === 0) {
    const kind = emptyStateKind(params);

    if (kind === 'search') {
      return (
        <EmptyState
          title={t('emptySearchTitle')}
          body={t('emptySearchBody', { query: params.q ?? '' })}
          // Clear the search but keep any active category (the shopper may still want to browse it).
          cta={{
            href: buildCatalogHref(BASE, params, { q: undefined }),
            label: t('emptySearchCta'),
          }}
        />
      );
    }

    if (kind === 'filter') {
      return (
        <EmptyState
          title={t('emptyFilterTitle')}
          body={t('emptyFilterBody')}
          // Clear every filter → the full catalog.
          cta={{
            href: buildCatalogHref(BASE, params, { category: undefined, q: undefined }),
            label: t('emptyFilterCta'),
          }}
        />
      );
    }

    // Bare catalog (no filter, no search) — nothing to clear; offer a way home.
    return <EmptyState title={t('emptyCatalogTitle')} body={t('emptyCatalogBody')} />;
  }

  return (
    <>
      {/* Visually-hidden section heading so the order is h1 (page) → h2 → h3 (card titles), never a
          h1 → h3 skip (the cards' h3 comes from the shared ProductCard, which sits under an h2 on the
          home page but has no section heading here). */}
      <h2 className="sr-only">{t('resultsHeading')}</h2>
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        {products.map((product) => (
          <li key={product.id}>
            <CatalogCard product={product} />
          </li>
        ))}
      </ul>
    </>
  );
}
