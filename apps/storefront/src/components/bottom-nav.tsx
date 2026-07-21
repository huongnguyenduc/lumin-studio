'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { cn } from '@lumin/ui';
import { useCart } from '@/lib/cart-store';
import { BagIcon, GridIcon, HomeIcon, UserIcon } from './icons';

/** Mobile-only bottom tab bar (design: fixed 4-tab nav). Active tab is coral; hidden from md up. */
export function BottomNav() {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const { count: cartCount } = useCart();

  const tabs = [
    { href: '/', label: t('home'), Icon: HomeIcon },
    { href: '/danh-muc', label: t('categories'), Icon: GridIcon },
    { href: '/gio-hang', label: t('cart'), Icon: BagIcon, badge: cartCount },
    { href: '/tai-khoan', label: t('account'), Icon: UserIcon },
  ];

  return (
    <nav
      aria-label={t('primaryNav')}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border-subtle bg-surface-card md:hidden"
    >
      <ul className="mx-auto flex max-w-[1200px] items-stretch">
        {tabs.map(({ href, label, Icon, badge }) => {
          const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative flex min-h-[56px] flex-col items-center justify-center gap-1 py-2 font-mono text-[11px] font-bold transition-colors',
                  active ? 'text-primary' : 'text-text-muted hover:text-text-strong',
                )}
              >
                <span className="relative">
                  <Icon className="h-6 w-6" />
                  {badge ? (
                    <span
                      aria-hidden="true"
                      className="absolute -right-2 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-flame px-1 text-[9px] font-bold text-on-primary ring-2 ring-surface-card"
                    >
                      {badge > 99 ? '99+' : badge}
                    </span>
                  ) : null}
                </span>
                {label}
                {badge ? (
                  <span className="sr-only">{t('cartWithCount', { count: badge })}</span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
