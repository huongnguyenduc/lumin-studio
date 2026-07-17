import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';
import { fontScript, fontSerif } from '@/fonts';
import { locale } from '@/messages';
import './globals.css';

// Site meta becomes admin-configurable (HANDOFF §3.5) — this static catalog version
// is the default until the settings-driven metadata lands with the admin slice.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('meta');
  return {
    title: t('title'),
    description: t('description'),
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const messages = await getMessages();
  return (
    <html lang={locale} className={`${fontScript.variable} ${fontSerif.variable}`}>
      <body>
        <NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
