'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { AdminWedding } from '@/lib/admin-api';
import { chipStyle, inputBase, kicker, INK, TAN, RED } from './ui';

// Master-only chip row above the event tabs (mirrors the event-tab pattern):
// pick which couple's data the rest of the dashboard shows, plus a "Quản lý"
// toggle that reveals per-wedding rename/password/delete controls inline.
export function WeddingSwitcher({
  weddings,
  selected,
  onSelect,
  onCreate,
  onRename,
  onSetPassword,
  onDelete,
  onError,
}: {
  weddings: AdminWedding[];
  selected: string | null;
  onSelect: (slug: string) => void;
  onCreate: (name: string) => void;
  onRename: (slug: string, name: string) => void;
  onSetPassword: (slug: string, password: string) => void;
  onDelete: (slug: string) => void;
  onError: (msg: string) => void;
}) {
  const t = useTranslations('admin.weddings');
  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState('');
  const [managing, setManaging] = useState(false);

  const renamePrompt = (w: AdminWedding) => {
    const name = window.prompt(t('renamePrompt', { name: w.name }), w.name)?.trim();
    if (name && name !== w.name) onRename(w.slug, name);
  };
  const passwordPrompt = (w: AdminWedding) => {
    const pw = window.prompt(t('passwordPrompt', { name: w.name }));
    if (pw === null) return;
    if (pw !== '' && (pw.length < 8 || pw.length > 72)) {
      onError(t('badPassword'));
      return;
    }
    onSetPassword(w.slug, pw);
  };
  const deletePrompt = (w: AdminWedding) => {
    const typed = window.prompt(t('deleteConfirm', { name: w.name }));
    if (typed === null) return;
    if (typed.trim() !== w.name) {
      onError(t('deleteMismatch'));
      return;
    }
    onDelete(w.slug);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={kicker}>{t('heading')}</span>
        {weddings.map((w) => (
          <button
            key={w.slug}
            type="button"
            onClick={() => onSelect(w.slug)}
            style={chipStyle(w.slug === selected)}
          >
            {w.name}
          </button>
        ))}
        {addOpen ? (
          <input
            value={addName}
            onChange={(e) => setAddName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setAddOpen(false);
                setAddName('');
              }
              if (e.key !== 'Enter') return;
              const name = addName.trim();
              setAddOpen(false);
              setAddName('');
              if (name) onCreate(name);
            }}
            placeholder={t('addPlaceholder')}
            aria-label={t('addPlaceholder')}
            // eslint-disable-next-line jsx-a11y/no-autofocus -- appears on explicit "+ Thêm cặp đôi" click
            autoFocus
            style={{
              ...inputBase,
              width: 220,
              borderRadius: 20,
              boxShadow: `0 0 0 0.5px ${INK}`,
              padding: '5px 14px',
              fontSize: 12,
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            style={{
              padding: '5px 14px',
              borderRadius: 20,
              border: `1px dashed ${TAN}`,
              background: 'transparent',
              fontSize: 12,
              color: INK,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              fontFamily: 'inherit',
            }}
          >
            {t('add')}
          </button>
        )}
        <button
          type="button"
          onClick={() => setManaging((v) => !v)}
          style={{
            padding: '5px 14px',
            border: 'none',
            background: 'transparent',
            fontSize: 12,
            color: INK,
            textDecoration: 'underline',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {managing ? t('manageDone') : t('manage')}
        </button>
      </div>
      {managing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {weddings.map((w) => (
            <div
              key={w.slug}
              style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: INK }}
            >
              <button
                type="button"
                onClick={() => renamePrompt(w)}
                title={t('rename')}
                style={{
                  border: 'none',
                  background: 'transparent',
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  color: INK,
                  padding: 0,
                }}
              >
                {w.name}
              </button>
              <button
                type="button"
                onClick={() => passwordPrompt(w)}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: w.hasPassword ? INK : TAN,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  padding: 0,
                }}
              >
                {w.hasPassword ? t('passwordSet') : t('passwordUnset')}
              </button>
              <button
                type="button"
                onClick={() => deletePrompt(w)}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: RED,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  padding: 0,
                }}
              >
                {t('delete')}
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
