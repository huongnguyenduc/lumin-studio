import { getTranslations } from 'next-intl/server';

// Scaffold placeholder — the real invitation page (fixed 393px card, HANDOFF §2)
// lands in step 4 as SSR-per-guest at /i/<slug>.
export default async function HomePage() {
  const t = await getTranslations('home');
  return (
    <main className="flex min-h-screen items-center justify-center">
      <p className="font-serif text-sm italic text-tan">{t('placeholder')}</p>
    </main>
  );
}
