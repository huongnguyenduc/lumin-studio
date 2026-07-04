import { useTranslations } from 'next-intl';

const CHIP_KEYS = ['c1', 'c2', 'c3', 'c4'] as const;
const CARD_KEYS = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'] as const;

/** Route-level loading skeleton for /danh-muc (conventions §State: skeleton preferred). Mirrors the
 *  page shape — heading, search + chip row, 2/4-up card grid — so the layout doesn't shift on load.
 *  animate-pulse is stilled by prefers-reduced-motion (global tokens CSS). */
export default function Loading() {
  const t = useTranslations('states');

  return (
    <div
      role="status"
      aria-live="polite"
      className="mx-auto w-full max-w-[1200px] px-4 py-8 md:px-6"
    >
      <span className="sr-only">{t('loading')}</span>

      <div className="mb-6 h-9 w-40 animate-pulse rounded-md bg-surface-sunken" />
      <div className="mb-3 h-11 w-full animate-pulse rounded-pill bg-surface-sunken" />
      <div className="mb-6 flex gap-2">
        {CHIP_KEYS.map((key) => (
          <div key={key} className="h-11 w-20 animate-pulse rounded-pill bg-surface-sunken" />
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        {CARD_KEYS.map((key) => (
          <div key={key} className="flex flex-col gap-2">
            <div className="aspect-square animate-pulse rounded-md bg-surface-sunken" />
            <div className="h-4 w-3/4 animate-pulse rounded bg-surface-sunken" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-surface-sunken" />
          </div>
        ))}
      </div>
    </div>
  );
}
