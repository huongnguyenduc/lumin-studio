import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';
import { fontBody, fontDisplay, fontMono } from '@/fonts';
import { Sidebar } from '@/components/sidebar';
import { locale } from '@/messages';
import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('meta');
  return { title: t('title'), description: t('description') };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Whole catalog goes to the client provider so client components (sidebar) can translate.
  const messages = await getMessages();
  const t = await getTranslations('nav');

  // Admin chrome = fixed left sidebar (from lg) + main content offset by the rail width. On smaller
  // screens the sidebar collapses to a scrolling top bar and the main content sits below it (admin is
  // a desktop-first tool — see Sidebar). The content area is itself capped + padded.
  return (
    <html
      lang={locale}
      className={`${fontDisplay.variable} ${fontBody.variable} ${fontMono.variable}`}
    >
      <body className="min-h-dvh bg-surface-page">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-surface-card focus:px-4 focus:py-2 focus:shadow-md"
        >
          {t('skipToContent')}
        </a>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <Sidebar />
          <main id="main" className="lg:pl-64">
            <div className="mx-auto w-full max-w-[1200px] px-4 py-8 md:px-6 lg:px-8">
              {children}
            </div>
          </main>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
