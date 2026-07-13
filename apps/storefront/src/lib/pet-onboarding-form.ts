import type { ActivateInput } from './pet-actions';
import type { PetSpecies } from './pet-page';

// Pure onboarding form model + validation for the 2-step activation wizard (P3-t t-3). Kept out of the
// component so the field rules (spec §10) and the wire-payload assembly are unit-tested. Mirrors the server
// wall (validateActivateInput) so a valid form never eats a 400 round-trip.

// vnPhoneRe mirrors packages/core CustomerSchema + the server's vnPhoneRe (0… or +84…, 9 digits).
const vnPhoneRe = /^(0|\+84)\d{9}$/;
const PET_NAME_MAX = 40;

export type OnboardingForm = {
  petName: string;
  species: PetSpecies;
  breed: string;
  age: string;
  weight: string;
  allergies: string;
  ownerName: string;
  phone: string;
  zalo: string;
  vaccinated: boolean | null; // null = chưa chọn
  neutered: boolean;
  vetClinic: string;
  instagram: string;
  tiktok: string;
  consent: boolean;
};

// emptyOnboardingForm is the wizard's initial state.
export function emptyOnboardingForm(): OnboardingForm {
  return {
    petName: '',
    species: 'dog',
    breed: '',
    age: '',
    weight: '',
    allergies: '',
    ownerName: '',
    phone: '',
    zalo: '',
    vaccinated: null,
    neutered: false,
    vetClinic: '',
    instagram: '',
    tiktok: '',
    consent: false,
  };
}

export type OnboardingError = 'nameRequired' | 'phoneInvalid' | 'consentRequired';

// validateOnboarding returns the first blocking error, or null. Only the spec-required fields gate: pet
// name (1..40), owner VN phone, and consent (PDPL point 1). Everything else is optional.
export function validateOnboarding(form: OnboardingForm): OnboardingError | null {
  const name = form.petName.trim();
  if (name.length < 1 || name.length > PET_NAME_MAX) return 'nameRequired';
  if (!vnPhoneRe.test(form.phone.trim())) return 'phoneInvalid';
  if (!form.consent) return 'consentRequired';
  return null;
}

// toActivateInput assembles the wire payload from a validated form: trims + drops empty optionals, folds
// the two social handles into socials[], packs medical (only the fields the owner touched). Call only
// after validateOnboarding passes.
export function toActivateInput(form: OnboardingForm): ActivateInput {
  const clean = (s: string): string | undefined => {
    const t = s.trim();
    return t === '' ? undefined : t;
  };

  const socials: { platform: string; handle: string }[] = [];
  const ig = clean(form.instagram);
  if (ig) socials.push({ platform: 'instagram', handle: ig });
  const tt = clean(form.tiktok);
  if (tt) socials.push({ platform: 'tiktok', handle: tt });

  const medical: NonNullable<ActivateInput['medical']> = {};
  if (form.vaccinated !== null) medical.vaccinated = form.vaccinated;
  if (form.neutered) medical.neutered = true;
  const allergies = clean(form.allergies);
  if (allergies) medical.allergies = allergies;
  const vet = clean(form.vetClinic);
  if (vet) medical.vetClinic = vet;

  const ownerName = clean(form.ownerName);
  const zalo = clean(form.zalo);

  return {
    petName: form.petName.trim(),
    species: form.species,
    ...(clean(form.breed) ? { breed: clean(form.breed) } : {}),
    ...(clean(form.age) ? { age: clean(form.age) } : {}),
    ...(clean(form.weight) ? { weight: clean(form.weight) } : {}),
    ownerContact: {
      name: ownerName ?? '',
      phone: form.phone.trim(),
      ...(zalo ? { zalo } : {}),
    },
    ...(Object.keys(medical).length ? { medical } : {}),
    ...(socials.length ? { socials } : {}),
    consent: form.consent,
  };
}
