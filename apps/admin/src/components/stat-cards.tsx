import { useTranslations } from 'next-intl';
import { formatVnd, formatVnNumber } from '@lumin/core';
import { Card, cn } from '@lumin/ui';
import type { StatCard } from '@/lib/dashboard';

/**
 * The four dashboard KPI cards (design: Lumin Admin Hi-fi — mono-uppercase label, money in coral).
 * Counts via formatVnNumber, money via formatVnd (exact VND like `2.400.000₫`, never abbreviated —
 * the hi-fi's compact `₫2.4M` would need a second money format; one core formatter, ADR-019). The "needs attention" stat gets a coral
 * outline; that border-presence is a non-hue signal for sighted (incl. colorblind) users, and an
 * sr-only "cần chú ý" cue carries the same meaning to screen readers so the highlight is never
 * color-only (WCAG 1.4.1). Data comes from GET /admin/dashboard via the page (PR-3j); server component.
 */
export function StatCards({ stats }: { stats: StatCard[] }) {
  const t = useTranslations('dashboard');

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {stats.map((stat) => (
        <Card
          key={stat.labelKey}
          elevation="md"
          className={cn('flex flex-col gap-2 p-5', stat.highlight && 'border-2 border-primary')}
        >
          <span className="font-mono text-[11px] font-bold uppercase tracking-wide text-text-muted">
            {t(stat.labelKey)}
            {stat.highlight && <span className="sr-only"> — {t('needsAttention')}</span>}
          </span>
          <span
            className={cn(
              'font-display text-2xl font-extrabold md:text-3xl',
              stat.kind === 'money' ? 'text-primary' : 'text-text-strong',
            )}
          >
            {stat.kind === 'money' ? formatVnd(stat.value) : formatVnNumber(stat.value)}
          </span>
        </Card>
      ))}
    </div>
  );
}
