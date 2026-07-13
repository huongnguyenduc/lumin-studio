import { getTranslations } from 'next-intl/server';
import type {
  PetContact,
  PetLostScan,
  PetPage as PetPageData,
  PetPageProfile,
  PetSpecies,
} from '@/lib/pet-page';
import { FinderLocationShare } from './finder-location-share';
import { LostModeToggle } from './lost-mode-toggle';
import { PetEditor } from './pet-editor';

// The live pet page (spec §10 "1 URL · 3 trạng thái", P3-t t-4a/t-4b/t-4c). One URL, three view-states routed
// by viewerIsOwner + lostMode:
//   • owner (any lostMode)      → the page + the lost-mode toggle + the in-app scan notify (t-4b) + the in-place
//                                 editor (t-4c: ✏️ Sửa trang → edit the content in place)
//   • stranger, lostMode=false  → 4c: read-only "at home · safe", contact masked
//   • stranger, lostMode=true   → 4a: rescue — lost banner, allergy warning, full contact + share-my-location (t-4b)
// The content blocks bio · album · khoái khẩu (t-4c) render for everyone when present. Masking is server-side:
// contact.masked is already the PDPL decision, so this component just renders what it is handed. Safety colours
// (allergy, lost banner, call CTA) use the system danger/primary tokens — never a theme (theme lands in t-4c-2).
// Mobile-first, one-handed, sentence-case, all copy under petTag.page.*.

const SPECIES_EMOJI: Record<PetSpecies, string> = { dog: '🐶', cat: '🐱', other: '🐾' };
const WARN = '⚠️';
const CALL = '📞';
const CHAT = '💬';
const MAIL = '✉️';
const LOST_ICON = '📣';

export async function PetPage({ page }: { page: PetPageData }) {
  const t = await getTranslations('petTag.page');
  // page.tsx only renders this for an ACTIVATED tag with a profile; the ! is that invariant.
  const profile = page.profile as PetPageProfile;
  const lost = profile.lostMode;
  const isOwner = page.viewerIsOwner;
  const meta = [profile.breed, profile.age, profile.weight].filter(Boolean).join(' · ');
  const heading = lost
    ? t('lostGreeting', { name: profile.petName })
    : t('greeting', { name: profile.petName });

  return (
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-[420px] flex-col gap-4 px-5 py-6">
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
        <h1 className="mt-3 font-display text-2xl font-extrabold text-text-strong">{heading}</h1>
        <p className="mt-1 font-mono text-xs text-text-muted">{`@${profile.handle}`}</p>
        {meta && <p className="mt-1 text-sm text-text-muted">{meta}</p>}
        {!lost && !isOwner && (
          <span className="mt-3 rounded-pill border border-accent-teal bg-accent-teal-soft px-3 py-1 font-mono text-[11px] font-bold text-text-strong">
            {t('homeBadge')}
          </span>
        )}
      </header>

      {isOwner && (
        <>
          <LostModeToggle shortId={page.shortId} petName={profile.petName} lostMode={lost} />
          <PetEditor shortId={page.shortId} profile={profile} />
        </>
      )}

      {isOwner && page.recentScans && page.recentScans.length > 0 && (
        <RecentScans scans={page.recentScans} petName={profile.petName} t={t} />
      )}

      {profile.bio && <p className="text-sm leading-relaxed text-text-body">{profile.bio}</p>}

      {profile.socials && profile.socials.length > 0 && (
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
      )}

      {profile.gallery && profile.gallery.length > 0 && (
        <section>
          <h2 className="mb-2 font-display text-base font-bold text-text-strong">{t('album')}</h2>
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
      )}

      {profile.favorites && profile.favorites.length > 0 && (
        <section>
          <h2 className="mb-2 font-display text-base font-bold text-text-strong">
            {t('favorites')}
          </h2>
          <div className="flex flex-wrap gap-2">
            {profile.favorites.map((fav, i) => (
              <span
                key={`${fav}:${i}`}
                className="rounded-pill border border-accent-sun bg-accent-sun-soft px-3 py-1.5 text-sm text-text-strong"
              >
                {fav}
              </span>
            ))}
          </div>
        </section>
      )}

      {profile.medical?.allergies && (
        <div className="flex items-start gap-2.5 rounded-xl border border-accent-flame bg-danger-soft px-3.5 py-3">
          <span aria-hidden="true" className="text-lg">
            {WARN}
          </span>
          <p className="flex-1 text-sm text-danger">
            {t('allergy', { allergy: profile.medical.allergies })}
          </p>
        </div>
      )}

      {(profile.medical?.vaccinated || profile.medical?.neutered || profile.medical?.vetClinic) && (
        <div className="flex flex-wrap gap-2">
          {profile.medical.vaccinated && <MedChip>{t('vaccinated')}</MedChip>}
          {profile.medical.neutered && <MedChip>{t('neutered')}</MedChip>}
          {profile.medical.vetClinic && (
            <MedChip>{t('vetClinic', { clinic: profile.medical.vetClinic })}</MedChip>
          )}
        </div>
      )}

      <Contact contact={profile.contact} petName={profile.petName} t={t} />

      {lost && !isOwner && <FinderLocationShare shortId={page.shortId} petName={profile.petName} />}

      <p className="mt-auto pt-4 text-center font-mono text-[11px] leading-relaxed text-text-muted">
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
// (a found-nearby signal is hopeful, not a warning); the map link is the flame primary action. Times render in
// VN local time (the shop's locale) from the stored UTC instant.
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

// Contact — the owner-contact card (cocoa surface, cream text). When contact.masked the phone shows as the
// PDPL partial with NO call action (a stranger at home); otherwise the full number + call/zalo/email CTAs are
// shown. The call CTA uses bg-primary/text-on-primary (AA-safe, 5.12:1) — never white-on-teal (fails AA).
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
