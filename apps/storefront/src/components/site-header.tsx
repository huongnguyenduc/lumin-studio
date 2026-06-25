'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { IconButton, Input } from '@lumin/ui';
import { BagIcon, BellIcon, SearchIcon, UserIcon } from './icons';

function SearchField({ className }: { className?: string }) {
  const t = useTranslations('nav');
  return (
    <Input
      type="search"
      aria-label={t('searchLabel')}
      placeholder={t('searchPlaceholder')}
      leadingIcon={<SearchIcon className="h-5 w-5" />}
      className={className}
    />
  );
}

/**
 * Sticky storefront header (design: cream 85% + backdrop-blur). Logo + desktop nav + search + the
 * bell/cart/account actions. Client component because it mounts the `Input` primitive (useId).
 */
export function SiteHeader() {
  const t = useTranslations('nav');
  const links = [
    { href: '/danh-muc', label: t('categories') },
    { href: '/bo-suu-tap', label: t('collection') },
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-border-subtle bg-surface-cream/85 backdrop-blur-md">
      <div className="mx-auto w-full max-w-[1200px] px-4 md:px-6">
        <div className="flex h-16 items-center gap-4">
          <Link
            href="/"
            className="flex shrink-0 items-baseline gap-1 font-display text-2xl font-extrabold tracking-tight text-text-strong"
          >
            {t('brand')}
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-accent-flame" />
          </Link>

          <nav aria-label={t('categories')} className="hidden items-center gap-5 md:flex">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="font-display text-sm font-semibold text-text-body transition-colors hover:text-text-strong"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto hidden w-full max-w-xs md:block">
            <SearchField />
          </div>

          <div className="ml-auto flex items-center gap-1 md:ml-2">
            <span className="relative inline-flex">
              <IconButton variant="ghost" label={t('notificationsLabel')}>
                <BellIcon className="h-6 w-6" />
              </IconButton>
              <span
                aria-hidden="true"
                className="absolute right-2 top-2 h-2 w-2 rounded-full bg-accent-flame ring-2 ring-surface-cream"
              />
            </span>

            <Link
              href="/gio"
              aria-label={t('cart')}
              className="inline-flex h-11 w-11 items-center justify-center rounded-full text-text-strong transition-colors hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2"
            >
              <BagIcon className="h-6 w-6" />
            </Link>

            <Link
              href="/tai-khoan"
              aria-label={t('account')}
              className="hidden h-11 w-11 items-center justify-center rounded-full text-text-strong transition-colors hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2 sm:inline-flex"
            >
              <UserIcon className="h-6 w-6" />
            </Link>
          </div>
        </div>

        <div className="pb-3 md:hidden">
          <SearchField />
        </div>
      </div>
    </header>
  );
}
