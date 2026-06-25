'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { cn } from '@lumin/ui';
import { BagIcon, GridIcon, HomeIcon, UserIcon } from './icons';

/** Mobile-only bottom tab bar (design: fixed 4-tab nav). Active tab is coral; hidden from md up. */
export function BottomNav() {
  const t = useTranslations('nav');
  const pathname = usePathname();

  const tabs = [
    { href: '/', label: t('home'), Icon: HomeIcon },
    { href: '/danh-muc', label: t('categories'), Icon: GridIcon },
    { href: '/gio', label: t('cart'), Icon: BagIcon },
    { href: '/tai-khoan', label: t('account'), Icon: UserIcon },
  ];

  return (
    <nav
      aria-label={t('primaryNav')}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border-subtle bg-surface-card md:hidden"
    >
      <ul className="mx-auto flex max-w-[1200px] items-stretch">
        {tabs.map(({ href, label, Icon }) => {
          const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-[56px] flex-col items-center justify-center gap-1 py-2 font-mono text-[11px] font-bold transition-colors',
                  active ? 'text-primary' : 'text-text-muted hover:text-text-strong',
                )}
              >
                <Icon className="h-6 w-6" />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
