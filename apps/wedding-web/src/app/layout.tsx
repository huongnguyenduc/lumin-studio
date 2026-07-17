import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';
import { fontScript, fontSerif } from '@/fonts';
import { getSettings } from '@/lib/api';
import { asSiteSettings } from '@/lib/site-settings';
import { locale } from '@/messages';
import './globals.css';

// Site meta is admin-configurable (HANDOFF §3.5): settings override the catalog
// defaults so link previews on Zalo/Messenger show the host's title/OG/icon.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('meta');
  const s = asSiteSettings(await getSettings());
  return {
    title: s.siteTitle ?? t('title'),
    description: s.siteDesc ?? t('description'),
    openGraph: s.ogUrl ? { images: [s.ogUrl] } : undefined,
    icons: s.iconUrl ? { icon: s.iconUrl } : undefined,
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
