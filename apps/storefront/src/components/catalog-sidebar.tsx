import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { cn } from '@lumin/ui';
import { CheckIcon } from './icons';
import { buildCatalogHref, type CatalogParams } from '@/lib/catalog-params';
import type { CategoryView } from '@/lib/product-view';

const BASE = '/danh-muc';

/** One check-tile row (hi-fi sidebar: 18px rounded-square, checked = coral fill + white ✓). The rows
 *  are LINKS with radio semantics — the catalog's category filter is single-select (the endpoint takes
 *  one slug), so exactly one row is ever checked; aria-current conveys it. */
function CategoryRow({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'true' : undefined}
      className="flex min-h-[36px] items-center gap-2.5 rounded-sm text-sm font-semibold text-text-strong hover:text-text-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2"
    >
      <span
        aria-hidden="true"
        className={cn(
          'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border-2',
          active ? 'border-border-strong bg-accent-flame text-on-primary' : 'border-border-default',
        )}
      >
        {active ? <CheckIcon className="h-3 w-3" /> : null}
      </span>
      {children}
    </Link>
  );
}

/**
 * Desktop "Bộ lọc" sidebar (/danh-muc, hi-fi desktop category: 262px left rail on white). Phase 1
 * holds ONLY the category group — the hi-fi's price-range slider and colour dots have no backing
 * query params on GET /products, so they are deliberately not rendered (a dead control is worse than
 * a missing one; noted in the PR). Server component: pure links through buildCatalogHref, same URL
 * round-trip as the mobile chips.
 */
export function CatalogSidebar({
  categories,
  params,
}: {
  categories: CategoryView[];
  params: CatalogParams;
}) {
  const t = useTranslations('catalog');

  return (
    <div className="rounded-md border border-border-subtle bg-surface-card p-5">
      <h2 className="font-display text-lg font-bold text-text-strong">{t('filtersHeading')}</h2>

      <p className="mb-2 mt-4 text-[13px] text-text-muted">{t('categoryGroup')}</p>
      <nav aria-label={t('categoriesLabel')}>
        <ul className="flex flex-col gap-1">
          <li>
            <CategoryRow
              href={buildCatalogHref(BASE, params, { category: undefined })}
              active={!params.category}
            >
              {t('allCategories')}
            </CategoryRow>
          </li>
          {categories.map((category) => (
            <li key={category.id}>
              <CategoryRow
                href={buildCatalogHref(BASE, params, { category: category.slug })}
                active={params.category === category.slug}
              >
                {category.name}
              </CategoryRow>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
