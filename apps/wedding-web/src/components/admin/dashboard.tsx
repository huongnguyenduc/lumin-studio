'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  adminApi,
  ApiError,
  type AdminGuest,
  type AdminWish,
  type AdminStats,
  type Settings,
} from '@/lib/admin-api';
import { Login } from './login';
import { QuickAdd } from './quick-add';
import { GuestTable } from './guest-table';
import { WishesPanel } from './wishes-panel';
import { SettingsPanel } from './settings-panel';
import {
  card,
  inputBase,
  kicker,
  pillSolid,
  pillGhost,
  GREEN,
  INK,
  RED,
  TAN_LIGHT,
  SCRIPT,
} from './ui';

type EditState = { id: string | null; label: string; group: string; note: string } | null;

export function AdminDashboard() {
  const t = useTranslations('admin');
  const [authed, setAuthed] = useState<boolean | null>(null); // null = probing
  const [guests, setGuests] = useState<AdminGuest[]>([]);
  const [groups, setGroups] = useState<string[]>([]);
  const [wishes, setWishes] = useState<AdminWish[]>([]);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [settings, setSettings] = useState<Settings>({});
  const [search, setSearch] = useState('');
  const [quickGroup, setQuickGroup] = useState('Bạn bè');
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const [editing, setEditing] = useState<EditState>(null);
  const sessionCount = useRef(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flash = useCallback((text: string, error = false) => {
    setToast({ text, error });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  const reload = useCallback(async () => {
    try {
      const [g, gr, w, s, set] = await Promise.all([
        adminApi.guests(),
        adminApi.groups(),
        adminApi.wishes(),
        adminApi.stats(),
        adminApi.settings(),
      ]);
      setGuests(g.items);
      setGroups(gr.items.map((x) => x.name));
      setWishes(w.items);
      setStats(s);
      setSettings(set);
      setAuthed(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setAuthed(false);
      else flash(t('toasts.apiError'), true);
    }
  }, [flash, t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Every mutation: call API then reload (one wedding, small data — no cache dance).
  const run = useCallback(
    async (fn: () => Promise<unknown>, onDone?: () => void) => {
      try {
        await fn();
        onDone?.();
        await reload();
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) setAuthed(false);
        else flash(t('toasts.apiError'), true);
      }
    },
    [reload, flash, t],
  );

  const copyLink = (g: AdminGuest) => {
    const link = `${location.origin}/i/${g.id}`;
    const done = () => flash(t('toasts.copied', { label: g.label }));
    if (navigator.clipboard?.writeText) void navigator.clipboard.writeText(link).then(done, done);
    else done();
  };

  const exportXlsx = async () => {
    const te = (k: string, v?: Record<string, string | number>) => t(`export.${k}`, v);
    const XLSX = await import('xlsx'); // dynamic — keep SheetJS out of the page bundle
    const guestRows = guests.map((g) => ({
      [te('colLabel')]: g.label,
      [te('colGroup')]: g.group,
      [te('colNote')]: g.note ?? '',
      [te('colOpened')]: g.openedAt ? te('openedYes') : te('openedNo'),
      [te('colOpenedAt')]: g.openedAt ? formatVN(g.openedAt) : '',
      [te('colRsvp')]:
        g.rsvp === 'yes' ? te('rsvpYes') : g.rsvp === 'no' ? te('rsvpNo') : te('rsvpPending'),
      [te('colWish')]: g.firstWish ?? '',
      [te('colLink')]: `${location.origin}/i/${g.id}`,
    }));
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(guestRows);
    ws['!cols'] = [
      { wch: 28 },
      { wch: 14 },
      { wch: 10 },
      { wch: 18 },
      { wch: 15 },
      { wch: 50 },
      { wch: 50 },
    ];
    XLSX.utils.book_append_sheet(wb, ws, te('guestSheet'));
    const wishRows = wishes.map((w) => ({
      [te('colName')]: w.name,
      [te('colWish')]: w.text,
      [te('colTime')]: formatVN(w.createdAt),
    }));
    const ws2 = XLSX.utils.json_to_sheet(
      wishRows.length
        ? wishRows
        : [{ [te('colName')]: '', [te('colWish')]: '', [te('colTime')]: '' }],
    );
    ws2['!cols'] = [{ wch: 24 }, { wch: 70 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, ws2, te('wishSheet'));
    XLSX.writeFile(wb, te('filename'));
  };

  if (authed === null) return null; // probing — brief, no flash of login
  if (!authed) return <Login onSuccess={() => void reload()} />;

  return (
    <div
      style={{
        maxWidth: 1120,
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 24,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
        <div
          style={{
            width: 40,
            height: 40,
            backgroundColor: INK,
            WebkitMask: 'url(/invite/logo-mark.svg) center / contain no-repeat',
            mask: 'url(/invite/logo-mark.svg) center / contain no-repeat',
          }}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontFamily: SCRIPT, fontSize: 30, lineHeight: 1.1 }}>{t('couple')}</span>
          <span style={{ ...kicker, letterSpacing: '0.26em' }}>{t('title')}</span>
        </div>
        <div style={{ flexGrow: 1 }} />
        <button
          type="button"
          onClick={() => void exportXlsx()}
          style={pillSolid}
          className="wa-pill-solid"
        >
          {t('header.export')}
        </button>
        <a
          href="/"
          target="_blank"
          rel="noreferrer"
          style={{ ...pillGhost, textDecoration: 'none' }}
        >
          {t('header.preview')}
        </a>
        <button
          type="button"
          onClick={() =>
            void adminApi.logout().then(
              () => setAuthed(false),
              () => setAuthed(false),
            )
          }
          style={{
            padding: '8px 14px',
            border: 'none',
            background: 'transparent',
            borderRadius: 22,
            fontSize: 12,
            color: TAN_LIGHT,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {t('header.logout')}
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 14 }}>
        {(
          [
            ['guests', stats?.guests, undefined],
            ['opened', stats?.opened, undefined],
            ['yes', stats?.rsvpYes, GREEN],
            ['no', stats?.rsvpNo, RED],
            ['wishes', stats?.wishes, undefined],
          ] as const
        ).map(([key, value, color]) => (
          <div
            key={key}
            style={{
              ...card,
              padding: '18px 20px',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}
          >
            <span style={{ fontWeight: 600, fontSize: 30, lineHeight: 1, color }}>
              {value ?? 0}
            </span>
            <span style={kicker}>{t(`stats.${key}`)}</span>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('search.placeholder')}
          aria-label={t('search.placeholder')}
          style={{ ...inputBase, width: 260, borderRadius: 22, padding: '9px 16px' }}
        />
        <div style={{ flexGrow: 1 }} />
        {toast ? (
          <span style={{ fontStyle: 'italic', fontSize: 12, color: toast.error ? RED : GREEN }}>
            {toast.text}
          </span>
        ) : null}
      </div>

      <QuickAdd
        groups={groups}
        selectedGroup={quickGroup}
        onSelectGroup={setQuickGroup}
        onAdd={(label) =>
          void run(
            () => adminApi.createGuest({ label, group: quickGroup }),
            () => {
              sessionCount.current += 1;
              flash(t('toasts.added', { label, count: sessionCount.current }));
            },
          )
        }
        onBulkAdd={(lines) =>
          void run(
            async () => {
              for (const l of lines) await adminApi.createGuest(l);
            },
            () => {
              sessionCount.current += lines.length;
              flash(t('toasts.addedBulk', { count: lines.length }));
            },
          )
        }
        onCreateGroup={(name) =>
          void run(
            () => adminApi.createGroup(name),
            () => setQuickGroup(name),
          )
        }
        onRenameGroup={(from, to) =>
          void run(
            () => adminApi.renameGroup(from, to),
            () => {
              if (quickGroup === from) setQuickGroup(to);
            },
          )
        }
        onDeleteGroup={(name) =>
          void run(
            () => adminApi.deleteGroup(name),
            () => {
              if (quickGroup === name) setQuickGroup('Khác');
            },
          )
        }
      />

      <SettingsPanel
        settings={settings}
        onSaved={(next) => {
          setSettings(next);
          flash(t('toasts.saved'));
        }}
        onError={(msg) => flash(msg, true)}
      />

      {editing ? (
        <EditPanel
          state={editing}
          groups={groups}
          onChange={setEditing}
          onSave={() => {
            const label = editing.label.trim();
            if (!label || !editing.id) return;
            void run(
              () =>
                adminApi.patchGuest(editing.id as string, {
                  label,
                  group: editing.group,
                  note: editing.note.trim(),
                }),
              () => setEditing(null),
            );
          }}
          onCancel={() => setEditing(null)}
        />
      ) : null}

      <GuestTable
        guests={guests}
        groups={groups}
        search={search}
        onEdit={(g) => setEditing({ id: g.id, label: g.label, group: g.group, note: g.note ?? '' })}
        onDelete={(g) => void run(() => adminApi.deleteGuest(g.id))}
        onBulkDelete={(ids) => void run(() => adminApi.bulkDeleteGuests(ids))}
        onSaveNote={(id, note) => void run(() => adminApi.patchGuest(id, { note }))}
        onCopyLink={copyLink}
      />

      <WishesPanel
        wishes={wishes}
        onDelete={(w) => void run(() => adminApi.deleteWish(w.id))}
        onBulkDelete={(ids) => void run(() => adminApi.bulkDeleteWishes(ids))}
      />
    </div>
  );
}

// Inline edit panel above the table (§3.3) with the live script-font preview.
function EditPanel({
  state,
  groups,
  onChange,
  onSave,
  onCancel,
}: {
  state: NonNullable<EditState>;
  groups: string[];
  onChange: (s: EditState) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations('admin.edit');
  const field = (label: string, node: React.ReactNode) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={kicker}>{label}</span>
      {node}
    </div>
  );
  return (
    <div
      style={{
        background: 'rgb(249,241,232)',
        borderRadius: 10,
        boxShadow: '0 0 0 0.5px rgb(176,157,144)',
        padding: '20px 24px',
        display: 'flex',
        gap: 14,
        alignItems: 'flex-end',
        flexWrap: 'wrap',
      }}
    >
      {field(
        t('label'),
        <input
          value={state.label}
          onChange={(e) => onChange({ ...state, label: e.target.value })}
          placeholder={t('labelPlaceholder')}
          aria-label={t('label')}
          style={{ ...inputBase, width: 300, borderRadius: 8, padding: '9px 14px' }}
        />,
      )}
      {field(
        t('group'),
        <select
          value={state.group}
          onChange={(e) => onChange({ ...state, group: e.target.value })}
          aria-label={t('group')}
          style={{ ...inputBase, borderRadius: 8, padding: '9px 12px', cursor: 'pointer' }}
        >
          {groups.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>,
      )}
      {field(
        t('note'),
        <input
          value={state.note}
          onChange={(e) => onChange({ ...state, note: e.target.value })}
          placeholder={t('notePlaceholder')}
          aria-label={t('note')}
          style={{ ...inputBase, width: 300, borderRadius: 8, padding: '9px 14px' }}
        />,
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexGrow: 1 }}>
        <span style={kicker}>{t('preview')}</span>
        <span
          style={{
            fontFamily: SCRIPT,
            fontSize: 24,
            lineHeight: 1.3,
            color: 'rgb(203,77,28)',
            textTransform: 'capitalize',
          }}
        >
          {state.label || t('previewFallback')}
        </span>
      </div>
      <button type="button" onClick={onSave} style={pillSolid} className="wa-pill-solid">
        {t('save')}
      </button>
      <button type="button" onClick={onCancel} style={pillGhost} className="wa-pill-ghost">
        {t('cancel')}
      </button>
    </div>
  );
}

function formatVN(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}
