'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  adminApi,
  ApiError,
  type AdminEvent,
  type AdminGuest,
  type AdminWedding,
  type AdminWish,
  type AdminStats,
  type Settings,
} from '@/lib/admin-api';
import { Login } from './login';
import { QuickAdd } from './quick-add';
import { GuestTable } from './guest-table';
import { WishesPanel } from './wishes-panel';
import { SettingsDrawer } from './settings-drawer';
import { ChangePassword } from './change-password';
import { WeddingSwitcher } from './wedding-switcher';
import {
  card,
  chipStyle,
  inputBase,
  kicker,
  pillSolid,
  pillGhost,
  GREEN,
  INK,
  RED,
  TAN,
  SCRIPT,
} from './ui';

type EditState = { id: string | null; label: string; group: string; note: string } | null;

export function AdminDashboard({ activeSlug }: { activeSlug: string | null }) {
  const t = useTranslations('admin');
  const [authed, setAuthed] = useState<boolean | null>(null); // null = probing
  const [master, setMaster] = useState(false);
  const [weddings, setWeddings] = useState<AdminWedding[]>([]);
  const [selectedWedding, setSelectedWedding] = useState<string | null>(null);
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<string | null>(null);
  const [newEventOpen, setNewEventOpen] = useState(false);
  const [newEventName, setNewEventName] = useState('');
  const [guests, setGuests] = useState<AdminGuest[]>([]);
  const [groups, setGroups] = useState<string[]>([]);
  const [wishes, setWishes] = useState<AdminWish[]>([]);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [settings, setSettings] = useState<Settings>({});
  const [search, setSearch] = useState('');
  const [quickGroup, setQuickGroup] = useState('Bạn bè');
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<EditState>(null);
  const [changingPassword, setChangingPassword] = useState(false);
  const sessionCount = useRef(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flash = useCallback((text: string, error = false) => {
    setToast({ text, error });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  // Every wedding has its own events/guests/groups/stats/settings/wishes wall.
  // A master session picks a wedding first (chips above the event tabs); a
  // couple session's single wedding is implicit (weddings always has exactly
  // its one row). Reload keeps whatever wedding/event tab is selected, falling
  // back on initial load to THIS subdomain's event (WEDDING_EVENT_SLUG) so the
  // admin opens on the right wedding's guests.
  const reload = useCallback(
    async (forEvent?: string, forWedding?: string) => {
      try {
        const me = await adminApi.me();
        setMaster(me.master);
        const wr = await adminApi.weddings();
        setWeddings(wr.items);
        const wedSlug = forWedding ?? selectedWedding ?? wr.items[0]?.slug ?? null;
        setSelectedWedding(wedSlug);

        const ev = await adminApi.events();
        setEvents(ev.items);
        const scoped = me.master ? ev.items.filter((e) => e.weddingSlug === wedSlug) : ev.items;
        const envSlug = activeSlug && scoped.some((e) => e.slug === activeSlug) ? activeSlug : null;
        const slug =
          forEvent ??
          (scoped.some((e) => e.slug === selectedEvent) ? selectedEvent : null) ??
          envSlug ??
          scoped[0]?.slug ??
          null;
        setSelectedEvent(slug);
        if (!slug) {
          setGuests([]);
          setGroups([]);
          setStats(null);
          setAuthed(true);
          return;
        }
        const [g, gr, w, s, set] = await Promise.all([
          adminApi.guests(slug),
          adminApi.groups(slug),
          adminApi.wishes(500, wedSlug ?? undefined),
          adminApi.stats(slug),
          adminApi.settings(wedSlug ?? undefined),
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
    },
    [flash, t, selectedEvent, selectedWedding, activeSlug],
  );

  // deliberately run once on mount only — reload reads selectedEvent via
  // closure but switching tabs calls reload(slug) explicitly.
  const initialLoad = useRef(false);
  useEffect(() => {
    if (initialLoad.current) return;
    initialLoad.current = true;
    void reload();
  }, [reload]);

  // Every mutation: call API then reload (one wedding, small data — no cache dance).
  // Flashes a success toast by default (override via successMsg, or suppress via
  // silent when the caller already flashes its own message from onDone).
  const run = useCallback(
    async (
      fn: () => Promise<unknown>,
      opts?: {
        onDone?: () => void;
        successMsg?: string;
        silent?: boolean;
        // Map an API error code to a specific toast (e.g. LAST_WEDDING) instead
        // of the generic "có lỗi" — falls back to the generic one when unmapped.
        errorMsgs?: Record<string, string>;
      },
    ) => {
      setSaving(true);
      try {
        await fn();
        opts?.onDone?.();
        await reload();
        if (!opts?.silent) flash(opts?.successMsg ?? t('toasts.updated'));
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) setAuthed(false);
        else if (err instanceof ApiError && opts?.errorMsgs?.[err.code])
          flash(opts.errorMsgs[err.code], true);
        else flash(t('toasts.apiError'), true);
      } finally {
        setSaving(false);
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

  const eventsForWedding = master
    ? events.filter((e) => e.weddingSlug === selectedWedding)
    : events;
  const currentWedding = weddings.find((w) => w.slug === selectedWedding) ?? null;
  const coupleLabel = currentWedding?.name ?? t('couple');

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
          <span style={{ fontFamily: SCRIPT, fontSize: 30, lineHeight: 1.1 }}>{coupleLabel}</span>
          <span style={{ ...kicker, letterSpacing: '0.26em' }}>{t('title')}</span>
        </div>
        <div style={{ flexGrow: 1 }} />
        <SettingsDrawer
          event={events.find((e) => e.slug === selectedEvent) ?? null}
          settings={settings}
          isMaster={master}
          onEventSaved={() => void reload()}
          onSettingsSaved={(next) => {
            setSettings(next);
            flash(t('toasts.saved'));
          }}
          onReviewSubdomain={(approve) => {
            if (!selectedEvent) return;
            void run(() => adminApi.reviewSubdomain(selectedEvent, approve));
          }}
          onError={(msg) => flash(msg, true)}
        />
        <button
          type="button"
          onClick={() => setChangingPassword(true)}
          style={pillGhost}
          className="wa-pill-ghost"
        >
          {t('password.open')}
        </button>
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
            color: INK,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {t('header.logout')}
        </button>
      </div>

      {changingPassword ? (
        <ChangePassword
          onClose={() => setChangingPassword(false)}
          onError={(m) => flash(m, true)}
        />
      ) : null}

      {master ? (
        <WeddingSwitcher
          weddings={weddings}
          selected={selectedWedding}
          onSelect={(slug) => {
            if (slug === selectedWedding) return;
            setSelectedWedding(slug);
            setSelectedEvent(null);
            void reload(undefined, slug);
          }}
          onCreate={(name) =>
            void run(() => adminApi.createWedding(name), { successMsg: t('toasts.saved') })
          }
          onRename={(slug, name) => void run(() => adminApi.patchWedding(slug, { name }))}
          onSetPassword={(slug, password) =>
            void run(() => adminApi.patchWedding(slug, { password }), {
              successMsg: t('weddings.passwordSaved'),
            })
          }
          onDelete={(slug) =>
            void run(() => adminApi.deleteWedding(slug), {
              onDone: () => {
                if (selectedWedding === slug) setSelectedWedding(null);
              },
              errorMsgs: { LAST_WEDDING: t('weddings.cannotDeleteLast') },
            })
          }
          onError={(msg) => flash(msg, true)}
        />
      ) : null}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={kicker}>{t('events.heading')}</span>
        {eventsForWedding.map((ev) => (
          <button
            key={ev.slug}
            type="button"
            onClick={() => {
              if (ev.slug === selectedEvent) return;
              setSelectedEvent(ev.slug);
              void reload(ev.slug);
            }}
            style={chipStyle(ev.slug === selectedEvent)}
          >
            {ev.name}
            {ev.requestedSubdomain ? <span style={{ color: TAN, marginLeft: 6 }}>•</span> : null}
          </button>
        ))}
        {newEventOpen ? (
          <input
            value={newEventName}
            onChange={(e) => setNewEventName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setNewEventOpen(false);
                setNewEventName('');
              }
              if (e.key !== 'Enter') return;
              const name = newEventName.trim();
              setNewEventOpen(false);
              setNewEventName('');
              if (!name || !selectedWedding) return;
              void run(() => adminApi.createEvent(name, selectedWedding), {
                successMsg: t('toasts.saved'),
              });
            }}
            placeholder={t('events.addPlaceholder')}
            aria-label={t('events.addPlaceholder')}
            // eslint-disable-next-line jsx-a11y/no-autofocus -- appears on explicit "+ Thêm đám cưới" click
            autoFocus
            style={{
              ...inputBase,
              width: 200,
              borderRadius: 20,
              boxShadow: `0 0 0 0.5px ${INK}`,
              padding: '5px 14px',
              fontSize: 12,
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setNewEventOpen(true)}
            disabled={!selectedWedding}
            style={{
              padding: '5px 14px',
              borderRadius: 20,
              border: `1px dashed ${TAN}`,
              background: 'transparent',
              fontSize: 12,
              color: INK,
              cursor: selectedWedding ? 'pointer' : 'default',
              opacity: selectedWedding ? 1 : 0.5,
              whiteSpace: 'nowrap',
              fontFamily: 'inherit',
            }}
          >
            {t('events.add')}
          </button>
        )}
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
        {saving ? (
          <span style={{ fontStyle: 'italic', fontSize: 12, color: INK }}>
            {t('toasts.saving')}
          </span>
        ) : toast ? (
          <span style={{ fontStyle: 'italic', fontSize: 12, color: toast.error ? RED : GREEN }}>
            {toast.text}
          </span>
        ) : null}
      </div>

      <QuickAdd
        groups={groups}
        selectedGroup={quickGroup}
        onSelectGroup={setQuickGroup}
        onAdd={(label) => {
          if (!selectedEvent) return;
          const count = sessionCount.current + 1;
          void run(
            () => adminApi.createGuest({ label, group: quickGroup, eventSlug: selectedEvent }),
            {
              onDone: () => {
                sessionCount.current = count;
              },
              successMsg: t('toasts.added', { label, count }),
            },
          );
        }}
        onBulkAdd={(lines) => {
          if (!selectedEvent) return;
          void run(
            async () => {
              for (const l of lines) await adminApi.createGuest({ ...l, eventSlug: selectedEvent });
            },
            {
              onDone: () => {
                sessionCount.current += lines.length;
              },
              successMsg: t('toasts.addedBulk', { count: lines.length }),
            },
          );
        }}
        onCreateGroup={(name) =>
          selectedEvent &&
          void run(() => adminApi.createGroup(name, selectedEvent), {
            onDone: () => setQuickGroup(name),
          })
        }
        onRenameGroup={(from, to) =>
          selectedEvent &&
          void run(() => adminApi.renameGroup(selectedEvent, from, to), {
            onDone: () => {
              if (quickGroup === from) setQuickGroup(to);
            },
          })
        }
        onDeleteGroup={(name) =>
          selectedEvent &&
          void run(() => adminApi.deleteGroup(selectedEvent, name), {
            onDone: () => {
              if (quickGroup === name) setQuickGroup('Khác');
            },
          })
        }
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
              { onDone: () => setEditing(null) },
            );
          }}
          onCancel={() => setEditing(null)}
        />
      ) : null}

      <GuestTable
        guests={guests}
        groups={groups}
        search={search}
        eventName={events.find((e) => e.slug === selectedEvent)?.name ?? ''}
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
