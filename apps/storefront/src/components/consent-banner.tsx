'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import Script from 'next/script';
import { Button } from '@lumin/ui';
import {
  readConsent,
  umamiConfig,
  writeConsent,
  type ConsentDecision,
} from '@/lib/analytics-consent';

/**
 * Consent-gated analytics (P1-p, PDPL / ADR-015). Umami is loaded ONLY after the visitor opts in — the
 * `<Script>` is never rendered until `decision === 'granted'`, so ZERO analytics network request fires
 * before consent (verifiable in the network panel: the request to NEXT_PUBLIC_UMAMI_SRC only appears
 * after "Đồng ý"). Refusing is one click and equally weighted with accepting (no dark pattern).
 *
 * Session replay stays OFF (ADR-015): we load only the standard tracker (pageviews + custom events),
 * never a replay stream — so replay is forced-off everywhere, including /gio-hang and the personalize
 * surface, by construction.
 * ponytail: if replay is ever enabled in Umami's dashboard, per-route suppression on cart/personalize
 * must be added HERE (read usePathname, gate the replay init) — that's the seam. Deferred until then.
 */
export function ConsentBanner() {
  const t = useTranslations('consent');
  const config = umamiConfig();
  // 'pending' = pre-mount: render nothing on the server and on the first client paint so there's no
  // hydration mismatch (the server can't read localStorage) and no banner flash before we know the
  // stored decision. useEffect then resolves it to the real value.
  const [decision, setDecision] = useState<ConsentDecision | 'pending' | null>('pending');

  useEffect(() => {
    setDecision(readConsent());
  }, []);

  // Nothing configured ⇒ nothing to consent to; never show the banner, never inject a script (dev default).
  if (!config || decision === 'pending') return null;

  if (decision === 'granted') {
    return (
      <Script src={config.src} data-website-id={config.websiteId} strategy="afterInteractive" />
    );
  }

  if (decision === 'denied') return null;

  const decide = (choice: ConsentDecision) => {
    writeConsent(choice);
    setDecision(choice);
  };

  return (
    <section
      aria-label={t('title')}
      // bottom-[76px] on mobile clears the BottomNav (min-h-56px + py-2 ≈ 72px, z-40); this banner is
      // z-50 so it floats just above it. Flush to the bottom edge from md up (no bottom nav there).
      className="fixed inset-x-0 bottom-[76px] z-50 px-4 md:bottom-0 md:px-6"
    >
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-4 rounded-card border border-border-subtle bg-surface-card p-4 shadow-pop md:flex-row md:items-center md:justify-between md:p-5">
        <div className="flex flex-col gap-1">
          <p className="font-display text-base font-bold text-text-strong">{t('title')}</p>
          <p className="max-w-2xl text-sm text-text-muted">{t('body')}</p>
        </div>
        {/* size="md" = h-11 = 44px hit target (a11y rule). Accept uses `pop` (cocoa-on-sun, 7.67:1) —
            the storefront's compliant primary CTA; `variant="primary"` would be white-on-flame-500
            (2.82:1), the locked AA failure. Decline stays a clearly-visible outline button, one click. */}
        <div className="flex shrink-0 gap-3">
          <Button variant="outline" size="md" onClick={() => decide('denied')}>
            {t('decline')}
          </Button>
          <Button variant="pop" size="md" onClick={() => decide('granted')}>
            {t('accept')}
          </Button>
        </div>
      </div>
    </section>
  );
}
