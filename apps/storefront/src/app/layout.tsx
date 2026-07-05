import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';
import { fontBody, fontDisplay, fontMono } from '@/fonts';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { BottomNav } from '@/components/bottom-nav';
import { ConsentBanner } from '@/components/consent-banner';
import { locale } from '@/messages';
import { siteBaseUrl } from '@/lib/site';
import { BRAND } from '@/lib/product-jsonld';
import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('meta');
  const title = t('title');
  const description = t('description');
  return {
    // Resolves every page's relative `alternates.canonical` + `openGraph.images` to an absolute URL, and
    // anchors the default OG card (app/opengraph-image.tsx). Server-only + thrown-not-defaulted (see
    // lib/site.ts) — a silent localhost base would de-index the site.
    metadataBase: new URL(siteBaseUrl()),
    title,
    description,
    // Default Open Graph for the whole site (P1-q). A page may override — the product detail sets the
    // real product photo as its og:image; anything without its own inherits the branded opengraph-image.
    openGraph: {
      type: 'website',
      siteName: BRAND,
      locale: 'vi_VN',
      title,
      description,
    },
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Whole catalog goes to the client provider so client components (header, grid) can translate.
  // TODO(phase-1): scope this to the namespaces the client tree actually uses — once @lumin/core's
  // domain catalog grows, shipping it whole to every client page is wasted bytes.
  const messages = await getMessages();
  const t = await getTranslations('nav');

  return (
    <html
      lang={locale}
      className={`${fontDisplay.variable} ${fontBody.variable} ${fontMono.variable}`}
    >
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
          <ConsentBanner />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
