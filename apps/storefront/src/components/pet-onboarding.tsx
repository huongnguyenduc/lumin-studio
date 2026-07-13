'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Checkbox, Input, cn } from '@lumin/ui';
import { CtaLink } from './cta-link';
import {
  emptyOnboardingForm,
  toActivateInput,
  validateOnboarding,
  type OnboardingForm,
} from '@/lib/pet-onboarding-form';
import { activatePetTag } from '@/lib/pet-actions';
import { track } from '@/lib/analytics';
import type { PetSpecies } from '@/lib/pet-page';

// The 2-step activation onboarding wizard (spec §10 steps 2b/2c, P3-t t-3). Rendered on /t/{shortId} when a
// signed-in customer scans an ENCODED tag. Step 1 = pet profile, step 2 = owner contact + medical + social
// + the PDPL consent gate (point 1). On submit it calls the activatePetTag Server Action (which attaches
// the tag, creates the profile, records consent, flips → ACTIVATED) and shows the 2d done screen. The pure
// field rules + payload assembly live in pet-onboarding-form.ts (unit-tested); this file is only UI + flow.
// Photo/gallery/theme are deferred to the t-4 in-place edit (optional per spec — keeps onboarding lean).

type WizardError = ReturnType<typeof validateOnboarding> | 'saveFailed' | 'conflict' | 'session';

const SPECIES: readonly PetSpecies[] = ['dog', 'cat', 'other'];

export function PetOnboarding({ shortId }: { shortId: string }) {
  const t = useTranslations('petTag.onboarding');
  const [form, setForm] = useState<OnboardingForm>(emptyOnboardingForm);
  const [step, setStep] = useState<1 | 2>(1);
  const [error, setError] = useState<WizardError>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  const set = <K extends keyof OnboardingForm>(key: K, value: OnboardingForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  if (done) return <DoneScreen shortId={shortId} petName={form.petName.trim()} />;

  const goStep2 = () => {
    // Pre-check step 1's one required field so the user doesn't reach step 2 then bounce back.
    if (form.petName.trim().length < 1) {
      setError('nameRequired');
      return;
    }
    setError(null);
    setStep(2);
  };

  const submit = async () => {
    const invalid = validateOnboarding(form);
    if (invalid) {
      // A phone/consent problem lives on step 2 — jump there so the user sees the flagged field.
      setError(invalid);
      if (invalid !== 'nameRequired') setStep(2);
      return;
    }
    setError(null);
    setPending(true);
    const res = await activatePetTag(shortId, toActivateInput(form));
    setPending(false);
    if (res.ok) {
      track('pet_activated');
      setDone(true);
      return;
    }
    setError(
      res.code === 'conflict'
        ? 'conflict'
        : res.code === 'unauthenticated'
          ? 'session'
          : 'saveFailed',
    );
  };

  return (
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-[440px] flex-col px-5 pb-6 pt-8">
      <header>
        <div className="flex items-baseline justify-between">
          <h1 className="font-display text-2xl font-bold text-text-strong">{t('title')}</h1>
          <span className="font-mono text-xs text-text-muted">
            {t('step', { current: step, total: 2 })}
          </span>
        </div>
        <div className="mt-3 flex gap-1.5" aria-hidden="true">
          <div className="h-1.5 flex-1 rounded-pill bg-accent-flame" />
          <div
            className={cn(
              'h-1.5 flex-1 rounded-pill',
              step === 2 ? 'bg-accent-flame' : 'bg-border-subtle',
            )}
          />
        </div>
      </header>

      <div className="mt-6 flex flex-1 flex-col gap-5">
        {step === 1 ? (
          <Step1 t={t} form={form} set={set} species={form.species} />
        ) : (
          <Step2 t={t} form={form} set={set} />
        )}
      </div>

      {error ? (
        <p role="alert" className="mt-4 text-sm text-danger">
          {t(`error.${error}`)}
        </p>
      ) : null}

      <footer className="mt-6 flex gap-3">
        {step === 2 ? (
          <Button type="button" variant="outline" onClick={() => setStep(1)} disabled={pending}>
            {t('step2.back')}
          </Button>
        ) : null}
        {step === 1 ? (
          <Button type="button" variant="pop" className="flex-1" onClick={goStep2}>
            {t('step1.next')}
          </Button>
        ) : (
          <Button
            type="button"
            variant="pop"
            className="flex-1"
            onClick={submit}
            disabled={pending}
            aria-busy={pending}
          >
            {t('step2.submit')}
          </Button>
        )}
      </footer>
    </main>
  );
}

type StepProps = {
  t: ReturnType<typeof useTranslations>;
  form: OnboardingForm;
  set: <K extends keyof OnboardingForm>(key: K, value: OnboardingForm[K]) => void;
};

function Step1({ t, form, set, species }: StepProps & { species: PetSpecies }) {
  return (
    <>
      <Input
        label={t('step1.name')}
        placeholder={t('step1.namePlaceholder')}
        value={form.petName}
        onChange={(e) => set('petName', e.target.value)}
        maxLength={40}
      />
      <fieldset>
        <legend className="mb-2 text-sm text-text-strong">{t('step1.species')}</legend>
        <div className="flex gap-2">
          {SPECIES.map((s) => (
            <Chip key={s} selected={species === s} onClick={() => set('species', s)}>
              {t(`step1.${s}`)}
            </Chip>
          ))}
        </div>
      </fieldset>
      <div className="flex gap-3">
        <Input
          label={t('step1.breed')}
          value={form.breed}
          onChange={(e) => set('breed', e.target.value)}
        />
        <Input
          label={t('step1.age')}
          value={form.age}
          onChange={(e) => set('age', e.target.value)}
          className="w-24"
        />
        <Input
          label={t('step1.weight')}
          value={form.weight}
          onChange={(e) => set('weight', e.target.value)}
          className="w-24"
        />
      </div>
      <Input
        label={t('step1.allergies')}
        placeholder={t('step1.allergiesPlaceholder')}
        value={form.allergies}
        onChange={(e) => set('allergies', e.target.value)}
      />
    </>
  );
}

function Step2({ t, form, set }: StepProps) {
  return (
    <>
      <section className="flex flex-col gap-3">
        <SectionTitle>
          {t('step2.contact')}
          <span className="ml-2 rounded-pill border border-accent-flame px-2 py-0.5 font-mono text-[10px] font-normal text-accent-flame">
            {t('step2.contactHint')}
          </span>
        </SectionTitle>
        <Input
          label={t('step2.ownerName')}
          value={form.ownerName}
          onChange={(e) => set('ownerName', e.target.value)}
        />
        <div className="flex gap-3">
          <Input
            label={t('step2.phone')}
            value={form.phone}
            onChange={(e) => set('phone', e.target.value)}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
          />
          <Input
            label={t('step2.zalo')}
            value={form.zalo}
            onChange={(e) => set('zalo', e.target.value)}
            className="w-28"
          />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <SectionTitle>{t('step2.medical')}</SectionTitle>
        <div className="flex gap-2">
          <Chip selected={form.vaccinated === true} onClick={() => set('vaccinated', true)}>
            {t('step2.vaccinated')}
          </Chip>
          <Chip selected={form.vaccinated === null} onClick={() => set('vaccinated', null)}>
            {t('step2.vaccinatedUnknown')}
          </Chip>
        </div>
        <Checkbox
          label={t('step2.neutered')}
          checked={form.neutered}
          onChange={(e) => set('neutered', e.target.checked)}
        />
        <Input
          label={t('step2.vetClinic')}
          hint={t('step2.optional')}
          value={form.vetClinic}
          onChange={(e) => set('vetClinic', e.target.value)}
        />
      </section>

      <section className="flex flex-col gap-3">
        <SectionTitle>
          {t('step2.social')}
          <span className="ml-2 font-mono text-[11px] font-normal text-text-muted">
            {t('step2.optional')}
          </span>
        </SectionTitle>
        <Input
          label={t('step2.instagram')}
          hint={t('step2.socialHint')}
          value={form.instagram}
          onChange={(e) => set('instagram', e.target.value)}
        />
        <Input
          label={t('step2.tiktok')}
          value={form.tiktok}
          onChange={(e) => set('tiktok', e.target.value)}
        />
      </section>

      {/* PDPL consent point 1 — pet + owner PII. Required: submit is blocked until it's checked. */}
      <section className="rounded-card border border-border-subtle bg-surface-card p-4">
        <Checkbox
          label={t('consent.label')}
          checked={form.consent}
          onChange={(e) => set('consent', e.target.checked)}
        />
        <p className="mt-2 text-xs leading-relaxed text-text-muted">{t('consent.notice')}</p>
      </section>
    </>
  );
}

function DoneScreen({ shortId, petName }: { shortId: string; petName: string }) {
  const t = useTranslations('petTag.onboarding.done');
  return (
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-[440px] flex-col items-center justify-center px-5 py-10 text-center">
      <span className="text-6xl" aria-hidden="true">
        {'🎉'}
      </span>
      <h1 className="mt-4 font-display text-2xl font-extrabold text-text-strong">
        {t('title', { name: petName })}
      </h1>
      <p className="mt-3 max-w-[280px] text-sm text-text-muted">{t('body')}</p>
      <CtaLink href={`/t/${shortId}`} variant="pop" className="mt-8 w-full">
        {t('view', { name: petName })}
      </CtaLink>
    </main>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="flex items-center font-display text-base font-bold text-text-strong">
      {children}
    </h2>
  );
}

function Chip({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        'min-h-[44px] rounded-pill border-2 px-4 text-sm font-medium transition-colors',
        selected
          ? 'border-border-strong bg-primary text-on-primary'
          : 'border-border-subtle bg-surface-card text-text-muted',
      )}
    >
      {children}
    </button>
  );
}
