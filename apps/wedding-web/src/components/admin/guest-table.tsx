'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import type { AdminGuest } from '@/lib/admin-api';
import { timeAgo } from '@/lib/time';
import {
  card,
  checkbox,
  chipStyle,
  inputBase,
  kicker,
  CREAM,
  CREAM_2,
  GREEN,
  HAIRLINE,
  INK,
  RED,
  TAN,
  TAN_LIGHT,
  TERRACOTTA,
} from './ui';

const GRID: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '22px 2.2fr 1.2fr 1fr 2fr 2.2fr',
  gap: 16,
  padding: '14px 24px',
};

type StatusKey = 'all' | 'unopened' | 'opened' | 'yes' | 'no' | 'pending';
type SortKey = 'added' | 'name' | 'opened' | 'rsvp';

const STATUS_TESTS: Record<StatusKey, (g: AdminGuest) => boolean> = {
  all: () => true,
  unopened: (g) => !g.openedAt,
  opened: (g) => !!g.openedAt,
  yes: (g) => g.rsvp === 'yes',
  no: (g) => g.rsvp === 'no',
  pending: (g) => !g.rsvp,
};

const rsvpRank = (g: AdminGuest) => (g.rsvp === 'yes' ? 2 : g.rsvp === 'no' ? 1 : 0);

// Guest table (§3.4) + filters + sort + pagination + inline notes + duplicate
// warning + bulk selection (§3.7). All list logic is client-side over the full
// guest list (a wedding is a few hundred rows), matching the prototype.
export function GuestTable({
  guests,
  groups,
  search,
  onEdit,
  onDelete,
  onBulkDelete,
  onSaveNote,
  onCopyLink,
}: {
  guests: AdminGuest[];
  groups: string[];
  search: string;
  onEdit: (g: AdminGuest) => void;
  onDelete: (g: AdminGuest) => void;
  onBulkDelete: (ids: string[]) => void;
  onSaveNote: (id: string, note: string) => void;
  onCopyLink: (g: AdminGuest) => void;
}) {
  const t = useTranslations('admin.table');
  const tf = useTranslations('admin.filters');
  const ts = useTranslations('admin.selection');
  const [status, setStatus] = useState<StatusKey>('all');
  const [groupFilter, setGroupFilter] = useState('all');
  const [sortKey, setSortKey] = useState<SortKey>('added');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [noteEditId, setNoteEditId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');

  // Any filter change resets to page 1 (§3.4) AND clears the selection (§3.7 —
  // a hidden selection surviving a filter switch could bulk-delete rows the
  // host no longer sees).
  const pick =
    <T,>(setter: (v: T) => void) =>
    (v: T) => {
      setter(v);
      setPage(1);
      setSel({});
    };

  // Search box lives in the dashboard header — same §3.7 rule when it changes.
  const lastSearch = useRef(search);
  useEffect(() => {
    if (lastSearch.current !== search) {
      lastSearch.current = search;
      setPage(1);
      setSel({});
    }
  }, [search]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = guests.filter((g) => {
      if (q && !`${g.label} ${g.note ?? ''}`.toLowerCase().includes(q)) return false;
      if (groupFilter !== 'all' && g.group !== groupFilter) return false;
      return STATUS_TESTS[status](g);
    });
    const dir = sortDir === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      if (sortKey === 'name') return dir * a.label.localeCompare(b.label, 'vi');
      if (sortKey === 'opened')
        return (
          dir *
          ((a.openedAt ? Date.parse(a.openedAt) : 0) - (b.openedAt ? Date.parse(b.openedAt) : 0))
        );
      if (sortKey === 'rsvp') return dir * (rsvpRank(a) - rsvpRank(b));
      return dir * (Date.parse(a.createdAt) - Date.parse(b.createdAt));
    });
    return rows;
  }, [guests, search, status, groupFilter, sortKey, sortDir]);

  const dupCount = useMemo(() => {
    const m: Record<string, number> = {};
    for (const g of guests) {
      const k = `${g.label.trim().toLowerCase()}|${g.group}`;
      m[k] = (m[k] ?? 0) + 1;
    }
    return m;
  }, [guests]);

  const maxPage = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, maxPage);
  const start = (safePage - 1) * pageSize;
  const pageRows = filtered.slice(start, start + pageSize);
  const pageIds = pageRows.map((g) => g.id);
  const allSelected = pageIds.length > 0 && pageIds.every((id) => sel[id]);
  const selIds = Object.keys(sel).filter((id) => sel[id] && guests.some((g) => g.id === id));

  const sortBy = (key: SortKey) => {
    if (sortKey === key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else {
      setSortKey(key);
      setSortDir(key === 'name' ? 'asc' : 'desc');
    }
  };
  const arrow = (key: SortKey) => (sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '');

  const headerBtn: CSSProperties = {
    ...kicker,
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    userSelect: 'none',
    textAlign: 'left',
    padding: 0,
    fontFamily: 'inherit',
  };

  const startNote = (g: AdminGuest) => {
    setNoteEditId(g.id);
    setNoteDraft(g.note ?? '');
  };
  const commitNote = () => {
    if (noteEditId === null) return;
    onSaveNote(noteEditId, noteDraft.trim());
    setNoteEditId(null);
    setNoteDraft('');
  };

  const statusChips: [StatusKey, string][] = [
    ['all', tf('all')],
    ['unopened', tf('unopened')],
    ['opened', tf('opened')],
    ['yes', tf('yes')],
    ['no', tf('no')],
    ['pending', tf('pending')],
  ];

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ ...kicker, width: 76 }}>{tf('status')}</span>
          {statusChips.map(([key, name]) => (
            <button
              key={key}
              type="button"
              onClick={() => pick(setStatus)(key)}
              style={chipStyle(status === key)}
            >
              {name} · {guests.filter(STATUS_TESTS[key]).length}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ ...kicker, width: 76 }}>{tf('group')}</span>
          {['all', ...groups].map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => pick(setGroupFilter)(g)}
              style={chipStyle(groupFilter === g)}
            >
              {g === 'all' ? tf('allGroups') : g}
            </button>
          ))}
        </div>
      </div>

      {selIds.length > 0 ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            background: INK,
            borderRadius: 10,
            padding: '10px 20px',
          }}
        >
          <span style={{ fontSize: 13, color: CREAM }}>
            {ts('count', { count: selIds.length })}
          </span>
          <div style={{ flexGrow: 1 }} />
          <button
            type="button"
            onClick={() => {
              if (confirm(ts('deleteConfirm', { count: selIds.length }))) {
                onBulkDelete(selIds);
                setSel({});
              }
            }}
            style={{
              padding: '7px 18px',
              borderRadius: 22,
              border: 'none',
              background: CREAM,
              color: INK,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {ts('delete')}
          </button>
          <button
            type="button"
            onClick={() => setSel({})}
            style={{
              padding: '7px 14px',
              borderRadius: 22,
              border: 'none',
              background: 'transparent',
              boxShadow: '0 0 0 0.5px rgba(255,251,248,0.6)',
              color: CREAM,
              fontSize: 12,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {ts('clear')}
          </button>
        </div>
      ) : null}

      <div style={{ ...card, overflow: 'hidden' }}>
        <div style={{ ...GRID, borderBottom: `0.5px solid ${TAN}`, background: CREAM_2 }}>
          <input
            type="checkbox"
            checked={allSelected}
            ref={(el) => {
              // §3.7: indeterminate when only part of the page is selected.
              if (el) el.indeterminate = !allSelected && pageIds.some((id) => sel[id]);
            }}
            onChange={() => {
              const next = { ...sel };
              for (const id of pageIds) next[id] = !allSelected;
              setSel(next);
            }}
            title={t('selectAll')}
            aria-label={t('selectAll')}
            style={{ ...checkbox, alignSelf: 'center' }}
          />
          <button
            type="button"
            onClick={() => sortBy('name')}
            title={t('sortTitle')}
            style={headerBtn}
          >
            {t('guest')}
            {arrow('name')}
          </button>
          <button
            type="button"
            onClick={() => sortBy('opened')}
            title={t('sortTitle')}
            style={headerBtn}
          >
            {t('opened')}
            {arrow('opened')}
          </button>
          <button
            type="button"
            onClick={() => sortBy('rsvp')}
            title={t('sortTitle')}
            style={headerBtn}
          >
            {t('rsvp')}
            {arrow('rsvp')}
          </button>
          <span style={kicker}>{t('wish')}</span>
          <span style={{ ...kicker, textAlign: 'right' }}>{t('link')}</span>
        </div>

        {pageRows.map((g) => {
          const dup =
            (dupCount[`${g.label.trim().toLowerCase()}|${g.group}`] ?? 0) > 1 &&
            !g.note &&
            noteEditId !== g.id;
          return (
            <div
              key={g.id}
              style={{
                ...GRID,
                padding: '16px 24px',
                borderBottom: `0.5px solid ${HAIRLINE}`,
                alignItems: 'center',
                background: sel[g.id] ? CREAM_2 : 'transparent',
              }}
            >
              <input
                type="checkbox"
                checked={!!sel[g.id]}
                onChange={() => setSel({ ...sel, [g.id]: !sel[g.id] })}
                aria-label={g.label}
                style={checkbox}
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ fontWeight: 600, fontSize: 15 }}>{g.label}</span>
                <span style={{ fontSize: 11, color: TAN_LIGHT }}>
                  {g.group} · {g.id}
                </span>
                {noteEditId === g.id ? (
                  <input
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                    onBlur={commitNote}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      if (e.key === 'Escape') {
                        setNoteEditId(null);
                        setNoteDraft('');
                      }
                    }}
                    placeholder={t('notePlaceholder')}
                    aria-label={t('notePlaceholder')}
                    // eslint-disable-next-line jsx-a11y/no-autofocus -- appears on explicit edit-note click; focus continues that action
                    autoFocus
                    style={{
                      ...inputBase,
                      marginTop: 2,
                      width: '100%',
                      background: CREAM_2,
                      borderRadius: 8,
                      boxShadow: `0 0 0 0.5px ${INK}`,
                      padding: '5px 10px',
                      fontStyle: 'italic',
                      fontSize: 11,
                    }}
                  />
                ) : g.note ? (
                  <button
                    type="button"
                    onClick={() => startNote(g)}
                    title={t('noteEdit')}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      fontStyle: 'italic',
                      fontSize: 11,
                      color: INK,
                      cursor: 'pointer',
                      textAlign: 'left',
                      padding: 0,
                      fontFamily: 'inherit',
                    }}
                  >
                    {'✎ '}
                    {g.note}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => startNote(g)}
                    style={{
                      alignSelf: 'flex-start',
                      border: 'none',
                      background: 'transparent',
                      fontSize: 10,
                      color: TAN_LIGHT,
                      cursor: 'pointer',
                      textDecoration: 'underline dotted',
                      textUnderlineOffset: 3,
                      padding: 0,
                      fontFamily: 'inherit',
                    }}
                  >
                    {t('addNote')}
                  </button>
                )}
                {dup ? (
                  <button
                    type="button"
                    onClick={() => startNote(g)}
                    title={t('dupWarnTitle')}
                    style={{
                      alignSelf: 'flex-start',
                      marginTop: 2,
                      padding: '2px 10px',
                      borderRadius: 12,
                      border: 'none',
                      background: 'transparent',
                      boxShadow: `0 0 0 0.5px ${TERRACOTTA}`,
                      fontSize: 10,
                      color: TERRACOTTA,
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    {t('dupWarn')}
                  </button>
                ) : null}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                    background: g.openedAt ? GREEN : 'rgb(217,217,217)',
                    flexShrink: 0,
                  }}
                />
                <span style={{ fontSize: 12, color: INK }}>
                  {g.openedAt ? t('openedAt', { ago: timeAgo(g.openedAt) }) : t('notOpened')}
                </span>
              </div>
              <span
                style={{
                  justifySelf: 'start',
                  padding: '4px 12px',
                  borderRadius: 20,
                  fontSize: 11,
                  boxShadow: `0 0 0 0.5px ${g.rsvp === 'yes' ? GREEN : g.rsvp === 'no' ? RED : TAN}`,
                  color: g.rsvp === 'yes' ? GREEN : g.rsvp === 'no' ? RED : TAN_LIGHT,
                  whiteSpace: 'nowrap',
                }}
              >
                {g.rsvp === 'yes' ? tf('yes') : g.rsvp === 'no' ? tf('no') : tf('pending')}
              </span>
              <span
                style={{
                  fontStyle: 'italic',
                  fontSize: 12,
                  lineHeight: 1.5,
                  color: g.firstWish ? INK : 'rgb(217,209,201)',
                  overflow: 'hidden',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                }}
              >
                {g.firstWish ?? '—'}
              </span>
              <div
                style={{
                  display: 'flex',
                  gap: 8,
                  justifyContent: 'flex-end',
                  alignItems: 'center',
                }}
              >
                <button type="button" onClick={() => onCopyLink(g)} style={rowPill}>
                  {t('copy')}
                </button>
                <a href={`/i/${g.id}`} target="_blank" rel="noreferrer" style={rowPill}>
                  {t('open')}
                </a>
                <button type="button" onClick={() => onEdit(g)} style={rowGhost}>
                  {t('edit')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (confirm(t('deleteConfirm', { label: g.label }))) onDelete(g);
                  }}
                  style={rowGhost}
                >
                  {t('delete')}
                </button>
              </div>
            </div>
          );
        })}
        {pageRows.length === 0 ? (
          <div
            style={{
              padding: '32px 24px',
              textAlign: 'center',
              fontStyle: 'italic',
              fontSize: 13,
              color: TAN_LIGHT,
            }}
          >
            {t('empty')}
          </div>
        ) : null}

        <div
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            padding: '12px 24px',
            background: CREAM_2,
            borderTop: `0.5px solid ${TAN}`,
          }}
        >
          <span style={{ fontSize: 12, color: TAN }}>
            {filtered.length
              ? t('pageInfo', {
                  from: start + 1,
                  to: Math.min(start + pageSize, filtered.length),
                  total: filtered.length,
                })
              : t('pageInfoEmpty')}
          </span>
          <div style={{ flexGrow: 1 }} />
          <span style={{ ...kicker, letterSpacing: '0.1em' }}>{t('pageSize')}</span>
          {[10, 25, 50, 100].map((n) => (
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
              setSel({});
            }}
            aria-label={t('prev')}
            style={pagerBtn}
          >
            {'‹'}
          </button>
          <span style={{ fontSize: 12, color: INK, minWidth: 70, textAlign: 'center' }}>
            {t('page', { page: safePage, max: maxPage })}
          </span>
          <button
            type="button"
            onClick={() => {
              setPage(Math.min(maxPage, safePage + 1));
              setSel({});
            }}
            aria-label={t('next')}
            style={pagerBtn}
          >
            {'›'}
          </button>
        </div>
      </div>
    </>
  );
}

const rowPill: CSSProperties = {
  padding: '6px 12px',
  borderRadius: 20,
  border: 'none',
  background: 'transparent',
  boxShadow: `0 0 0 0.5px ${TAN}`,
  fontSize: 11,
  color: INK,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  fontFamily: 'inherit',
  textDecoration: 'none',
};

const rowGhost: CSSProperties = {
  padding: '6px 10px',
  borderRadius: 20,
  border: 'none',
  background: 'transparent',
  fontSize: 11,
  color: TAN_LIGHT,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const pagerBtn: CSSProperties = {
  marginLeft: 8,
  width: 26,
  height: 26,
  borderRadius: 13,
  border: 'none',
  background: 'transparent',
  boxShadow: `0 0 0 0.5px ${TAN}`,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 14,
  color: INK,
  cursor: 'pointer',
  userSelect: 'none',
  fontFamily: 'inherit',
};
