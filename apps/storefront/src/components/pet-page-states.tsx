import { getTranslations } from 'next-intl/server';
import { CtaLink } from './cta-link';
import type { PetPageProfile, PetSpecies } from '@/lib/pet-page';

// Presentational (server) states for the /t/{shortId} pet page (P3-t t-3): the "new tag" welcome (2a),
// the unavailable states (not-found / not-ready / error), and the minimal ACTIVATED placeholder. All are
// zero-JS server components — the only interactive surface is the onboarding wizard (pet-onboarding.tsx).
// The FULL 3-state pet page (owner-edit / stranger-home / lost mode) lands in t-4; this placeholder is the
// honest interim. Mobile-first (one-handed), sentence-case copy, all keyed under petTag.*.

const SPECIES_EMOJI: Record<PetSpecies, string> = { dog: '🐶', cat: '🐱', other: '🐾' };
const PAW = '🐾';

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-[420px] flex-col px-5 py-10">
      {children}
    </main>
  );
}

// NewTagWelcome — 2a: a freshly-scanned ENCODED tag, viewer not signed in. Login is the only action; the
// tag auto-attaches to whoever signs in (spec §10), so we hand ?next back to /t/{shortId} to resume.
export async function NewTagWelcome({ shortId }: { shortId: string }) {
  const t = await getTranslations('petTag.welcome');
  const loginHref = `/tai-khoan/dang-nhap?next=${encodeURIComponent(`/t/${shortId}`)}`;
  return (
    <Shell>
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <span className="rounded-pill border border-accent-teal bg-accent-teal/10 px-3 py-1 font-mono text-xs font-bold text-accent-teal">
          {t('badge')}
        </span>
        <h1 className="mt-4 font-display text-3xl font-extrabold text-text-strong">
          {t('heading')}
        </h1>
        <p className="mt-3 max-w-[260px] text-sm text-text-muted">{t('intro')}</p>
        <CtaLink href={loginHref} variant="pop" className="mt-8 w-full">
          {t('loginCta')}
        </CtaLink>
      </div>
      <p className="mt-6 text-center font-mono text-[11px] leading-relaxed text-text-muted">
        {t('footnote')}
      </p>
    </Shell>
  );
}

// PetPageUnavailable — not-found (bad shortId), not-ready (UNENCODED, chip not written), or error (network).
export async function PetPageUnavailable({
  variant,
}: {
  variant: 'notFound' | 'notReady' | 'error';
}) {
  const t = await getTranslations('petTag.unavailable');
  return (
    <Shell>
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <span className="text-5xl" aria-hidden="true">
          {PAW}
        </span>
        <h1 className="mt-4 font-display text-2xl font-bold text-text-strong">
          {t(`${variant}Title`)}
        </h1>
        <p className="mt-3 max-w-[280px] text-sm text-text-muted">{t(`${variant}Body`)}</p>
        <CtaLink href="/" variant="outline" className="mt-8">
          {t('home')}
        </CtaLink>
      </div>
    </Shell>
  );
}

// PetPagePlaceholder — an ACTIVATED tag (t-3 interim). Shows the pet's public summary (no owner PII) and is
// honest that the full page is still coming. ponytail: t-4 replaces this with the real 3-state pet page.
// Photo upload is deferred to the t-4 in-place edit, so t-3 shows the species emoji, not an avatar image.
export async function PetPagePlaceholder({ profile }: { profile: PetPageProfile }) {
  const t = await getTranslations('petTag.placeholder');
  return (
    <Shell>
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <div
          className="flex h-24 w-24 items-center justify-center rounded-full border-2 border-border-subtle bg-surface-card text-4xl"
          aria-hidden="true"
        >
          {SPECIES_EMOJI[profile.species]}
        </div>
        <h1 className="mt-4 font-display text-2xl font-extrabold text-text-strong">
          {t('ready', { name: profile.petName })}
        </h1>
        <p className="mt-1 font-mono text-xs text-text-muted">{`@${profile.handle}`}</p>
        <p className="mt-5 max-w-[280px] text-sm text-text-muted">{t('building')}</p>
      </div>
      <p className="mt-6 text-center font-mono text-[11px] text-text-muted">{t('poweredBy')}</p>
    </Shell>
  );
}
