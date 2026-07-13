import { describe, it, expect } from 'vitest';
import {
  emptyOnboardingForm,
  toActivateInput,
  validateOnboarding,
  type OnboardingForm,
} from '../src/lib/pet-onboarding-form';
import { safeNextPath } from '../src/lib/next-path';

// A valid, filled-out onboarding form (Bơ the corgi).
function filledForm(): OnboardingForm {
  return {
    ...emptyOnboardingForm(),
    petName: '  Bơ  ',
    species: 'dog',
    breed: 'Corgi',
    allergies: 'dị ứng thịt gà',
    phone: '0905552261',
    instagram: 'bo.corgi',
    vaccinated: true,
    neutered: true,
    consent: true,
  };
}

describe('validateOnboarding', () => {
  it('accepts a valid form', () => {
    expect(validateOnboarding(filledForm())).toBeNull();
  });

  it('accepts a +84 phone', () => {
    expect(validateOnboarding({ ...filledForm(), phone: '+84905552261' })).toBeNull();
  });

  it('requires a pet name (1..40)', () => {
    expect(validateOnboarding({ ...filledForm(), petName: '   ' })).toBe('nameRequired');
    expect(validateOnboarding({ ...filledForm(), petName: 'a'.repeat(41) })).toBe('nameRequired');
    expect(validateOnboarding({ ...filledForm(), petName: 'a'.repeat(40) })).toBeNull();
  });

  it('rejects a non-VN phone', () => {
    expect(validateOnboarding({ ...filledForm(), phone: '12345' })).toBe('phoneInvalid');
  });

  it('requires consent (PDPL point 1)', () => {
    expect(validateOnboarding({ ...filledForm(), consent: false })).toBe('consentRequired');
  });
});

describe('toActivateInput', () => {
  it('trims required fields, drops empty optionals, folds socials + medical', () => {
    const out = toActivateInput(filledForm());
    expect(out.petName).toBe('Bơ'); // trimmed
    expect(out.species).toBe('dog');
    expect(out.breed).toBe('Corgi');
    expect(out.age).toBeUndefined(); // empty → dropped
    expect(out.weight).toBeUndefined();
    expect(out.ownerContact.phone).toBe('0905552261');
    expect(out.consent).toBe(true);
    expect(out.socials).toEqual([{ platform: 'instagram', handle: 'bo.corgi' }]);
    expect(out.medical).toEqual({ vaccinated: true, neutered: true, allergies: 'dị ứng thịt gà' });
  });

  it('omits medical + socials entirely when nothing is filled', () => {
    const bare: OnboardingForm = {
      ...emptyOnboardingForm(),
      petName: 'Miu',
      phone: '0900000000',
      consent: true,
    };
    const out = toActivateInput(bare);
    expect(out.medical).toBeUndefined(); // vaccinated null + neutered false + no notes → no medical
    expect(out.socials).toBeUndefined();
    expect(out.ownerContact.zalo).toBeUndefined();
  });
});

describe('safeNextPath', () => {
  it('passes a same-origin absolute path', () => {
    expect(safeNextPath('/t/abc123')).toBe('/t/abc123');
  });

  it('falls back to the account hub for missing / off-origin targets', () => {
    expect(safeNextPath(null)).toBe('/tai-khoan');
    expect(safeNextPath('')).toBe('/tai-khoan');
    expect(safeNextPath('//evil.com')).toBe('/tai-khoan'); // protocol-relative
    expect(safeNextPath('/\\evil.com')).toBe('/tai-khoan'); // backslash trick
    expect(safeNextPath('https://evil.com')).toBe('/tai-khoan'); // absolute URL
    expect(safeNextPath('javascript:alert(1)')).toBe('/tai-khoan'); // scheme, not a path
  });
});
