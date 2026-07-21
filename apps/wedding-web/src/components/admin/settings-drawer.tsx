'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { adminApi, ApiError, type AdminEvent, type Settings } from '@/lib/admin-api';
import { useDialogFocus } from '@/lib/use-dialog-focus';
import { useUnsavedGuard } from './use-unsaved-guard';
import { EventFields } from './event-fields';
import { SettingsFields } from './settings-fields';
import {
  pillGhost,
  pillSolid,
  CREAM,
  CREAM_2,
  GREEN,
  HAIRLINE,
  INK,
  TAN,
  TAN_LIGHT,
  RING,
} from './ui';

// One "Cài đặt" button opens a right drawer that merges the two former panels —
// venue/timeline (default tab) and site settings — under a single centred,
// sticky Huỷ/Lưu bar. The bar shows only when the ACTIVE tab genuinely differs
// from saved data (deep compare, so editing a value back to its original makes
// the bar vanish with no click). Leaving a dirty tab — switching tab, closing
// the drawer, or leaving the page — warns first. The heavy field bodies live in
// EventFields/SettingsFields; this component owns draft, dirty and save.

type Tab = 'event' | 'site';

// A value counts as changed only if it truly differs from saved (''-normalised;
// arrays/objects compared structurally) — this is what lets the bar disappear
// when a field is typed back to its original.
function fieldDirty(a: unknown, b: unknown): boolean {
  if (a !== null && typeof a === 'object') return JSON.stringify(a) !== JSON.stringify(b ?? null);
  if (b !== null && typeof b === 'object') return true;
  const na = a == null ? '' : String(a);
  const nb = b == null ? '' : String(b);
  return na !== nb;
}
function draftDirty(draft: Record<string, unknown>, orig: Record<string, unknown>): boolean {
  return Object.keys(draft).some((k) => fieldDirty(draft[k], orig[k]));
}

export function SettingsDrawer({
  event,
  settings,
  onEventSaved,
  onSettingsSaved,
  onError,
}: {
  event: AdminEvent | null;
  settings: Settings;
  onEventSaved: (next: AdminEvent) => void;
  onSettingsSaved: (next: Settings) => void;
  onError: (msg: string) => void;
}) {
  const td = useTranslations('admin.drawer');
  const tu = useTranslations('admin.unsaved');
  const te = useTranslations('admin.eventPanel');
  const ts = useTranslations('admin.settings');
  const tSaved = useTranslations('admin.toasts')('saved');

  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('event');
  const [eventDraft, setEventDraft] = useState<Record<string, string>>({});
  const [nameDraft, setNameDraft] = useState<string | undefined>(undefined);
  const [subdomainDraft, setSubdomainDraft] = useState<string | undefined>(undefined);
  const [siteDraft, setSiteDraft] = useState<Settings>({});
  const [uploading, setUploading] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedToast, setSavedToast] = useState(false);
  const dialogRef = useDialogFocus<HTMLElement>(open);

  const origData = event?.data ?? {};
  const subLabel = event?.subdomain ? event.subdomain.replace(/\.luminstudio\.vn$/, '') : '';
  const nameDirty = nameDraft !== undefined && nameDraft !== (event?.name ?? '');
  const subDirty = subdomainDraft !== undefined && subdomainDraft !== subLabel;
  const eventDirty = draftDirty(eventDraft, origData) || nameDirty || subDirty;
  const siteDirty = draftDirty(siteDraft, settings);
  const activeDirty = tab === 'event' ? eventDirty : siteDirty;
  const anyDirty = eventDirty || siteDirty;

  useUnsavedGuard(anyDirty);

  const resetAll = () => {
    setEventDraft({});
    setNameDraft(undefined);
    setSubdomainDraft(undefined);
    setSiteDraft({});
  };
  const resetActive = () => {
    if (tab === 'event') {
      setEventDraft({});
      setNameDraft(undefined);
      setSubdomainDraft(undefined);
    } else {
      setSiteDraft({});
    }
  };

  const confirmLeave = () => !activeDirty || window.confirm(td('unsavedWarn'));
  const attemptClose = () => {
    if (!confirmLeave()) return;
    resetAll();
    setOpen(false);
  };
  const switchTab = (next: Tab) => {
    if (next === tab) return;
    if (!confirmLeave()) return;
    resetActive();
    setTab(next);
  };
  const openDrawer = () => {
    resetAll();
    setTab('event');
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') attemptClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, activeDirty]);

  // ---- value/patch bridges for the field bodies -----------------------------
  const evVal = (key: string): string => {
    if (key in eventDraft) return eventDraft[key];
    const v = origData[key];
    return typeof v === 'string' ? v : '';
  };
  const evPatch = (key: string, value: string) => setEventDraft((d) => ({ ...d, [key]: value }));
  const siteVal = <T,>(key: string, fallback: T): T => {
    if (key in siteDraft) return siteDraft[key] as T;
    return (settings[key] as T) ?? fallback;
  };
  const sitePatch = (p: Settings) => setSiteDraft((d) => ({ ...d, ...p }));

  const uploadFile = async (kind: string, file: File, apply: (url: string) => void) => {
    setUploading(kind);
    try {
      apply(await adminApi.upload(kind, file));
    } catch {
      onError(ts('uploadFailed'));
    } finally {
      setUploading(null);
    }
  };

  const flashSaved = () => {
    setSavedToast(true);
    setTimeout(() => setSavedToast(false), 2400);
  };

  const save = async () => {
    if (saving || !activeDirty) return;
    setSaving(true);
    try {
      if (tab === 'event') {
        if (!event) return;
        const body: { name?: string; subdomain?: string; data?: Record<string, string> } = {};
        if (nameDirty) body.name = nameDraft;
        if (subDirty) body.subdomain = subdomainDraft;
        if (Object.keys(eventDraft).length > 0) body.data = eventDraft;
        if (Object.keys(body).length === 0) return;
        const next = await adminApi.patchEvent(event.slug, body);
        setEventDraft({});
        setNameDraft(undefined);
        setSubdomainDraft(undefined);
        onEventSaved(next);
      } else {
        const next = await adminApi.patchSettings(siteDraft);
        setSiteDraft({});
        onSettingsSaved(next);
      }
      flashSaved();
    } catch (err) {
      if (tab === 'event') {
        onError(
          err instanceof ApiError && err.code === 'SUBDOMAIN_TAKEN'
            ? te('subdomainTaken')
            : te('saveFailed'),
        );
      } else {
        onError(ts('saveFailed'));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button type="button" onClick={openDrawer} style={pillGhost} className="wa-pill-ghost">
        {td('open')}
      </button>

      {open ? (
        <>
          <button
            type="button"
            onClick={attemptClose}
            aria-label={td('close')}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 40,
              border: 'none',
              padding: 0,
              background: 'rgba(59,47,39,0.32)',
              cursor: 'default',
            }}
          />
          <aside
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={td('title')}
            tabIndex={-1}
            style={{
              position: 'fixed',
              top: 0,
              right: 0,
              height: '100dvh',
              width: 560,
              maxWidth: '100vw',
              zIndex: 50,
              background: CREAM,
              boxShadow: '-12px 0 40px rgba(59,47,39,0.22)',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <header
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '18px 22px 14px',
                borderBottom: `0.5px solid ${HAIRLINE}`,
              }}
            >
              <span style={{ fontWeight: 600, fontSize: 15, color: INK }}>{td('title')}</span>
              {event ? (
                <span style={{ fontSize: 12, color: TAN_LIGHT }}>· {event.name}</span>
              ) : null}
              <span style={{ flexGrow: 1 }} />
              {savedToast ? (
                <span style={{ fontStyle: 'italic', fontSize: 12, color: GREEN }}>{tSaved}</span>
              ) : null}
              {uploading ? (
                <span style={{ fontStyle: 'italic', fontSize: 12, color: TAN }}>
                  {ts('uploading')}
                </span>
              ) : null}
              <button
                type="button"
                onClick={attemptClose}
                aria-label={td('close')}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  border: 'none',
                  background: 'transparent',
                  boxShadow: RING,
                  color: INK,
                  fontSize: 16,
                  lineHeight: 1,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                ×
              </button>
            </header>

            <div style={{ display: 'flex', gap: 4, padding: '10px 16px 0' }}>
              {(
                [
                  ['event', td('tabEvent'), eventDirty],
                  ['site', td('tabSite'), siteDirty],
                ] as const
              ).map(([key, label, dirty]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => switchTab(key)}
                  style={{
                    padding: '8px 16px',
                    border: 'none',
                    borderRadius: '8px 8px 0 0',
                    background: tab === key ? CREAM_2 : 'transparent',
                    color: tab === key ? INK : TAN_LIGHT,
                    fontWeight: tab === key ? 600 : 400,
                    fontSize: 13,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {label}
                  {dirty ? <span style={{ color: TAN, marginLeft: 6 }}>•</span> : null}
                </button>
              ))}
            </div>

            <div
              style={{ flex: 1, overflowY: 'auto', padding: '20px 22px 24px', background: CREAM_2 }}
            >
              {tab === 'event' ? (
                event ? (
                  <EventFields
                    event={event}
                    val={evVal}
                    patch={evPatch}
                    nameValue={nameDraft ?? event.name}
                    subdomainValue={subdomainDraft ?? subLabel}
                    onNameChange={setNameDraft}
                    onSubdomainChange={setSubdomainDraft}
                    uploadMap={(file) =>
                      void uploadFile('map', file, (url) => evPatch('mapUrl', url))
                    }
                  />
                ) : (
                  <span style={{ fontSize: 12, color: TAN_LIGHT }}>{td('noEvent')}</span>
                )
              ) : (
                <SettingsFields
                  val={siteVal}
                  patch={sitePatch}
                  uploadFile={(kind, file, apply) => void uploadFile(kind, file, apply)}
                  onError={onError}
                />
              )}
            </div>

            {activeDirty ? (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  gap: 14,
                  padding: '14px 22px',
                  borderTop: `0.5px solid ${HAIRLINE}`,
                  background: CREAM,
                }}
              >
                <span style={{ fontSize: 12, fontStyle: 'italic', color: INK }}>
                  {tu('message')}
                </span>
                <button
                  type="button"
                  onClick={resetActive}
                  style={pillGhost}
                  className="wa-pill-ghost"
                >
                  {tu('cancel')}
                </button>
                <button
                  type="button"
                  onClick={() => void save()}
                  disabled={saving}
                  style={{ ...pillSolid, opacity: saving ? 0.6 : 1 }}
                  className="wa-pill-solid"
                >
                  {saving ? tu('saving') : tu('save')}
                </button>
              </div>
            ) : null}
          </aside>
        </>
      ) : null}
    </>
  );
}
