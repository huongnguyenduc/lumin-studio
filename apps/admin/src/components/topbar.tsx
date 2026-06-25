import { useTranslations } from 'next-intl';
import { formatVnDate } from '@lumin/core';
import { Avatar } from '@lumin/ui';

// FIXED demo instant so the shell renders deterministically (no `new Date()` — that would make the
// header non-reproducible across SSR/CI). Replaced by the real "today" in Phase 1. ISO-8601 UTC,
// rendered in the shop's zone by @lumin/core's formatVnDate → `18/06/2026`.
const DEMO_TODAY_ISO = '2026-06-18T00:00:00Z';

/**
 * Dashboard greeting bar inside the content area (design: Lumin Admin Hi-fi). Warm greeting + the
 * current date + the owner's avatar. Static → server component (the greeting emoji lives in the i18n
 * string value, never a bare JSX text node).
 */
export function Topbar() {
  const t = useTranslations('topbar');

  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl md:text-3xl">{t('greeting')}</h1>
        <p className="font-mono text-sm text-text-muted">{formatVnDate(DEMO_TODAY_ISO)}</p>
      </div>
      <Avatar name="Lumin" size="lg" aria-label={t('profileLabel')} />
    </div>
  );
}
