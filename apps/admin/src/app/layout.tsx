import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';
import { fontBody, fontDisplay, fontMono } from '@/fonts';
import { locale } from '@/messages';
import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('meta');
  return { title: t('title'), description: t('description') };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Root = <html>/<body>, fonts, and the i18n provider only. The admin chrome (sidebar + content
  // offset) lives in the (app) route group so it wraps the authenticated pages but NOT /dang-nhap —
  // the login screen renders full-bleed with no nav (P3-a).
  // Whole catalog goes to the client provider so client components (sidebar, login form) can
  // translate. TODO(phase-3): scope this to the namespaces the client tree actually uses — once
  // @lumin/core's domain catalog grows, shipping it whole to every client page is wasted bytes.
  const messages = await getMessages();

  return (
    <html
      lang={locale}
      className={`${fontDisplay.variable} ${fontBody.variable} ${fontMono.variable}`}
    >
      <body className="min-h-dvh bg-surface-page">
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
