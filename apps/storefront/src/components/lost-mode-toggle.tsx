'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { cn } from '@lumin/ui';
import { toggleLostMode } from '@/lib/pet-actions';

// The owner's lost-mode switch on /t/{shortId} (spec §10 công tắc thất lạc, P3-t t-4a). Rendered only for the
// owner (page.viewerIsOwner). The WHOLE card is one role="switch" button so the hit target is comfortably
// ≥44px for one-handed mobile (conventions §A11y), not a tiny 24px toggle. "On" is a SAFETY/alert state, so it
// uses the flame/danger palette (never teal) — the spec keeps the warning colours for lost mode. Optimistic:
// the visual flips immediately, reverts on error; on success router.refresh() re-renders the server page in
// the new view-state (the masked → callable contact reveal happens server-side).

const HOME_ICON = '🏠';
const LOST_ICON = '📣';

export function LostModeToggle({
  shortId,
  petName,
  lostMode,
}: {
  shortId: string;
  petName: string;
  lostMode: boolean;
}) {
  const t = useTranslations('petTag.page.toggle');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [on, setOn] = useState(lostMode); // optimistic; converges with the prop after router.refresh()
  const [error, setError] = useState(false);

  const onToggle = () => {
    if (pending) return;
    const next = !on;
    setError(false);
    setOn(next);
    startTransition(async () => {
      const res = await toggleLostMode(shortId, next);
      if (!res.ok) {
        setOn(!next); // revert the optimistic flip
        setError(true);
        return;
      }
      router.refresh(); // server re-renders → view-state + contact reveal follow lostMode
    });
  };

  return (
    <div
      className={cn(
        'rounded-2xl border-2 border-border-strong bg-surface-card p-3 shadow-pop',
        on && 'border-primary',
      )}
    >
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={t('ariaLabel')}
        disabled={pending}
        onClick={onToggle}
        className={cn(
          'flex min-h-[44px] w-full items-center gap-3 text-left',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2',
          pending && 'opacity-70',
        )}
      >
        <span aria-hidden="true" className="text-xl">
          {on ? LOST_ICON : HOME_ICON}
        </span>
        <span className="flex-1">
          <span className="flex items-center gap-2">
            <span className="text-sm font-semibold text-text-strong">{t('title')}</span>
            <span
              className={cn(
                'rounded-pill border px-2 py-0.5 font-mono text-[10px] font-bold',
                on
                  ? 'border-primary bg-danger-soft text-danger'
                  : 'border-accent-teal bg-accent-teal-soft text-text-strong',
              )}
            >
              {on ? t('on') : t('off')}
            </span>
          </span>
          <span className="mt-0.5 block font-mono text-[11px] text-text-muted">
            {on ? t('lostSub') : t('safeSub', { name: petName })}
          </span>
        </span>
        {/* Visual switch — decorative (the button above is the control). Flame track when on (safety alert). */}
        <span
          aria-hidden="true"
          className={cn(
            'relative h-7 w-12 shrink-0 rounded-pill border transition-colors duration-150 motion-reduce:transition-none',
            on ? 'border-primary bg-accent-flame' : 'border-border-default bg-surface-sunken',
          )}
        >
          <span
            className={cn(
              'absolute top-0.5 h-5 w-5 rounded-full bg-surface-card shadow-sm transition-transform duration-150 motion-reduce:transition-none',
              on ? 'translate-x-6' : 'translate-x-0.5',
            )}
          />
        </span>
      </button>
      <p
        className={cn(
          'mt-2 border-t border-dashed border-border-subtle pt-2 font-mono text-[11px] leading-relaxed',
          on ? 'text-danger' : 'text-text-muted',
        )}
      >
        {on ? t('lostHint') : t('hint')}
      </p>
      {error && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {t('error')}
        </p>
      )}
    </div>
  );
}
