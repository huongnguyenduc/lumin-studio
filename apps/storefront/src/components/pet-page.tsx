import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import type {
  PetContact,
  PetLostScan,
  PetPage as PetPageData,
  PetPageProfile,
  PetSpecies,
} from '@/lib/pet-page';
import { type BlockType, normalizeBlocks } from '@/lib/pet-blocks';
import { petThemeVars } from '@/lib/pet-theme';
import { FinderLocationShare } from './finder-location-share';
import { LostModeToggle } from './lost-mode-toggle';
import { PetEditor } from './pet-editor';
import { PetArrange } from './pet-arrange';
import { PetThemeSheet } from './pet-theme-sheet';

// The live pet page (spec §10 "1 URL · 3 trạng thái", P3-t t-4a/t-4b/t-4c). One URL, three view-states routed
// by viewerIsOwner + lostMode:
//   • owner (any lostMode)      → the page + lost-mode toggle + in-app scan notify (t-4b) + the owner toolbar
//                                 (t-4c: ✏️ sửa · ⠿ sắp xếp · 🎨 giao diện)
//   • stranger, lostMode=false  → 4c: read-only "at home · safe", contact masked
//   • stranger, lostMode=true   → 4a: rescue — lost banner, allergy warning, full contact + share-my-location
// Content blocks (bio · album · khoái khẩu · medical · socials) render for everyone in the OWNER'S block order,
// hidden blocks skipped (spec §10 sắp xếp khối, t-4c-2). The THEME (t-4c-2) is applied as CSS custom
// properties on the page root — but SAFETY is never themed: the lost banner, allergy warning and the emergency
// call CTA keep the system danger/primary tokens (they own solid surfaces, readable on any palette incl. Đêm
// cocoa). Masking is server-side (contact.masked). Mobile-first, one-handed, sentence-case, copy under petTag.page.*.

const SPECIES_EMOJI: Record<PetSpecies, string> = { dog: '🐶', cat: '🐱', other: '🐾' };
const WARN = '⚠️';
const CALL = '📞';
const CHAT = '💬';
const MAIL = '✉️';
const LOST_ICON = '📣';

export async function PetPage({ page }: { page: PetPageData }) {
  const t = await getTranslations('petTag.page');
  // page.tsx only renders this for an ACTIVATED tag with a profile; the cast is that invariant.
  const profile = page.profile as PetPageProfile;
  const lost = profile.lostMode;
  const isOwner = page.viewerIsOwner;
  const meta = [profile.breed, profile.age, profile.weight].filter(Boolean).join(' · ');
  const heading = lost
    ? t('lostGreeting', { name: profile.petName })
    : t('greeting', { name: profile.petName });

  const theme = petThemeVars(profile.theme);
  const blocks = normalizeBlocks(profile.blocks);
  // The content blocks to render, in the owner's order: visible ones — plus the medical block whenever the pet
  // is lost (safety overrides an owner who hid it, so the allergy warning still reaches a finder).
  const orderedBlocks = blocks.filter(
    (b) => b.type !== 'photo_name' && (b.visible || (b.type === 'medical' && lost)),
  );

  // Each content block's JSX (or null when the owner hasn't filled it) — rendered in orderedBlocks order.
  const section = (type: BlockType): ReactNode => {
    switch (type) {
      case 'bio':
        return profile.bio ? (
          <p className="text-sm leading-relaxed text-[var(--pet-ink)]">{profile.bio}</p>
        ) : null;
      case 'gallery':
        return profile.gallery && profile.gallery.length > 0 ? (
          <section>
            <h2 className="mb-2 font-display text-base font-bold text-[var(--pet-ink)]">
              {t('album')}
            </h2>
            <div className="grid grid-cols-3 gap-1.5">
              {profile.gallery.map((src, i) => (
                // Arbitrary Garage photo host → a plain <img> (matches product-detail — no next/image remotePatterns).
                <img
                  key={`${src}:${i}`}
                  src={src}
                  alt=""
                  className="aspect-square w-full rounded-xl border border-border-subtle object-cover"
                />
              ))}
            </div>
          </section>
        ) : null;
      case 'favorites':
        return profile.favorites && profile.favorites.length > 0 ? (
          <section>
            <h2 className="mb-2 font-display text-base font-bold text-[var(--pet-ink)]">
              {t('favorites')}
            </h2>
            <div className="flex flex-wrap gap-2">
              {profile.favorites.map((fav, i) => (
                <span
                  key={`${fav}:${i}`}
                  className="rounded-pill border border-[var(--pet-chip-border)] bg-[var(--pet-chip-bg)] px-3 py-1.5 text-sm text-[var(--pet-ink)]"
                >
                  {fav}
                </span>
              ))}
            </div>
          </section>
        ) : null;
      case 'medical':
        return <Medical medical={profile.medical} t={t} />;
      case 'socials':
        return profile.socials && profile.socials.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {profile.socials.map((s) => (
              <span
                key={`${s.platform}:${s.handle}`}
                className="rounded-pill border border-border-strong bg-surface-card px-3 py-1.5 text-sm text-text-strong"
              >
                {socialLabel(s.platform)} @{s.handle}
              </span>
            ))}
          </div>
        ) : null;
      default:
        return null;
    }
  };

  return (
    <main
      style={theme.root}
      className="mx-auto flex min-h-[100dvh] w-full max-w-[420px] flex-col gap-4 px-5 py-6"
    >
      {lost && (
        <div className="rounded-2xl border-2 border-border-strong bg-primary px-4 py-3 text-center text-on-primary shadow-pop">
          <p className="font-display text-lg font-extrabold">
            {LOST_ICON} {t('lostBanner')}
          </p>
          <p className="mt-0.5 font-mono text-[11px] opacity-90">{t('lostBannerEn')}</p>
        </div>
      )}

      <header className="flex flex-col items-center text-center">
        {profile.photoUrl ? (
          // Arbitrary Garage photo host → a plain <img> (matches product-detail — no next/image remotePatterns).
          <img
            src={profile.photoUrl}
            alt=""
            className="h-24 w-24 rounded-full border-2 border-border-strong object-cover shadow-pop"
          />
        ) : (
          <div
            className="flex h-24 w-24 items-center justify-center rounded-full border-2 border-border-strong bg-surface-card text-4xl shadow-pop"
            aria-hidden="true"
          >
            {SPECIES_EMOJI[profile.species]}
          </div>
        )}
        <h1
          style={{ fontFamily: theme.nameFont }}
          className="mt-3 text-2xl font-extrabold text-[var(--pet-ink)]"
        >
          {heading}
        </h1>
        <p className="mt-1 font-mono text-xs text-[var(--pet-muted)]">{`@${profile.handle}`}</p>
        {meta && <p className="mt-1 text-sm text-[var(--pet-muted)]">{meta}</p>}
        {!lost && !isOwner && (
          <span className="mt-3 rounded-pill border border-[var(--pet-chip-border)] bg-[var(--pet-chip-bg)] px-3 py-1 font-mono text-[11px] font-bold text-[var(--pet-ink)]">
            {t('homeBadge')}
          </span>
        )}
      </header>

      {isOwner && (
        <>
          <LostModeToggle shortId={page.shortId} petName={profile.petName} lostMode={lost} />
          <div className="flex flex-wrap gap-2">
            <PetEditor shortId={page.shortId} profile={profile} />
            <PetArrange shortId={page.shortId} profile={profile} />
            <PetThemeSheet shortId={page.shortId} profile={profile} />
          </div>
        </>
      )}

      {isOwner && page.recentScans && page.recentScans.length > 0 && (
        <RecentScans scans={page.recentScans} petName={profile.petName} t={t} />
      )}

      {orderedBlocks.map((b) => {
        const node = section(b.type);
        return node ? <div key={b.type}>{node}</div> : null;
      })}

      <Contact contact={profile.contact} petName={profile.petName} t={t} />

      {lost && !isOwner && <FinderLocationShare shortId={page.shortId} petName={profile.petName} />}

      <p className="mt-auto pt-4 text-center font-mono text-[11px] leading-relaxed text-[var(--pet-muted)]">
        {isOwner ? t('ownerFooter') : t('poweredBy')}
      </p>
    </main>
  );
}

// socialLabel maps a platform id to its emoji marker (falls back to a link glyph). Cosmetic only.
function socialLabel(platform: string): string {
  const p = platform.toLowerCase();
  if (p.includes('insta')) return '📸';
  if (p.includes('tiktok')) return '🎵';
  if (p.includes('face')) return '👍';
  return '🔗';
}

// Medical — the allergy warning (safety: system danger, NEVER themed) + the vaccinated/neutered/vet chips.
// Rendered as the `medical` content block; returns null when the owner set no medical data.
function Medical({
  medical,
  t,
}: {
  medical: PetPageProfile['medical'];
  t: Awaited<ReturnType<typeof getTranslations<'petTag.page'>>>;
}) {
  if (!medical) return null;
  const hasChips = medical.vaccinated || medical.neutered || medical.vetClinic;
  if (!medical.allergies && !hasChips) return null;
  return (
    <div className="flex flex-col gap-2">
      {medical.allergies && (
        <div className="flex items-start gap-2.5 rounded-xl border border-accent-flame bg-danger-soft px-3.5 py-3">
          <span aria-hidden="true" className="text-lg">
            {WARN}
          </span>
          <p className="flex-1 text-sm text-danger">
            {t('allergy', { allergy: medical.allergies })}
          </p>
        </div>
      )}
      {hasChips && (
        <div className="flex flex-wrap gap-2">
          {medical.vaccinated && <MedChip>{t('vaccinated')}</MedChip>}
          {medical.neutered && <MedChip>{t('neutered')}</MedChip>}
          {medical.vetClinic && <MedChip>{t('vetClinic', { clinic: medical.vetClinic })}</MedChip>}
        </div>
      )}
    </div>
  );
}

function MedChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-pill border border-border-subtle bg-surface-sunken px-3 py-1.5 text-xs text-text-body">
      {children}
    </span>
  );
}

// RecentScans — the owner-only in-app notify (spec §10 D4, t-4b). When a finder shared a location for this pet,
// the owner sees it here on their OWN page (a stranger never does — page.recentScans is populated by core-api
// only for the owner). Each row links to an OpenStreetMap view of where the pet was scanned. Calm teal palette
// (a found-nearby signal is hopeful, not a warning) — an owner utility, not themed. Times render in VN local
// time from the stored UTC instant.
function RecentScans({
  scans,
  petName,
  t,
}: {
  scans: PetLostScan[];
  petName: string;
  t: Awaited<ReturnType<typeof getTranslations<'petTag.page'>>>;
}) {
  const fmt = new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Ho_Chi_Minh',
  });
  return (
    <section className="rounded-2xl border-2 border-accent-teal bg-accent-teal-soft p-4">
      <p className="text-sm font-semibold text-text-strong">
        {t('scans.heading', { name: petName })}
      </p>
      <ul className="mt-2 flex flex-col gap-2">
        {scans.map((s) => (
          <li
            key={`${s.scannedAt}:${s.mapUrl}`}
            className="flex items-center justify-between gap-3 text-sm"
          >
            <span className="font-mono text-[11px] text-text-muted">
              {t('scans.scannedAt', { time: fmt.format(new Date(s.scannedAt)) })}
            </span>
            <a
              href={s.mapUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[44px] shrink-0 items-center font-semibold text-primary underline"
            >
              {t('scans.viewMap')}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

// Contact — the owner-contact card (cocoa surface, cream text). Always the brand cocoa — deliberately NOT
// themed (it's the identity anchor, and its call CTA is the emergency action → system, never a palette colour).
// When contact.masked the phone shows as the PDPL partial with NO call action (a stranger at home); otherwise
// the full number + call/zalo/email CTAs are shown. The call CTA uses bg-primary/text-on-primary (AA-safe).
function Contact({
  contact,
  petName,
  t,
}: {
  contact: PetContact;
  petName: string;
  t: Awaited<ReturnType<typeof getTranslations<'petTag.page'>>>;
}) {
  return (
    <section className="rounded-2xl border-2 border-border-strong bg-surface-brand p-4 text-on-dark shadow-pop">
      <p className="font-mono text-[10px] uppercase tracking-wide text-on-dark/70">
        {t('contactHeading', { name: petName })}
      </p>
      {contact.name && <p className="mt-1 text-sm">{contact.name}</p>}
      <p className="mt-1 font-mono text-sm text-on-dark/90">
        {contact.masked ? contact.phoneMasked : contact.phone}
      </p>

      {contact.masked ? (
        <p className="mt-2 font-mono text-[11px] leading-relaxed text-on-dark/70">
          {t('contactMaskedNote')}
        </p>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          <a
            href={`tel:${contact.phone}`}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border-2 border-border-strong bg-primary px-4 font-display font-bold text-on-primary shadow-pop"
          >
            {CALL} {t('call', { name: petName })}
          </a>
          {(contact.zalo || contact.email) && (
            <div className="flex gap-2">
              {contact.zalo && (
                <a
                  href={`https://zalo.me/${contact.zalo}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl border border-on-dark/40 px-3 text-sm text-on-dark"
                >
                  {CHAT} {t('zalo')}
                </a>
              )}
              {contact.email && (
                <a
                  href={`mailto:${contact.email}`}
                  className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl border border-on-dark/40 px-3 text-sm text-on-dark"
                >
                  {MAIL} {t('email')}
                </a>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
