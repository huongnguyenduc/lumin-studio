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
// content can never draw under (confirmed: Safari's contentInset.top ignores
// viewport-fit in tab mode). What DOES work in tab mode is themeColor: Safari
// tints that chrome from it. #edf1f1 is the averaged pixel color of the top
// ~3% of hero.jpg (sky/veil), so the strip blends with the photo instead of
// standing out as a flat cream band. Static, not settings.heroUrl-derived —
// only mismatches if an admin swaps in a hero photo with a very different
// top color, which nobody has done yet.
export const viewport: Viewport = { viewportFit: 'cover', themeColor: '#edf1f1' };

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
