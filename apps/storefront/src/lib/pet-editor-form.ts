import type { ProfileUpdateInput } from './pet-actions';
import type { PetPageProfile, PetSpecies } from './pet-page';

// Pure form model + validation for the in-place page editor (P3-t t-4c-1). Kept out of the component so the
// field rules (spec §10) and the wire-payload assembly are unit-tested. Mirrors the server wall
// (validateProfileUpdate) so a valid form never eats a 400 round-trip, and reuses the onboarding shape (the
// editor edits the same content onboarding first captured, plus the new blocks bio/gallery/favorites).

// vnPhoneRe mirrors packages/core CustomerSchema + the server's vnPhoneRe (0… or +84…, 9 digits).
const vnPhoneRe = /^(0|\+84)\d{9}$/;
const PET_NAME_MAX = 40;

export type EditForm = {
  petName: string;
  species: PetSpecies;
  breed: string;
  age: string;
  weight: string;
  photoUrl: string; // avatar; '' = none
  bio: string;
  gallery: string[]; // album photo URLs
  favorites: string[]; // "khoái khẩu" chip labels
  allergies: string;
  vaccinated: boolean | null; // null = chưa chọn
  neutered: boolean;
  vetClinic: string;
  ownerName: string;
  phone: string;
  zalo: string;
  instagram: string;
  tiktok: string;
};

// editFormFromProfile seeds the editor from the loaded page. The owner views the page un-masked (contact
// name/phone/zalo are revealed to the owner — t-4a), so they seed the contact fields directly. socials fold
// back to the two known handles; the editor's only siblings — onboarding + this editor — write ONLY
// instagram/tiktok, so no third social can exist to drop.
export function editFormFromProfile(p: PetPageProfile): EditForm {
  const social = (platform: string): string =>
    p.socials?.find((s) => s.platform === platform)?.handle ?? '';
  const m = p.medical;
  return {
    petName: p.petName,
    species: p.species,
    breed: p.breed ?? '',
    age: p.age ?? '',
    weight: p.weight ?? '',
    photoUrl: p.photoUrl ?? '',
    bio: p.bio ?? '',
    gallery: p.gallery ?? [],
    favorites: p.favorites ?? [],
    allergies: m?.allergies ?? '',
    vaccinated: m?.vaccinated ?? null,
    neutered: m?.neutered ?? false,
    vetClinic: m?.vetClinic ?? '',
    ownerName: p.contact.name ?? '',
    phone: p.contact.phone ?? '',
    zalo: p.contact.zalo ?? '',
    instagram: social('instagram'),
    tiktok: social('tiktok'),
  };
}

export type EditError = 'nameRequired' | 'phoneInvalid';

// validateEdit returns the first blocking error, or null. Same required gates as onboarding minus consent
// (already granted at activation): pet name (1..40) + a valid owner VN phone. Everything else is free-form.
export function validateEdit(form: EditForm): EditError | null {
  const name = form.petName.trim();
  if (name.length < 1 || name.length > PET_NAME_MAX) return 'nameRequired';
  if (!vnPhoneRe.test(form.phone.trim())) return 'phoneInvalid';
  return null;
}

// editToUpdateInput assembles the wire payload from a validated form: trims + drops empty optionals, keeps
// only non-empty gallery/favorites entries, folds the two social handles into socials[], packs the medical
// fields the owner set. Call only after validateEdit passes.
export function editToUpdateInput(form: EditForm): ProfileUpdateInput {
  const clean = (s: string): string | undefined => {
    const t = s.trim();
    return t === '' ? undefined : t;
  };

  const socials: { platform: string; handle: string }[] = [];
  const ig = clean(form.instagram);
  if (ig) socials.push({ platform: 'instagram', handle: ig });
  const tt = clean(form.tiktok);
  if (tt) socials.push({ platform: 'tiktok', handle: tt });

  const medical: NonNullable<ProfileUpdateInput['medical']> = {};
  if (form.vaccinated !== null) medical.vaccinated = form.vaccinated;
  if (form.neutered) medical.neutered = true;
  const allergies = clean(form.allergies);
  if (allergies) medical.allergies = allergies;
  const vet = clean(form.vetClinic);
  if (vet) medical.vetClinic = vet;

  const gallery = form.gallery.map((s) => s.trim()).filter((s) => s !== '');
  const favorites = form.favorites.map((s) => s.trim()).filter((s) => s !== '');
  const ownerName = clean(form.ownerName);
  const zalo = clean(form.zalo);

  return {
    petName: form.petName.trim(),
    species: form.species,
    ...(clean(form.breed) ? { breed: clean(form.breed) } : {}),
    ...(clean(form.age) ? { age: clean(form.age) } : {}),
    ...(clean(form.weight) ? { weight: clean(form.weight) } : {}),
    ...(clean(form.photoUrl) ? { photoUrl: clean(form.photoUrl) } : {}),
    ...(clean(form.bio) ? { bio: clean(form.bio) } : {}),
    ...(gallery.length ? { gallery } : {}),
    ...(favorites.length ? { favorites } : {}),
    ownerContact: {
      name: ownerName ?? '',
      phone: form.phone.trim(),
      ...(zalo ? { zalo } : {}),
    },
    ...(Object.keys(medical).length ? { medical } : {}),
    ...(socials.length ? { socials } : {}),
  };
}
