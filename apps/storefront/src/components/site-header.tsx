'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useCart } from '@/lib/cart-store';
import { BagIcon, BellIcon, SearchIcon, UserIcon } from './icons';

/** Client-only "am I logged in" probe (see app/api/session-status). Starts false so a guest never
 *  sees the notification bell flash before the check resolves. */
function useIsLoggedIn(): boolean {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/session-status', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { loggedIn?: boolean } | null) => {
        if (!cancelled && data?.loggedIn) setIsLoggedIn(true);
      })
      .catch(() => {
        // network hiccup → stay logged-out-looking; nothing to notify without a confirmed session
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return isLoggedIn;
}

function SearchField({ className }: { className?: string }) {
  const t = useTranslations('nav');
  // Native GET form → /danh-muc?q=… (the catalog page already reads `q`); works without JS.
  return (
    <form action="/danh-muc" role="search" className={className}>
      <label className="flex h-10 items-center gap-2 rounded-pill border-2 border-border-strong bg-surface-card px-4 focus-within:ring-2 focus-within:ring-accent-sky focus-within:ring-offset-2">
        <SearchIcon className="h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" />
        <input
          type="search"
          name="q"
          aria-label={t('searchLabel')}
          placeholder={t('searchPlaceholder')}
          className="h-full w-full bg-transparent text-sm text-text-body outline-none placeholder:text-text-muted"
        />
      </label>
    </form>
  );
}

const headerActionClass =
  'relative inline-flex h-9 w-9 items-center justify-center rounded-[11px] border-2 border-border-strong text-text-strong transition-colors hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2';

/** Outlined square icon action (hi-fi header: 36px, cocoa 2px border, 11px radius). */
function HeaderAction({
  href,
  label,
  className,
  children,
}: {
  href?: string;
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  const cls = `${headerActionClass} ${className ?? ''}`;
  if (!href) {
    // No notifications surface yet — the bell is a decorative-but-focusable control like before.
    return (
      <button type="button" aria-label={label} className={cls}>
        {children}
      </button>
    );
  }
  return (
    <Link href={href} aria-label={label} className={cls}>
      {children}
    </Link>
  );
}

/**
 * Sticky storefront header, rebuilt to the storefront hi-fi: WHITE bar (not cream), the search pill
 * (cocoa 2px border, fully rounded) sits NEXT TO the logo, nav links are pushed to the right, and
 * the bell/cart/account actions are outlined 36px squares. Mobile keeps logo + bell on the bar with
 * the search pill on its own row below (hi-fi 01); cart/account live in the bottom tab bar there.
 * Client component because the notification dot + search input need interactivity.
 */
export function SiteHeader() {
  const t = useTranslations('nav');
  const isLoggedIn = useIsLoggedIn();
  const { count: cartCount } = useCart();
  const links = [
    { href: '/danh-muc', label: t('categories') },
    { href: '/bo-suu-tap', label: t('collection') },
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-border-subtle bg-surface-card/95 backdrop-blur-md">
      <div className="mx-auto w-full max-w-[1200px] px-4 md:px-6">
        <div className="flex h-16 items-center gap-5">
          <Link
            href="/"
            className="flex shrink-0 items-baseline gap-1 font-display text-2xl font-extrabold tracking-tight text-text-strong"
          >
            {t('brand')}
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-primary" />
          </Link>

          <div className="hidden w-full max-w-[360px] md:block">
            <SearchField />
          </div>

          <nav aria-label={t('categories')} className="ml-auto hidden items-center gap-5 md:flex">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-[15px] font-semibold text-text-body transition-colors hover:text-text-strong"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2.5 md:ml-0">
            {isLoggedIn ? (
              <HeaderAction label={t('notificationsLabel')}>
                <BellIcon className="h-[18px] w-[18px]" />
                <span
                  aria-hidden="true"
                  className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-accent-flame ring-2 ring-surface-card"
                />
              </HeaderAction>
            ) : null}

            <HeaderAction
              href="/gio-hang"
              label={cartCount > 0 ? t('cartWithCount', { count: cartCount }) : t('cart')}
              className="hidden md:inline-flex"
            >
              <BagIcon className="h-[18px] w-[18px]" />
              {cartCount > 0 ? (
                <span
                  aria-hidden="true"
                  className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-flame px-1 font-mono text-[9px] font-bold text-on-primary ring-2 ring-surface-card"
                >
                  {cartCount > 99 ? '99+' : cartCount}
                </span>
              ) : null}
            </HeaderAction>

            <HeaderAction href="/tai-khoan" label={t('account')} className="hidden md:inline-flex">
              <UserIcon className="h-[18px] w-[18px]" />
            </HeaderAction>
          </div>
        </div>

        <div className="pb-3 md:hidden">
          <SearchField />
        </div>
      </div>
    </header>
  );
}
