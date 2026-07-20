'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { PetPageProfile, PetSpecies } from '@/lib/pet-page';
import {
  editFormFromProfile,
  editToUpdateInput,
  validateEdit,
  type EditForm,
} from '@/lib/pet-editor-form';
import { updatePetProfile } from '@/lib/pet-actions';
import { track } from '@/lib/analytics';
import { uploadPetImage } from '@/lib/upload-pet-image';

// The owner's in-place page editor (spec §10 sửa-tại-chỗ, P3-t t-4c-1). In display mode it is just the sticky
// "✏️ Sửa trang" entry the owner sees below their page; tapping it opens a full-screen editor that mirrors the
// page with every content field editable at once (no per-row ✎ button — spec §10 "1 chạm = 1 việc"), saved by
// one "Lưu". Content only: theme + block reorder (the 🎨 + ⠿ affordances in the design) land in t-4c-2. On save
// the server re-renders via router.refresh() with the edited content. Owner-only — pet-page.tsx renders this
// only when viewerIsOwner, and the endpoint is owner-guarded server-side (the FE is a convenience, not the wall).

const EDIT = '✏️';
const CLOSE = '✕';
const REMOVE = '✕';
const ADD = '+';

export function PetEditor({ shortId, profile }: { shortId: string; profile: PetPageProfile }) {
  const t = useTranslations('petTag.page.edit');
  const router = useRouter();
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="mt-1 inline-flex min-h-[44px] items-center justify-center gap-2 rounded-2xl border-2 border-border-strong bg-accent-sun px-5 font-display font-bold text-text-strong shadow-pop"
      >
        {EDIT} {t('button')}
      </button>
    );
  }
  // Remount the panel each open so the draft starts fresh from the latest profile (post-save refresh updates it).
  return (
    <EditorPanel
      shortId={shortId}
      profile={profile}
      onClose={() => setEditing(false)}
      onSaved={() => {
        setEditing(false);
        router.refresh();
      }}
    />
  );
}

function EditorPanel({
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
  const t = useTranslations('petTag.page.edit');
  const [form, setForm] = useState<EditForm>(() => editFormFromProfile(profile));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); // an image upload is in flight

  const set = <K extends keyof EditForm>(key: K, value: EditForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  // upload a picked file → return its URL or set a friendly upload error.
  const upload = async (file: File): Promise<string | null> => {
    setUploadErr(null);
    setBusy(true);
    const res = await uploadPetImage(file);
    setBusy(false);
    if (res.ok) return res.url;
    setUploadErr(
      t(`error.upload${res.code === 'type' ? 'Type' : res.code === 'size' ? 'Size' : 'Failed'}`),
    );
    return null;
  };

  const onSave = async () => {
    const err = validateEdit(form);
    if (err) {
      setError(t(`error.${err}`));
      return;
    }
    setSaving(true);
    setError(null);
    const res = await updatePetProfile(shortId, editToUpdateInput(form));
    setSaving(false);
    if (res.ok) {
      track('pet_profile_edited');
      onSaved();
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
        {/* header bar — cancel · title · save */}
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
            className="inline-flex min-h-[40px] items-center rounded-xl bg-surface-brand px-4 font-display font-bold text-on-dark disabled:opacity-60"
          >
            {saving ? t('saving') : t('done')}
          </button>
        </div>

        <div className="flex flex-col gap-4 px-5 py-5">
          <p className="text-center font-mono text-[11px] text-text-muted">{t('hint')}</p>

          <PhotoField
            label={t('photo')}
            cta={t('changePhoto')}
            url={form.photoUrl}
            onPick={async (file) => {
              const url = await upload(file);
              if (url) set('photoUrl', url);
            }}
          />

          <TextField
            id="pet-name"
            label={t('name')}
            value={form.petName}
            onChange={(v) => set('petName', v)}
          />

          <fieldset className="flex flex-col gap-1.5">
            <legend className="font-mono text-[11px] uppercase tracking-wide text-text-muted">
              {t('species')}
            </legend>
            <div className="flex gap-2">
              {(['dog', 'cat', 'other'] as PetSpecies[]).map((sp) => (
                <button
                  key={sp}
                  type="button"
                  onClick={() => set('species', sp)}
                  aria-pressed={form.species === sp}
                  className={`min-h-[44px] flex-1 rounded-xl border-2 text-sm font-semibold ${
                    form.species === sp
                      ? 'border-border-strong bg-accent-teal-soft text-text-strong'
                      : 'border-border-subtle bg-surface-card text-text-body'
                  }`}
                >
                  {t(sp)}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="flex gap-2">
            <TextField
              id="pet-breed"
              label={t('breed')}
              value={form.breed}
              onChange={(v) => set('breed', v)}
            />
            <TextField
              id="pet-age"
              label={t('age')}
              value={form.age}
              onChange={(v) => set('age', v)}
            />
            <TextField
              id="pet-weight"
              label={t('weight')}
              value={form.weight}
              onChange={(v) => set('weight', v)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="pet-bio"
              className="font-mono text-[11px] uppercase tracking-wide text-text-muted"
            >
              {t('bio')}
            </label>
            <textarea
              id="pet-bio"
              value={form.bio}
              onChange={(e) => set('bio', e.target.value)}
              rows={3}
              placeholder={t('bioPlaceholder')}
              className="rounded-xl border-2 border-border-subtle bg-surface-card px-3 py-2 text-sm text-text-strong"
            />
          </div>

          <FavoritesField
            label={t('favorites')}
            placeholder={t('favoritePlaceholder')}
            addLabel={t('addFavorite')}
            removeLabel={t('removeFavorite')}
            items={form.favorites}
            onChange={(items) => set('favorites', items)}
          />

          <GalleryField
            label={t('album')}
            addLabel={t('addPhoto')}
            removeLabel={t('removePhoto')}
            items={form.gallery}
            onChange={(items) => set('gallery', items)}
            onPick={upload}
          />

          {/* medical */}
          <div className="flex flex-col gap-2.5 rounded-xl border-2 border-border-subtle bg-surface-card p-3">
            <span className="font-mono text-[11px] uppercase tracking-wide text-text-muted">
              {t('medical')}
            </span>
            <TextField
              id="pet-allergies"
              label={t('allergies')}
              value={form.allergies}
              onChange={(v) => set('allergies', v)}
            />
            <label className="flex min-h-[44px] items-center gap-2.5 text-sm text-text-body">
              <input
                type="checkbox"
                checked={form.vaccinated === true}
                onChange={(e) => set('vaccinated', e.target.checked ? true : null)}
                className="h-5 w-5"
              />
              {t('vaccinated')}
            </label>
            <label className="flex min-h-[44px] items-center gap-2.5 text-sm text-text-body">
              <input
                type="checkbox"
                checked={form.neutered}
                onChange={(e) => set('neutered', e.target.checked)}
                className="h-5 w-5"
              />
              {t('neutered')}
            </label>
            <TextField
              id="pet-vet"
              label={t('vetClinic')}
              value={form.vetClinic}
              onChange={(v) => set('vetClinic', v)}
            />
          </div>

          {/* socials */}
          <div className="flex gap-2">
            <TextField
              id="pet-instagram"
              label={t('instagram')}
              value={form.instagram}
              onChange={(v) => set('instagram', v)}
            />
            <TextField
              id="pet-tiktok"
              label={t('tiktok')}
              value={form.tiktok}
              onChange={(v) => set('tiktok', v)}
            />
          </div>

          {/* owner contact */}
          <div className="flex flex-col gap-2.5 rounded-xl border-2 border-border-strong bg-surface-brand p-3 text-on-dark">
            <span className="font-mono text-[11px] uppercase tracking-wide text-on-dark/70">
              {t('contact')}
            </span>
            <TextField
              id="pet-owner-name"
              label={t('ownerName')}
              value={form.ownerName}
              onChange={(v) => set('ownerName', v)}
              onDark
            />
            <TextField
              id="pet-phone"
              label={t('phone')}
              value={form.phone}
              onChange={(v) => set('phone', v)}
              inputMode="tel"
              onDark
            />
            <TextField
              id="pet-zalo"
              label={t('zalo')}
              value={form.zalo}
              onChange={(v) => set('zalo', v)}
              onDark
            />
          </div>

          {uploadErr && (
            <p role="alert" className="text-sm text-danger">
              {uploadErr}
            </p>
          )}
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

// TextField — a labeled single-line input. onDark tints it for the cocoa contact card.
function TextField({
  id,
  label,
  value,
  onChange,
  inputMode,
  onDark,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  inputMode?: 'tel';
  onDark?: boolean;
}) {
  return (
    <div className="flex flex-1 flex-col gap-1.5">
      <label
        htmlFor={id}
        className={`font-mono text-[11px] uppercase tracking-wide ${onDark ? 'text-on-dark/70' : 'text-text-muted'}`}
      >
        {label}
      </label>
      <input
        id={id}
        type="text"
        inputMode={inputMode}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`min-h-[44px] rounded-xl border-2 px-3 text-sm outline-none transition-[border-color,box-shadow] duration-150 ease-out motion-reduce:transition-none focus-visible:ring-2 ${
          onDark
            ? 'border-on-dark/30 bg-black/20 text-on-dark focus-visible:border-on-dark focus-visible:ring-on-dark/30'
            : 'border-border-subtle bg-surface-card text-text-strong focus-visible:border-primary focus-visible:ring-accent-sky/35'
        }`}
      />
    </div>
  );
}

// PhotoField — the avatar preview + a "change photo" file picker.
function PhotoField({
  label,
  cta,
  url,
  onPick,
}: {
  label: string;
  cta: string;
  url: string;
  onPick: (file: File) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      {url ? (
        // Arbitrary Garage photo host → a plain <img> (matches product-detail — no next/image remotePatterns).
        <img
          src={url}
          alt=""
          className="h-16 w-16 rounded-full border-2 border-border-strong object-cover"
        />
      ) : (
        <div
          className="h-16 w-16 rounded-full border-2 border-dashed border-border-subtle bg-surface-sunken"
          aria-hidden="true"
        />
      )}
      <div className="flex flex-col gap-1">
        <span className="font-mono text-[11px] uppercase tracking-wide text-text-muted">
          {label}
        </span>
        <label className="inline-flex min-h-[40px] w-fit cursor-pointer items-center rounded-xl border-2 border-border-strong bg-surface-card px-3 text-sm font-semibold text-text-strong">
          {cta}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onPick(file);
              e.target.value = ''; // allow re-picking the same file
            }}
          />
        </label>
      </div>
    </div>
  );
}

// FavoritesField — the "khoái khẩu" chips: type a label, add it, remove any chip. Chips are short free-text.
function FavoritesField({
  label,
  placeholder,
  addLabel,
  removeLabel,
  items,
  onChange,
}: {
  label: string;
  placeholder: string;
  addLabel: string;
  removeLabel: string;
  items: string[];
  onChange: (items: string[]) => void;
}) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const v = draft.trim();
    if (!v) return;
    onChange([...items, v]);
    setDraft('');
  };
  return (
    <div className="flex flex-col gap-2">
      <span className="font-mono text-[11px] uppercase tracking-wide text-text-muted">{label}</span>
      {items.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {items.map((fav, i) => (
            <span
              key={`${fav}:${i}`}
              className="inline-flex items-center gap-1.5 rounded-pill border border-accent-sun bg-accent-sun-soft px-3 py-1 text-sm text-text-strong"
            >
              {fav}
              <button
                type="button"
                onClick={() => onChange(items.filter((_, j) => j !== i))}
                aria-label={`${removeLabel} ${fav}`}
                className="text-text-muted"
              >
                {REMOVE}
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          placeholder={placeholder}
          aria-label={label}
          className="min-h-[44px] flex-1 rounded-xl border-2 border-border-subtle bg-surface-card px-3 text-sm text-text-strong"
        />
        <button
          type="button"
          onClick={add}
          className="inline-flex min-h-[44px] items-center gap-1 rounded-xl border-2 border-border-strong bg-surface-card px-3 text-sm font-semibold text-text-strong"
        >
          {ADD} {addLabel}
        </button>
      </div>
    </div>
  );
}

// GalleryField — the album grid: existing photos each with a remove, plus an add-photo tile that uploads.
function GalleryField({
  label,
  addLabel,
  removeLabel,
  items,
  onChange,
  onPick,
}: {
  label: string;
  addLabel: string;
  removeLabel: string;
  items: string[];
  onChange: (items: string[]) => void;
  onPick: (file: File) => Promise<string | null>;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="font-mono text-[11px] uppercase tracking-wide text-text-muted">{label}</span>
      <div className="grid grid-cols-3 gap-2">
        {items.map((src, i) => (
          <div key={`${src}:${i}`} className="relative aspect-square">
            {/* Arbitrary Garage photo host → a plain <img> (matches product-detail). */}
            <img
              src={src}
              alt=""
              className="h-full w-full rounded-xl border border-border-subtle object-cover"
            />
            <button
              type="button"
              onClick={() => onChange(items.filter((_, j) => j !== i))}
              aria-label={`${removeLabel} ${i + 1}`}
              className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full border border-border-strong bg-surface-page text-xs text-text-strong"
            >
              {REMOVE}
            </button>
          </div>
        ))}
        <label className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-border-subtle text-text-muted">
          <span className="text-2xl">{ADD}</span>
          <span className="px-1 text-center text-[10px]">{addLabel}</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              const url = await onPick(file);
              if (url) onChange([...items, url]);
            }}
          />
        </label>
      </div>
    </div>
  );
}
