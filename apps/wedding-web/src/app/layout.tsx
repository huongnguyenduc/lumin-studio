import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';
import { fontScript, fontSerif } from '@/fonts';
import { getSettings } from '@/lib/api';
import { asSiteSettings } from '@/lib/site-settings';
import { locale } from '@/messages';
import './globals.css';

// viewportFit: 'cover' matters only for standalone/home-screen mode — in a
// normal Safari tab the status bar strip is fixed browser chrome that page
// content can never draw under. themeColor covers browsers that do tint that
// chrome from it; iOS Safari in practice takes the body background instead
// (see globals.css), so both carry the same value: #eff3f2, the averaged
// color of the hero photo's visible top edge.
export const viewport: Viewport = { viewportFit: 'cover', themeColor: '#eff3f2' };

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
