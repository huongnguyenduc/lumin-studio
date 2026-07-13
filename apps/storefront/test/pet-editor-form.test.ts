import { describe, it, expect } from 'vitest';
import {
  editFormFromProfile,
  editToUpdateInput,
  validateEdit,
  type EditForm,
} from '../src/lib/pet-editor-form';
import type { PetPageProfile } from '../src/lib/pet-page';

// A pet page as the OWNER loads it (contact revealed — masked=false with name/phone/zalo), with content blocks.
function ownerProfile(): PetPageProfile {
  return {
    handle: 'bo.corgi',
    petName: 'Bơ',
    species: 'dog',
    breed: 'Corgi',
    age: '2 tuổi',
    bio: 'Chân ngắn, lòng dài 🧀',
    gallery: ['https://cdn/a.jpg', 'https://cdn/b.jpg'],
    favorites: ['🧀 Phô mai'],
    lostMode: false,
    medical: { allergies: 'dị ứng thịt gà', vaccinated: true },
    socials: [
      { platform: 'instagram', handle: 'bo.corgi' },
      { platform: 'tiktok', handle: 'bo.tt' },
    ],
    contact: { masked: false, phoneMasked: '+84 90 •••• 261', name: 'Mai Lê', phone: '0905552261' },
  };
}

describe('editFormFromProfile', () => {
  it('seeds every field from the owner-viewed profile', () => {
    const f = editFormFromProfile(ownerProfile());
    expect(f.petName).toBe('Bơ');
    expect(f.bio).toBe('Chân ngắn, lòng dài 🧀');
    expect(f.gallery).toHaveLength(2);
    expect(f.favorites).toEqual(['🧀 Phô mai']);
    expect(f.allergies).toBe('dị ứng thịt gà');
    expect(f.vaccinated).toBe(true);
    expect(f.phone).toBe('0905552261'); // owner view reveals the contact
    expect(f.ownerName).toBe('Mai Lê');
    expect(f.instagram).toBe('bo.corgi');
    expect(f.tiktok).toBe('bo.tt');
  });

  it('defaults the blocks a fresh (onboarded-only) profile has not filled', () => {
    const bare: PetPageProfile = {
      handle: 'miu',
      petName: 'Miu',
      species: 'cat',
      lostMode: false,
      contact: { masked: false, phoneMasked: '+84 90 •••• 000', phone: '0900000000' },
    };
    const f = editFormFromProfile(bare);
    expect(f.bio).toBe('');
    expect(f.gallery).toEqual([]);
    expect(f.favorites).toEqual([]);
    expect(f.vaccinated).toBeNull();
    expect(f.instagram).toBe('');
  });
});

describe('validateEdit', () => {
  const base = (): EditForm => editFormFromProfile(ownerProfile());
  it('accepts a valid form (no consent gate — already granted)', () => {
    expect(validateEdit(base())).toBeNull();
  });
  it('requires a pet name (1..40)', () => {
    expect(validateEdit({ ...base(), petName: '   ' })).toBe('nameRequired');
    expect(validateEdit({ ...base(), petName: 'a'.repeat(41) })).toBe('nameRequired');
    expect(validateEdit({ ...base(), petName: 'a'.repeat(40) })).toBeNull();
  });
  it('rejects a non-VN phone', () => {
    expect(validateEdit({ ...base(), phone: '12345' })).toBe('phoneInvalid');
  });
});

describe('editToUpdateInput', () => {
  it('trims, keeps content blocks, folds socials + medical', () => {
    const out = editToUpdateInput({ ...editFormFromProfile(ownerProfile()), petName: '  Bơ  ' });
    expect(out.petName).toBe('Bơ'); // trimmed
    expect(out.bio).toBe('Chân ngắn, lòng dài 🧀');
    expect(out.gallery).toEqual(['https://cdn/a.jpg', 'https://cdn/b.jpg']);
    expect(out.favorites).toEqual(['🧀 Phô mai']);
    expect(out.ownerContact.phone).toBe('0905552261');
    expect(out.socials).toEqual([
      { platform: 'instagram', handle: 'bo.corgi' },
      { platform: 'tiktok', handle: 'bo.tt' },
    ]);
    expect(out.medical).toEqual({ vaccinated: true, allergies: 'dị ứng thịt gà' });
  });

  it('drops empty optionals + blanks: no empty bio, gallery entries filtered, no socials/medical', () => {
    const f: EditForm = {
      ...editFormFromProfile(ownerProfile()),
      breed: '',
      age: '  ',
      bio: '   ',
      gallery: ['https://cdn/a.jpg', '  ', ''], // blanks filtered out
      favorites: [],
      allergies: '',
      vaccinated: null,
      neutered: false,
      vetClinic: '',
      instagram: '',
      tiktok: '',
      zalo: '',
    };
    const out = editToUpdateInput(f);
    expect(out.breed).toBeUndefined();
    expect(out.age).toBeUndefined();
    expect(out.bio).toBeUndefined(); // whitespace-only → dropped
    expect(out.gallery).toEqual(['https://cdn/a.jpg']); // blanks removed
    expect(out.favorites).toBeUndefined(); // empty → omitted
    expect(out.medical).toBeUndefined();
    expect(out.socials).toBeUndefined();
    expect(out.ownerContact.zalo).toBeUndefined();
  });
});
