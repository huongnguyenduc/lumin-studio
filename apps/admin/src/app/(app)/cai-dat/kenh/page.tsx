import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Card } from '@lumin/ui';

// "Cài đặt › Kênh chat" (P3-r, design screen 16). FE-only placeholder: connecting a social inbox
// (Messenger / Instagram / Zalo OA / TikTok Shop) and auto-saving customers from chat both run through
// the browser extension, which lands in Phase 4 — and there is no Settings field to persist any of it
// yet. So every connect/toggle here is a disabled placeholder behind one "sắp có" banner, which is also
// the honest empty/loading/error state for a screen with no data to fetch. Static server component.
//
// ponytail: the plan's "web-orders toggle (wire checkout gate)" + "notif in-app badge" need a BE Settings
// field / notif source that don't exist, and P3-r is FE-only — neither is in design 16 → deferred (add
// with the backend that owns them). The web-orders gate today is STK-presence (settings-view), not a flag.

// Brand swatch colours identify each channel — decorative, not design-system tokens → inline styles.
const CHANNELS = [
  { key: 'messenger', colour: '#4C8DFF', handle: 'm.me/luminstudio' },
  { key: 'instagram', colour: '#D96AA6', handle: 'instagram.com/luminstudio' },
  { key: 'zalo', colour: '#0068FF', handle: 'zalo.me/luminstudio' },
  { key: 'tiktok', colour: '#111111', handle: 'tiktok.com/@luminstudio' },
] as const;

// Static "on, locked" switch — the auto-save toggles are Phase-4 placeholders, so this stays a zero-JS
// server-rendered visual (no @lumin/ui Switch: it carries an onClick and can't render in a Server
// Component). Mirrors Switch's on-state look; role/aria convey the disabled on-state to AT.
function StaticSwitch({ label }: { label: string }) {
  return (
    <span
      role="switch"
      aria-checked
      aria-disabled
      aria-label={label}
      className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-pill bg-accent-teal p-0.5 opacity-60"
    >
      <span className="inline-block h-5 w-5 translate-x-5 rounded-full bg-surface-card shadow-sm" />
    </span>
  );
}

export default async function ChannelsPage() {
  const t = await getTranslations('settings');
  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="font-mono text-xs text-text-muted">{t('title')} ›</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-3">
          <h1 className="font-display text-2xl font-semibold text-text-strong">
            {t('channels.title')}
          </h1>
          <span className="inline-flex items-center gap-1.5 rounded-pill border border-border-default px-3 py-1 text-xs text-text-muted">
            <span aria-hidden className="h-2 w-2 rounded-full bg-border-strong" />
            {t('channels.statusNone')}
          </span>
        </div>
        <p className="mt-1 text-sm text-text-muted">{t('channels.subtitle')}</p>
      </div>

      {/* One coming-soon banner = the honest state for a data-less placeholder screen. */}
      <div
        role="note"
        className="rounded-lg border border-dashed border-primary/50 bg-primary/5 px-4 py-3 text-sm text-text-body"
      >
        <p className="font-semibold text-primary">{t('channels.comingSoonTitle')}</p>
        <p className="mt-0.5">{t('channels.comingSoonBody')}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr] lg:items-start">
        {/* Left: the social inboxes, all disconnected — no backend to connect them yet. */}
        <Card elevation="md" className="flex flex-col gap-4 p-5">
          <h2 className="font-display text-lg font-semibold text-text-strong">
            {t('channels.listTitle')}
          </h2>
          <ul className="flex flex-col gap-2">
            {CHANNELS.map((ch) => (
              <li
                key={ch.key}
                className="flex items-center gap-3 rounded-lg border border-border-default px-3 py-2.5"
              >
                <span
                  aria-hidden
                  className="h-8 w-8 shrink-0 rounded-lg border border-border-strong"
                  style={{ background: ch.colour }}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-text-strong">{t(`channels.${ch.key}`)}</p>
                  <p className="truncate font-mono text-xs text-text-muted">{ch.handle}</p>
                </div>
                <span className="shrink-0 text-xs text-text-muted">
                  {t('channels.notConnected')}
                </span>
                <button
                  type="button"
                  disabled
                  className="min-h-[36px] shrink-0 cursor-not-allowed rounded-pill border border-border-default px-3 text-sm text-text-muted opacity-60"
                >
                  {t('channels.connect')}
                </button>
              </li>
            ))}
          </ul>
        </Card>

        {/* Right: extension explainer (one live link, one Phase-4 placeholder) + auto-save toggles. */}
        <div className="flex flex-col gap-6">
          <Card
            elevation="md"
            className="flex flex-col gap-3 border border-primary/40 bg-primary/5 p-5"
          >
            <h2 className="font-display text-lg font-semibold text-text-strong">
              {t('channels.extensionTitle')}
            </h2>
            <p className="text-sm text-text-body">{t('channels.extensionBody')}</p>
            <div className="flex items-center justify-between rounded-lg border border-dashed border-border-default bg-surface-card px-4 py-2.5 text-sm text-text-muted">
              <span>{t('channels.extensionSettings')}</span>
              <span className="text-xs">{t('subpages.comingSoon')}</span>
            </div>
            <Link
              href="/cai-dat/mau-tra-loi"
              className="flex min-h-[44px] items-center justify-between rounded-lg border border-border-default bg-surface-card px-4 py-2 text-sm text-text-body hover:bg-surface-sunken"
            >
              <span>{t('channels.replyTemplates')}</span>
              <span aria-hidden className="text-primary">
                →
              </span>
            </Link>
          </Card>

          <Card elevation="md" className="flex flex-col gap-3 p-5">
            <h2 className="font-display text-lg font-semibold text-text-strong">
              {t('channels.autosaveTitle')}
            </h2>
            <div className="flex items-center gap-3 text-sm text-text-body">
              <span className="flex-1">{t('channels.autosaveLink')}</span>
              <StaticSwitch label={t('channels.autosaveLink')} />
            </div>
            <div className="flex items-center gap-3 text-sm text-text-body">
              <span className="flex-1">{t('channels.autosaveContact')}</span>
              <StaticSwitch label={t('channels.autosaveContact')} />
            </div>
            <p className="text-xs text-text-muted">{t('channels.autosaveNote')}</p>
          </Card>
        </div>
      </div>
    </div>
  );
}
