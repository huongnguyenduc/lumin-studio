import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';
// Self-hosted fonts (Fontsource — bundled woff2 including the `vietnamese` subset; no runtime font
// CDN, no build-time fetch). Registered families: 'Bricolage Grotesque Variable' · 'Plus Jakarta
// Sans Variable' · 'Space Mono', mapped in tailwind.config.ts. Plus Jakarta Sans stands in for
// Hanken Grotesque (not shipped by Next/Fontsource); design-system.md marks the body font swappable.
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/plus-jakarta-sans';
import '@fontsource/space-mono/400.css';
import '@fontsource/space-mono/700.css';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { BottomNav } from '@/components/bottom-nav';
import { locale } from '@/messages';
import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('meta');
  return { title: t('title'), description: t('description') };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Whole catalog goes to the client provider so client components (header, grid) can translate.
  const messages = await getMessages();
  const t = await getTranslations('nav');

  return (
    <html lang={locale}>
      <body className="flex min-h-dvh flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-surface-card focus:px-4 focus:py-2 focus:shadow-md"
        >
          {t('skipToContent')}
        </a>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <SiteHeader />
          <main id="main" className="flex-1 pb-20 md:pb-0">
            {children}
          </main>
          <SiteFooter />
          <BottomNav />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
