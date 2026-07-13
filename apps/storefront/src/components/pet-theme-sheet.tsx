'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { PetPageProfile, PetSpecies } from '@/lib/pet-page';
import { normalizeBlocks } from '@/lib/pet-blocks';
import {
  BACKGROUND_IDS,
  NAME_FONT_IDS,
  type NameFontId,
  PALETTE_IDS,
  type PaletteId,
  paletteSwatch,
  petThemeVars,
  themeFormFrom,
  type ThemeForm,
  themeToWire,
} from '@/lib/pet-theme';
import { updatePetAppearance } from '@/lib/pet-actions';
import { uploadPetImage } from '@/lib/upload-pet-image';

// The owner's theme sheet (spec §10 §6 "Tùy chỉnh giao diện", P3-t t-4c-2) — pick one of 6 pre-built brand
// colorways (no free picker), a background (dots · plain · paper · own image with an opacity slider), and the
// name font. A live preview at the top reflects the current choice. Save sends the FULL appearance (blocks
// pass through unchanged) to the owner-guarded PATCH, then refreshes. Safety colours are never themed — the
// preview's "call" button stays the system primary to make that visible.

const CLOSE = '✕';
const CHECK = '✓';
const IMAGE = '🖼️';
const REMOVE = '🗑';

export function PetThemeSheet({ shortId, profile }: { shortId: string; profile: PetPageProfile }) {
  const t = useTranslations('petTag.page.theme');
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('button')}
        className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-2xl border-2 border-border-strong bg-surface-card px-4 text-lg shadow-pop"
      >
        🎨
      </button>
    );
  }
  return (
    <ThemePanel
      shortId={shortId}
      profile={profile}
      onClose={() => setOpen(false)}
      onSaved={() => setOpen(false)}
    />
  );
}

function ThemePanel({
  shortId,
  profile,
  onClose,
  onSaved,
}: {
  shortId: string;
  profile: PetPageProfile;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('petTag.page.theme');
  const router = useRouter();
  const [form, setForm] = useState<ThemeForm>(() => themeFormFrom(profile.theme));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof ThemeForm>(key: K, value: ThemeForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const onPickImage = async (file: File) => {
    setUploadErr(null);
    setBusy(true);
    const res = await uploadPetImage(file);
    setBusy(false);
    if (!res.ok) {
      setUploadErr(
        t(`error.upload${res.code === 'type' ? 'Type' : res.code === 'size' ? 'Size' : 'Failed'}`),
      );
      return;
    }
    setForm((f) => ({ ...f, background: 'image', bgImageUrl: res.url }));
  };

  const onSave = async () => {
    setSaving(true);
    setError(null);
    const res = await updatePetAppearance(shortId, {
      theme: themeToWire(form),
      // Blocks are unchanged here — pass them through so the full-replace write keeps the layout.
      blocks: normalizeBlocks(profile.blocks).map((b) => ({
        type: b.type,
        order: b.order,
        visible: b.visible,
      })),
    });
    setSaving(false);
    if (res.ok) {
      onSaved();
      router.refresh();
      return;
    }
    setError(
      t(
        `error.${res.code === 'forbidden' ? 'forbidden' : res.code === 'unauthenticated' ? 'session' : 'saveFailed'}`,
      ),
    );
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('title')}
      className="fixed inset-0 z-50 overflow-y-auto bg-surface-page"
    >
      <div className="mx-auto flex min-h-full w-full max-w-[420px] flex-col">
        <div className="sticky top-0 z-10 flex items-center gap-3 border-b-2 border-border-strong bg-accent-sun px-4 py-2.5">
          <button
            type="button"
            onClick={onClose}
            aria-label={t('cancel')}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center text-xl text-text-strong"
          >
            {CLOSE}
          </button>
          <span className="flex-1 font-display text-base font-bold text-text-strong">
            {t('title')}
          </span>
          <button
            type="button"
            onClick={onSave}
            disabled={saving || busy}
            className="inline-flex min-h-[44px] items-center rounded-xl bg-surface-brand px-4 font-display font-bold text-on-dark disabled:opacity-60"
          >
            {saving ? t('saving') : t('apply')}
          </button>
        </div>

        <div className="flex flex-col gap-5 px-5 py-5">
          <ThemePreview
            form={form}
            label={t('preview')}
            name={profile.petName}
            speciesEmoji={PREVIEW_SPECIES[profile.species]}
            bio={profile.bio ?? t('previewBio')}
            favorite={profile.favorites?.[0] ?? t('previewFav')}
            cta={t('previewCall')}
          />

          {/* palette */}
          <Section label={t('palette.label')}>
            <div className="grid grid-cols-3 gap-2.5">
              {PALETTE_IDS.map((id) => (
                <PaletteButton
                  key={id}
                  id={id}
                  label={t(`palette.${id}`)}
                  selected={form.palette === id}
                  onClick={() => set('palette', id)}
                />
              ))}
            </div>
          </Section>

          {/* background */}
          <Section label={t('background.label')}>
            <div className="flex flex-wrap gap-2">
              {BACKGROUND_IDS.map((id) => (
                <ChoicePill
                  key={id}
                  label={
                    id === 'image' ? `${IMAGE} ${t('background.image')}` : t(`background.${id}`)
                  }
                  selected={form.background === id}
                  onClick={() => set('background', id)}
                />
              ))}
            </div>
            {form.background === 'image' && (
              <ImageBackground
                url={form.bgImageUrl}
                opacity={form.bgOpacity}
                busy={busy}
                t={t}
                onPick={onPickImage}
                onRemove={() => setForm((f) => ({ ...f, bgImageUrl: '', background: 'plain' }))}
                onOpacity={(v) => set('bgOpacity', v)}
              />
            )}
            {uploadErr && (
              <p role="alert" className="mt-2 text-sm text-danger">
                {uploadErr}
              </p>
            )}
          </Section>

          {/* name font */}
          <Section label={t('font.label')}>
            <div className="flex gap-2">
              {NAME_FONT_IDS.map((id) => (
                <FontButton
                  key={id}
                  id={id}
                  label={t(`font.${id}`)}
                  selected={form.nameFont === id}
                  onClick={() => set('nameFont', id)}
                />
              ))}
            </div>
          </Section>

          {error && (
            <p role="alert" className="text-center text-sm text-danger">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ThemePreview — a compact live pet card in the current theme. Reuses petThemeVars so the preview and the
// real page can never drift. The call button stays system primary (safety is never themed).
function ThemePreview({
  form,
  label,
  name,
  speciesEmoji,
  bio,
  favorite,
  cta,
}: {
  form: ThemeForm;
  label: string;
  name: string;
  speciesEmoji: string;
  bio: string;
  favorite: string;
  cta: string;
}) {
  const vars = petThemeVars({
    palette: form.palette,
    background: form.background,
    bgImageUrl: form.bgImageUrl,
    bgOpacity: form.bgOpacity,
    nameFont: form.nameFont,
  });
  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-mono text-[11px] uppercase tracking-wide text-text-muted">{label}</span>
      <div
        style={vars.root}
        className="overflow-hidden rounded-2xl border-2 border-border-strong shadow-pop"
      >
        <div className="flex flex-col gap-2 p-4">
          <span
            style={{ fontFamily: vars.nameFont }}
            className="text-xl font-extrabold text-[var(--pet-ink)]"
          >
            {name} {speciesEmoji}
          </span>
          <p className="text-sm text-[var(--pet-ink)]">{bio}</p>
          <div className="mt-1 flex gap-2">
            <span className="rounded-pill border border-[var(--pet-chip-border)] bg-[var(--pet-chip-bg)] px-3 py-1 text-xs text-[var(--pet-ink)]">
              {favorite}
            </span>
          </div>
          <span className="mt-1 inline-flex min-h-[36px] items-center justify-center rounded-xl border-2 border-border-strong bg-primary px-4 text-sm font-bold text-on-primary">
            📞 {cta}
          </span>
        </div>
      </div>
    </div>
  );
}

// The species emoji shown in the live preview's sample card (mirrors pet-page's header avatar fallback).
const PREVIEW_SPECIES: Record<PetSpecies, string> = { dog: '🐶', cat: '🐱', other: '🐾' };

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      <span className="font-display text-sm font-bold text-text-strong">{label}</span>
      {children}
    </div>
  );
}

function PaletteButton({
  id,
  label,
  selected,
  onClick,
}: {
  id: PaletteId;
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  const { swatch } = paletteSwatch(id);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`relative flex min-h-[64px] flex-col items-center justify-center gap-1.5 rounded-xl border-2 bg-surface-card py-2 ${
        selected ? 'border-border-strong ring-2 ring-accent-teal' : 'border-border-default'
      }`}
    >
      {selected && (
        <span
          aria-hidden="true"
          className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-border-strong bg-accent-teal text-[11px] text-on-primary"
        >
          {CHECK}
        </span>
      )}
      <span className="flex">
        <span
          style={{ backgroundColor: swatch[0] }}
          className="h-5 w-5 rounded-full border border-border-strong"
        />
        <span
          style={{ backgroundColor: swatch[1] }}
          className="-ml-2 h-5 w-5 rounded-full border border-border-strong"
        />
      </span>
      <span className={`text-[11px] ${selected ? 'font-bold' : ''} text-text-body`}>{label}</span>
    </button>
  );
}

function ChoicePill({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`min-h-[44px] flex-1 rounded-xl border-2 px-3 text-sm font-semibold ${
        selected
          ? 'border-border-strong bg-accent-sun-soft text-text-strong'
          : 'border-border-default bg-surface-card text-text-body'
      }`}
    >
      {label}
    </button>
  );
}

function FontButton({
  id,
  label,
  selected,
  onClick,
}: {
  id: NameFontId;
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      style={{ fontFamily: id === 'mono' ? 'var(--font-space-mono)' : 'var(--font-bricolage)' }}
      className={`min-h-[44px] flex-1 rounded-xl border-2 px-3 text-base font-bold ${
        selected
          ? 'border-border-strong bg-accent-sun-soft text-text-strong'
          : 'border-border-default bg-surface-card text-text-body'
      }`}
    >
      {label}
    </button>
  );
}

// ImageBackground — the custom-image row + opacity slider, shown when background=image. The slider blends the
// image under the page (spec §10 "Độ mờ nền", default 40%). A plain <img> preview (arbitrary Garage host).
function ImageBackground({
  url,
  opacity,
  busy,
  t,
  onPick,
  onRemove,
  onOpacity,
}: {
  url: string;
  opacity: number;
  busy: boolean;
  t: ReturnType<typeof useTranslations>;
  onPick: (file: File) => void;
  onRemove: () => void;
  onOpacity: (v: number) => void;
}) {
  return (
    <div className="mt-1 flex flex-col gap-3 rounded-xl border-2 border-border-strong bg-surface-card p-3 shadow-pop">
      <div className="flex items-center gap-3">
        {url ? (
          // Arbitrary Garage photo host → a plain <img> (matches product-detail — no next/image remotePatterns).
          <img
            src={url}
            alt=""
            className="h-12 w-12 rounded-lg border border-border-strong object-cover"
          />
        ) : (
          <div
            aria-hidden="true"
            className="flex h-12 w-12 items-center justify-center rounded-lg border-2 border-dashed border-border-default text-lg text-text-subtle"
          >
            {IMAGE}
          </div>
        )}
        <label className="inline-flex min-h-[44px] cursor-pointer items-center rounded-xl border-2 border-border-strong bg-surface-card px-3 text-sm font-semibold text-text-strong">
          {busy ? t('uploading') : url ? t('changeImage') : t('addImage')}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onPick(file);
              e.target.value = '';
            }}
          />
        </label>
        {url && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={t('removeImage')}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-border-default text-sm text-danger"
          >
            {REMOVE}
          </button>
        )}
      </div>
      {url && (
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="pet-bg-opacity"
            className="flex items-center justify-between text-sm text-text-body"
          >
            <span>{t('opacity')}</span>
            <span className="rounded-lg border border-accent-sun bg-accent-sun-soft px-2 py-0.5 font-mono text-[11px] font-bold text-text-strong">
              {opacity}%
            </span>
          </label>
          <input
            id="pet-bg-opacity"
            type="range"
            min={0}
            max={100}
            value={opacity}
            onChange={(e) => onOpacity(Number(e.target.value))}
            className="h-2 w-full accent-accent-sun"
          />
          <div className="flex justify-between font-mono text-[10px] text-text-subtle">
            <span>{t('opacityFaint')}</span>
            <span>{t('opacityBold')}</span>
          </div>
        </div>
      )}
    </div>
  );
}
