'use client';

import { useState, type CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import type { AdminWish } from '@/lib/admin-api';
import { timeAgo } from '@/lib/time';
import { checkbox, chipStyle, kicker, CREAM, INK, TAN, TERRACOTTA, SCRIPT, RING } from './ui';

const pagerBtn: CSSProperties = {
  width: 26,
  height: 26,
  borderRadius: 13,
  border: 'none',
  background: 'transparent',
  boxShadow: RING,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 14,
  color: INK,
  cursor: 'pointer',
  userSelect: 'none',
  fontFamily: 'inherit',
};

// Wishes moderation (§3.6): 3-col grid, paginated 6/12/24, newest first,
// delete-only + bulk selection (§3.7 same pattern as the guest table).
export function WishesPanel({
  wishes,
  onDelete,
  onBulkDelete,
}: {
  wishes: AdminWish[];
  onDelete: (w: AdminWish) => void;
  onBulkDelete: (ids: string[]) => void;
}) {
  const t = useTranslations('admin.wishes');
  const tt = useTranslations('admin.table');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(6);
  const [sel, setSel] = useState<Record<string, boolean>>({});

  const maxPage = Math.max(1, Math.ceil(wishes.length / pageSize));
  const safePage = Math.min(page, maxPage);
  const rows = wishes.slice((safePage - 1) * pageSize, (safePage - 1) * pageSize + pageSize);
  const selIds = Object.keys(sel).filter((id) => sel[id] && wishes.some((w) => w.id === id));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: SCRIPT, fontSize: 26, color: INK }}>{t('heading')}</span>
        <span style={kicker}>{t('count', { count: wishes.length })}</span>
        {selIds.length > 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 12, color: INK }}>
              {t('selected', { count: selIds.length })}
            </span>
            <button
              type="button"
              onClick={() => {
                if (confirm(t('deleteConfirm', { count: selIds.length }))) {
                  onBulkDelete(selIds);
                  setSel({});
                }
              }}
              style={{
                padding: '5px 14px',
                borderRadius: 20,
                border: 'none',
                background: INK,
                color: CREAM,
                fontSize: 11,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {t('delete')}
            </button>
            <button
              type="button"
              onClick={() => setSel({})}
              style={{
                padding: '5px 12px',
                borderRadius: 20,
                border: 'none',
                background: 'transparent',
                boxShadow: RING,
                fontSize: 11,
                color: INK,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {t('clear')}
            </button>
          </div>
        ) : null}
        <div style={{ flexGrow: 1 }} />
        <span style={{ ...kicker, letterSpacing: '0.1em' }}>{t('pageSize')}</span>
        {[6, 12, 24].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => {
              setPageSize(n);
              setPage(1);
              setSel({});
            }}
            style={{ ...chipStyle(pageSize === n), padding: '4px 11px', borderRadius: 18 }}
          >
            {n}
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            setPage(Math.max(1, safePage - 1));
            setSel({}); // §3.7: selection clears on page change
          }}
          aria-label={tt('prev')}
          style={{ ...pagerBtn, marginLeft: 8 }}
        >
          {'‹'}
        </button>
        <span style={{ fontSize: 12, color: INK, minWidth: 44, textAlign: 'center' }}>
          {safePage} / {maxPage}
        </span>
        <button
          type="button"
          onClick={() => {
            setPage(Math.min(maxPage, safePage + 1));
            setSel({});
          }}
          aria-label={tt('next')}
          style={pagerBtn}
        >
          {'›'}
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
        {rows.map((w) => (
          <div
            key={w.id}
            style={{
              position: 'relative',
              background: CREAM,
              borderRadius: 10,
              boxShadow: `0 0 0 0.5px ${sel[w.id] ? INK : TAN}`,
              padding: '16px 18px',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <input
              type="checkbox"
              checked={!!sel[w.id]}
              onChange={() => setSel({ ...sel, [w.id]: !sel[w.id] })}
              aria-label={t('select')}
              style={{ ...checkbox, position: 'absolute', top: 12, right: 12 }}
            />
            <span
              style={{
                fontStyle: 'italic',
                fontSize: 12,
                lineHeight: 1.65,
                color: INK,
                paddingRight: 22,
              }}
            >
              “{w.text}”
            </span>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                gap: 10,
              }}
            >
              <span style={{ fontFamily: SCRIPT, fontSize: 17, color: TERRACOTTA }}>{w.name}</span>
              <span
                style={{
                  fontStyle: 'italic',
                  fontSize: 10,
                  color: INK,
                  whiteSpace: 'nowrap',
                }}
              >
                {timeAgo(w.createdAt)}
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                if (confirm(t('deleteOneConfirm', { name: w.name }))) onDelete(w);
              }}
              style={{
                alignSelf: 'flex-end',
                border: 'none',
                background: 'transparent',
                fontSize: 10,
                color: INK,
                cursor: 'pointer',
                textDecoration: 'underline',
                textUnderlineOffset: 3,
                fontFamily: 'inherit',
                padding: 0,
              }}
            >
              {t('deleteOne')}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
