'use client';

import { useRef } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ShopContact } from '@/lib/shop-contact';
import { ChatIcon } from './icons';

const CLOSE = '✕';

/**
 * The "Nhắn shop" popup (PR F) — reachable from every page: a floating button on desktop
 * (bottom-right), a bottom-nav entry on mobile (see BottomNav). Both open the SAME native <dialog>
 * (showModal — Esc/backdrop-close + focus-trap for free, mirroring admin's TransitionDialog pattern)
 * listing whichever channels the shop configured (Admin › Cài đặt › Kênh liên hệ). Fetched ONCE in
 * layout.tsx and passed down — never a per-open client call. The trigger + dialog stay in ONE component
 * (not split across a ref-forwarding child) since React 18 needs forwardRef boilerplate for that split
 * and there is exactly one caller.
 */
export function ShopContactTrigger({
  contact,
  variant,
}: {
  contact: ShopContact;
  variant: 'floating' | 'navTab';
}) {
  const t = useTranslations('shopContact');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const hasChannel = Boolean(contact.zalo || contact.facebook || contact.phone || contact.email);
  if (!hasChannel) return null;

  const open = () => dialogRef.current?.showModal();
  const close = () => dialogRef.current?.close();
  const titleId = 'shop-contact-title';

  return (
    <>
      {variant === 'floating' ? (
        <button
          type="button"
          onClick={open}
          aria-label={t('triggerLabel')}
          className="fixed bottom-6 right-6 z-40 hidden min-h-[56px] min-w-[56px] items-center justify-center rounded-full border-2 border-border-strong bg-primary text-on-primary shadow-pop md:flex"
        >
          <ChatIcon className="h-6 w-6" />
        </button>
      ) : (
        <li className="flex-1">
          <button
            type="button"
            onClick={open}
            className="flex min-h-[56px] w-full flex-col items-center justify-center gap-1 py-2 font-mono text-[11px] font-bold text-text-muted transition-colors hover:text-text-strong"
          >
            <ChatIcon className="h-6 w-6" />
            {t('triggerLabel')}
          </button>
        </li>
      )}

      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        className="w-[min(24rem,calc(100vw-2rem))] rounded-lg border-2 border-border-strong bg-surface-card p-0 shadow-lg backdrop:bg-black/40"
      >
        <div className="flex flex-col gap-3 p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 id={titleId} className="font-display text-xl font-semibold text-text-strong">
              {t('sheetTitle')}
            </h2>
            <button
              type="button"
              onClick={close}
              aria-label={t('close')}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center text-xl text-text-muted"
            >
              {CLOSE}
            </button>
          </div>
          <div className="flex flex-col gap-2">
            {contact.zalo && (
              <ChannelButton href={`https://zalo.me/${contact.zalo}`} label={t('zalo')} external />
            )}
            {contact.facebook && (
              <ChannelButton
                href={`https://m.me/${contact.facebook}`}
                label={t('facebook')}
                external
              />
            )}
            {contact.phone && (
              <ChannelButton
                href={`tel:${contact.phone}`}
                label={t('call', { phone: contact.phone })}
              />
            )}
            {contact.email && <ChannelButton href={`mailto:${contact.email}`} label={t('email')} />}
          </div>
          <Link
            href="/lien-he"
            onClick={close}
            className="mt-1 text-center text-sm font-semibold text-primary underline-offset-2 hover:underline"
          >
            {t('viewPage')}
          </Link>
        </div>
      </dialog>
    </>
  );
}

function ChannelButton({
  href,
  label,
  external,
}: {
  href: string;
  label: string;
  external?: boolean;
}) {
  return (
    <a
      href={href}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className="flex min-h-[44px] items-center justify-center rounded-xl border-2 border-border-strong bg-surface-sunken px-4 font-display font-semibold text-text-strong hover:bg-surface-card"
    >
      {label}
    </a>
  );
}
