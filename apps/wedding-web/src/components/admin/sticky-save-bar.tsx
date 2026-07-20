'use client';

import { useTranslations } from 'next-intl';
import { pillGhost, pillSolid, CREAM, RING } from './ui';

// Shown once a form has unsaved edits — stays pinned to the viewport (not the
// panel) so the Lưu/Huỷ bỏ actions stay reachable no matter how far the host
// has scrolled down a long form.
export function StickySaveBar({
  saving,
  onSave,
  onCancel,
}: {
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations('admin.unsaved');
  return (
    <div
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 20,
        transform: 'translateX(-50%)',
        zIndex: 30,
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '10px 16px',
        borderRadius: 26,
        background: CREAM,
        boxShadow: `${RING}, 0 6px 24px rgba(59,47,39,0.22)`,
      }}
    >
      <span style={{ fontSize: 12, fontStyle: 'italic' }}>{t('message')}</span>
      <button type="button" onClick={onCancel} style={pillGhost} className="wa-pill-ghost">
        {t('cancel')}
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={saving}
        style={{ ...pillSolid, opacity: saving ? 0.6 : 1, cursor: saving ? 'default' : 'pointer' }}
        className="wa-pill-solid"
      >
        {saving ? t('saving') : t('save')}
      </button>
    </div>
  );
}
