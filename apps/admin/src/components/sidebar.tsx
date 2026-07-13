'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { cn } from '@lumin/ui';
import { logout } from '@/lib/auth-actions';
import {
  BoxIcon,
  CoilIcon,
  GaugeIcon,
  GridIcon,
  OrdersIcon,
  PrinterIcon,
  SettingsIcon,
  StarIcon,
  TagIcon,
  UsersIcon,
} from './icons';

/**
 * Admin sidebar (design: Lumin Admin Hi-fi). Brand "Lumin" + a small "admin" label, then a single
 * column of nav items. Active item = coral fill (bg-primary text-on-primary), inactive = body text
 * with a sunken hover. Client component because the active state comes from usePathname.
 *
 * Desktop-first: rendered as a fixed left rail from `lg`; on smaller screens it becomes a horizontal
 * top bar that scrolls (admin is a desktop tool — we keep small screens usable, not pretty).
 */
export function Sidebar() {
  const t = useTranslations('nav');
  const pathname = usePathname();

  const items = [
    { href: '/', label: t('overview'), Icon: GaugeIcon },
    { href: '/don-hang', label: t('orders'), Icon: OrdersIcon },
    { href: '/hang-doi-in', label: t('printQueue'), Icon: PrinterIcon },
    { href: '/san-pham', label: t('products'), Icon: BoxIcon },
    { href: '/danh-muc', label: t('categories'), Icon: GridIcon },
    { href: '/danh-gia', label: t('reviews'), Icon: StarIcon },
    { href: '/vat-tu', label: t('materials'), Icon: CoilIcon },
    { href: '/khach-hang', label: t('customers'), Icon: UsersIcon },
    { href: '/pet-tag', label: t('petTag'), Icon: TagIcon },
    { href: '/cai-dat', label: t('settings'), Icon: SettingsIcon },
  ];

  return (
    <aside className="border-b border-border-subtle bg-surface-card lg:fixed lg:inset-y-0 lg:left-0 lg:z-40 lg:w-64 lg:border-b-0 lg:border-r">
      <div className="mx-auto flex w-full max-w-[1200px] items-center gap-3 px-4 py-3 lg:max-w-none lg:px-5 lg:py-6">
        <Link
          href="/"
          className="flex shrink-0 items-baseline gap-1.5 font-display text-2xl font-extrabold tracking-tight text-text-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2"
        >
          {t('brand')}
          <span aria-hidden="true" className="h-2 w-2 rounded-full bg-accent-flame" />
          <span className="font-mono text-xs font-bold lowercase text-text-muted">
            {t('adminLabel')}
          </span>
        </Link>
      </div>

      <nav
        aria-label={t('sidebar')}
        className="mx-auto w-full max-w-[1200px] px-2 pb-2 lg:max-w-none lg:px-3 lg:pb-6"
      >
        <ul className="flex items-center gap-1 overflow-x-auto lg:flex-col lg:items-stretch lg:gap-0.5 lg:overflow-visible">
          {items.map(({ href, label, Icon }) => {
            const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
            return (
              <li key={href} className="shrink-0 lg:shrink">
                <Link
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex min-h-[44px] items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2',
                    active
                      ? 'bg-primary text-on-primary'
                      : 'text-text-body hover:bg-surface-sunken hover:text-text-strong',
                  )}
                >
                  <Icon className="h-5 w-5 shrink-0" />
                  <span className="whitespace-nowrap">{label}</span>
                </Link>
              </li>
            );
          })}
          {/* Logout is an action, not a nav target: a form posting to the `logout` Server Action
              (drops the session cookie → middleware routes the next request to /dang-nhap). Styled
              as a muted nav row so it sits with the list on both the desktop rail and the mobile
              top bar. */}
          <li className="shrink-0 lg:mt-1 lg:shrink lg:border-t lg:border-border-subtle lg:pt-1">
            <form action={logout}>
              <button
                type="submit"
                className="flex min-h-[44px] w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold text-text-muted transition-colors hover:bg-surface-sunken hover:text-text-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2"
              >
                <span className="whitespace-nowrap">{t('logout')}</span>
              </button>
            </form>
          </li>
        </ul>
      </nav>
    </aside>
  );
}
