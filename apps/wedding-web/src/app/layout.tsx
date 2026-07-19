import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';
import { fontScript, fontSerif } from '@/fonts';
import { getSettings } from '@/lib/api';
import { asSiteSettings } from '@/lib/site-settings';
import { locale } from '@/messages';
import './globals.css';

// viewportFit: 'cover' lets the hero photo draw under the iOS status bar /
// Dynamic Island instead of Safari painting that strip with the page's plain
// body background-color — content near the top edge must then pad itself by
// env(safe-area-inset-top) so it isn't obscured (done at the hero + music
// button call sites, not globally, since most of the page never gets near
// that edge).
export const viewport: Viewport = { viewportFit: 'cover' };

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
