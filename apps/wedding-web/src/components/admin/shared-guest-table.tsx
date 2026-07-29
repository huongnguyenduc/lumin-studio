'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { SharedGuest } from '@/lib/admin-api';
import { timeAgo } from '@/lib/time';
import {
  card,
  chipStyle,
  CREAM_2,
  GREEN,
  HAIRLINE,
  INK,
  kicker,
  pagerBtn,
  RED,
  TAN,
  pillGhost,
} from './ui';

export function SharedGuestTable({
  guests,
  onToggleAdmin,
  onDelete,
  onDeleteAll,
  onCreateClaim,
}: {
  guests: SharedGuest[];
  onToggleAdmin: (guest: SharedGuest) => void;
  onDelete: (guest: SharedGuest) => void;
  onDeleteAll: () => void;
  onCreateClaim: () => void;
}) {
  const t = useTranslations('admin.shared');
  const td = useTranslations('admin.device');
  const tt = useTranslations('admin.table');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const maxPage = Math.max(1, Math.ceil(guests.length / pageSize));
  const safePage = Math.min(page, maxPage);
  const rows = guests.slice((safePage - 1) * pageSize, (safePage - 1) * pageSize + pageSize);

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20 }}>{t('heading')}</h2>
          <span style={{ fontSize: 12, color: INK }}>{t('subtitle')}</span>
        </div>
        <div style={{ flex: 1 }} />
        <button type="button" onClick={onCreateClaim} style={pillGhost}>
          {t('claimDevice')}
        </button>
        {guests.length ? (
          <button type="button" onClick={onDeleteAll} style={pillGhost}>
            {t('deleteAll')}
          </button>
        ) : null}
      </div>
      <div style={{ ...card, overflow: 'hidden' }}>
        {guests.length === 0 ? (
          <div style={{ padding: 28, textAlign: 'center', color: INK }}>{t('empty')}</div>
        ) : (
          rows.map((guest) => (
            <div
              key={guest.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '1.4fr 1fr 0.8fr 0.8fr 1.4fr',
                gap: 14,
                alignItems: 'center',
                padding: '14px 18px',
                borderBottom: `0.5px solid ${HAIRLINE}`,
                background: guest.isAdmin ? CREAM_2 : undefined,
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <strong>{guest.name ?? t('unnamed')}</strong>
                <span style={{ fontSize: 11, color: INK }}>
                  {td('summary', {
                    browser: td(`browser.${guest.browserFamily}`),
                    device: td(`family.${guest.deviceFamily}`),
                  })}
                </span>
                <span style={{ fontSize: 10, color: TAN }}>
                  {t(`confidence.${guest.matchConfidence}`)}
                </span>
              </div>
              <span style={{ fontSize: 12 }}>
                {t('opens', {
                  count: guest.openCount,
                  ago: timeAgo(guest.lastOpenedAt ?? guest.lastSeenAt),
                })}
              </span>
              <span
                style={{ color: guest.rsvp === 'yes' ? GREEN : guest.rsvp === 'no' ? RED : INK }}
              >
                {guest.rsvp === 'yes' ? t('yes') : guest.rsvp === 'no' ? t('no') : t('pending')}
              </span>
              <span style={{ fontSize: 12 }}>
                {guest.isCurrent ? t('currentDevice') : guest.isAdmin ? t('admin') : t('guest')}
              </span>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button type="button" style={pillGhost} onClick={() => onToggleAdmin(guest)}>
                  {guest.isAdmin ? t('unmarkAdmin') : t('markAdmin')}
                </button>
                <button type="button" style={pillGhost} onClick={() => onDelete(guest)}>
                  {t('delete')}
                </button>
              </div>
            </div>
          ))
        )}
      </div>
      {guests.length ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ ...kicker, letterSpacing: '0.1em' }}>{tt('pageSize')}</span>
          {[10, 25, 50].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => {
                setPageSize(n);
                setPage(1);
              }}
              style={{ ...chipStyle(pageSize === n), padding: '4px 11px', borderRadius: 18 }}
            >
              {n}
            </button>
          ))}
          <div style={{ flex: 1 }} />
          <button
            type="button"
            onClick={() => setPage(Math.max(1, safePage - 1))}
            aria-label={tt('prev')}
            style={pagerBtn}
          >
            {'‹'}
          </button>
          <span style={{ fontSize: 12, color: INK, minWidth: 70, textAlign: 'center' }}>
            {tt('page', { page: safePage, max: maxPage })}
          </span>
          <button
            type="button"
            onClick={() => setPage(Math.min(maxPage, safePage + 1))}
            aria-label={tt('next')}
            style={pagerBtn}
          >
            {'›'}
          </button>
        </div>
      ) : null}
    </section>
  );
}
