import { useTranslations } from 'next-intl';
import { Card } from '@lumin/ui';
import { PrinterIcon, RefreshIcon } from './icons';

/** Two reassurance cards (made-to-order · free reprint). Static → server component. */
export function Trust() {
  const t = useTranslations('trust');

  const items = [
    { Icon: PrinterIcon, title: t('madeToOrderTitle'), body: t('madeToOrderBody') },
    { Icon: RefreshIcon, title: t('reprintTitle'), body: t('reprintBody') },
  ];

  return (
    <section className="mx-auto w-full max-w-[1200px] px-4 py-8 md:px-6">
      <h2 className="mb-5 text-2xl md:text-3xl">{t('heading')}</h2>
      <div className="grid gap-4 md:grid-cols-2">
        {items.map((item) => (
          <Card key={item.title} elevation="md" className="flex flex-col gap-3 p-6">
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-accent-teal-soft text-accent-teal">
              <item.Icon className="h-6 w-6" />
            </span>
            <h3 className="font-display text-lg font-bold text-text-strong">{item.title}</h3>
            <p className="text-sm leading-relaxed text-text-muted">{item.body}</p>
          </Card>
        ))}
      </div>
    </section>
  );
}
