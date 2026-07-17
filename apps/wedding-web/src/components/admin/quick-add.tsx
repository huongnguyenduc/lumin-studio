'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  card,
  chipStyle,
  inputBase,
  kicker,
  pillSolid,
  pillGhost,
  INK,
  TAN,
  TAN_LIGHT,
  HAIRLINE,
} from './ui';

// Quick add + group chips + bulk add (§3.2). Groups are user-managed: + Nhóm
// inline input, "Sửa nhóm" manage mode (click chip → rename prompt, × → delete
// with confirm — members move to "Khác", matching the API tx).
export function QuickAdd({
  groups,
  selectedGroup,
  onSelectGroup,
  onAdd,
  onBulkAdd,
  onCreateGroup,
  onRenameGroup,
  onDeleteGroup,
}: {
  groups: string[];
  selectedGroup: string;
  onSelectGroup: (g: string) => void;
  onAdd: (label: string) => void;
  onBulkAdd: (lines: { label: string; group: string }[]) => void;
  onCreateGroup: (name: string) => void;
  onRenameGroup: (from: string, to: string) => void;
  onDeleteGroup: (name: string) => void;
}) {
  const t = useTranslations('admin.quick');
  const [label, setLabel] = useState('');
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [manage, setManage] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const quickRef = useRef<HTMLInputElement>(null);

  const add = () => {
    const trimmed = label.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    setLabel('');
    quickRef.current?.focus(); // Enter-repeat flow (§3.2)
  };

  const bulkLines = bulkText
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  const bulkAdd = () => {
    if (!bulkLines.length) return;
    onBulkAdd(
      bulkLines.map((line) => {
        const i = line.lastIndexOf(','); // split on LAST comma (labels contain commas)
        if (i > 0) {
          return {
            label: line.slice(0, i).trim(),
            group: line.slice(i + 1).trim() || selectedGroup,
          };
        }
        return { label: line, group: selectedGroup };
      }),
    );
    setBulkText('');
    setBulkOpen(false);
  };

  return (
    <div
      style={{ ...card, padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}
    >
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <span style={{ fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap' }}>{t('heading')}</span>
        <input
          ref={quickRef}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add();
          }}
          placeholder={t('placeholder')}
          aria-label={t('placeholder')}
          style={{ ...inputBase, flexGrow: 1, borderRadius: 22, padding: '9px 16px' }}
        />
        <button type="button" onClick={add} style={pillSolid} className="wa-pill-solid">
          {t('add')}
        </button>
        <button
          type="button"
          onClick={() => setBulkOpen((o) => !o)}
          style={pillGhost}
          className="wa-pill-ghost"
        >
          {t('bulkToggle')}
        </button>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={kicker}>{t('groupLabel')}</span>
        {groups.map((name) => (
          <span key={name} style={{ display: 'flex', alignItems: 'center' }}>
            <button
              type="button"
              title={manage ? t('chipRenameTitle') : t('chipPickTitle')}
              onClick={() => {
                if (manage) {
                  const nn = prompt(t('renamePrompt', { name }), name);
                  if (nn && nn.trim() && nn.trim() !== name) onRenameGroup(name, nn.trim());
                } else {
                  onSelectGroup(name);
                  quickRef.current?.focus();
                }
              }}
              style={chipStyle(name === selectedGroup)}
            >
              {name}
            </button>
            {manage ? (
              <button
                type="button"
                title={t('deleteGroupTitle')}
                aria-label={t('deleteGroupTitle')}
                onClick={() => {
                  if (confirm(t('deleteGroupConfirm', { name }))) onDeleteGroup(name);
                }}
                style={{
                  marginLeft: 4,
                  width: 18,
                  height: 18,
                  borderRadius: 9,
                  border: 'none',
                  background: 'transparent',
                  boxShadow: `0 0 0 0.5px ${TAN}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 11,
                  color: TAN,
                  cursor: 'pointer',
                  lineHeight: 1,
                  fontFamily: 'inherit',
                }}
              >
                {'×'}
              </button>
            ) : null}
          </span>
        ))}
        {newOpen ? (
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setNewOpen(false);
                setNewName('');
              }
              if (e.key !== 'Enter') return;
              const name = newName.trim();
              setNewOpen(false);
              setNewName('');
              if (name) {
                onCreateGroup(name);
                quickRef.current?.focus();
              }
            }}
            placeholder={t('newGroupPlaceholder')}
            aria-label={t('newGroupPlaceholder')}
            // eslint-disable-next-line jsx-a11y/no-autofocus -- appears on explicit "+ Nhóm" click; focus continues that action
            autoFocus
            style={{
              ...inputBase,
              width: 160,
              borderRadius: 20,
              boxShadow: `0 0 0 0.5px ${INK}`,
              padding: '5px 14px',
              fontSize: 12,
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setNewOpen(true)}
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
            {t('newGroup')}
          </button>
        )}
        <button
          type="button"
          onClick={() => setManage((m) => !m)}
          style={{
            padding: '5px 8px',
            border: 'none',
            background: 'transparent',
            fontSize: 11,
            color: TAN_LIGHT,
            cursor: 'pointer',
            textDecoration: 'underline',
            textUnderlineOffset: 3,
            fontFamily: 'inherit',
          }}
        >
          {manage ? t('manageDone') : t('manage')}
        </button>
        {manage ? (
          <span style={{ fontSize: 11, fontStyle: 'italic', color: TAN_LIGHT }}>
            {t('manageHint')}
          </span>
        ) : null}
      </div>
      {bulkOpen ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            borderTop: `0.5px solid ${HAIRLINE}`,
            paddingTop: 12,
          }}
        >
          <span style={{ fontSize: 12, color: TAN }}>{t('bulkHint')}</span>
          <textarea
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            placeholder={t('bulkPlaceholder')}
            aria-label={t('bulkHint')}
            style={{
              ...inputBase,
              height: 120,
              borderRadius: 10,
              padding: '12px 14px',
              lineHeight: 1.7,
              resize: 'vertical',
            }}
          />
          <div>
            <button type="button" onClick={bulkAdd} style={pillSolid} className="wa-pill-solid">
              {t('bulkAdd', { count: bulkLines.length || 0 })}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
