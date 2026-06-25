import { useTranslations } from 'next-intl';
import { formatVnd, formatVnNumber } from '@lumin/core';
import { Card, cn } from '@lumin/ui';
import { demoStats } from '@/lib/demo-dashboard';

/**
 * The four dashboard KPI cards (design: Lumin Admin Hi-fi). Counts via formatVnNumber, money via
 * formatVnd (exact VND like `2.400.000₫`, never abbreviated). The "needs attention" stat gets a coral
 * outline. Static → server component.
 */
export function StatCards() {
  const t = useTranslations('dashboard');

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {demoStats.map((stat) => (
        <Card
          key={stat.labelKey}
          elevation="md"
          className={cn('flex flex-col gap-2 p-5', stat.highlight && 'border-2 border-primary')}
        >
          <span className="text-sm font-semibold text-text-muted">{t(stat.labelKey)}</span>
          <span className="font-display text-2xl font-extrabold text-text-strong md:text-3xl">
            {stat.kind === 'money' ? formatVnd(stat.value) : formatVnNumber(stat.value)}
          </span>
        </Card>
      ))}
    </div>
  );
}
