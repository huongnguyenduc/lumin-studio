import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { Sidebar } from '@/components/sidebar';

/**
 * Authenticated admin chrome (route group `(app)`). Fixed left sidebar (from lg) + main content
 * offset by the rail width; on smaller screens the sidebar collapses to a scrolling top bar and the
 * content sits below it (admin is a desktop-first tool — see Sidebar). The content area is capped +
 * padded. `/dang-nhap` sits OUTSIDE this group, so the login screen has no nav.
 *
 * The `middleware` (src/middleware.ts) redirects a request with no session cookie to /dang-nhap
 * before this layout renders, so every page under it can assume an authenticated actor (the API is
 * the real gate — it re-verifies the JWT and returns 401 on a tampered/expired cookie).
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations('nav');

  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-surface-card focus:px-4 focus:py-2 focus:shadow-md"
      >
        {t('skipToContent')}
      </a>
      <Sidebar />
      <main id="main" className="lg:pl-64">
        <div className="mx-auto w-full max-w-[1200px] px-4 py-8 md:px-6 lg:px-8">{children}</div>
      </main>
    </>
  );
}
