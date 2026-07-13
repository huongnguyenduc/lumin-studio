import { describe, it, expect } from 'vitest';
import {
  PET_TAG_STATUS_BADGE,
  PET_TAG_STATUSES,
  filterByStatus,
  speciesEmoji,
  statusCounts,
  type AdminPetTag,
  type PetTagStatus,
} from '../src/lib/pet-tags';

// Pins the P3-t t-5 roster helpers: the status filter, the live chip counts, the species avatar, and that
// every lifecycle status has a badge. (admin vitest include is test/** — memory lumin-admin-vitest-test-dir.)

function tag(status: PetTagStatus, extra: Partial<AdminPetTag> = {}): AdminPetTag {
  return {
    id: `id-${status}-${extra.code ?? '0'}`,
    code: '#LMN-T0001',
    status,
    url: 'https://lumin.pet/t/xxx',
    createdAt: '2026-07-01T00:00:00Z',
    ...extra,
  };
}

const roster: AdminPetTag[] = [
  tag('UNENCODED', { code: 'a' }),
  tag('ENCODED', { code: 'b', chipUid: '04:A1' }),
  tag('ENCODED', { code: 'c', chipUid: '04:B2' }),
  tag('ACTIVATED', { code: 'd', handle: 'bo', petName: 'Bơ', species: 'dog', lostMode: true }),
];

describe('filterByStatus', () => {
  it('returns the whole list for the null (Tất cả) filter', () => {
    expect(filterByStatus(roster, null)).toHaveLength(4);
  });

  it('narrows to a single status', () => {
    expect(filterByStatus(roster, 'ENCODED')).toHaveLength(2);
    expect(filterByStatus(roster, 'ACTIVATED').map((t) => t.code)).toEqual(['d']);
  });

  it('yields [] when no tag is in that status', () => {
    expect(filterByStatus([tag('UNENCODED')], 'ACTIVATED')).toEqual([]);
  });
});

describe('statusCounts', () => {
  it('tallies each status and the grand total', () => {
    expect(statusCounts(roster)).toEqual({ all: 4, UNENCODED: 1, ENCODED: 2, ACTIVATED: 1 });
  });

  it('is all-zero for an empty roster', () => {
    expect(statusCounts([])).toEqual({ all: 0, UNENCODED: 0, ENCODED: 0, ACTIVATED: 0 });
  });
});

describe('speciesEmoji', () => {
  it('maps the 3 species', () => {
    expect(speciesEmoji('dog')).toBe('🐶');
    expect(speciesEmoji('cat')).toBe('🐱');
    expect(speciesEmoji('other')).toBe('🐾');
  });

  it('falls back to the tag glyph for a pet-less tag (undefined species)', () => {
    expect(speciesEmoji(undefined)).toBe('🏷️');
  });
});

describe('PET_TAG_STATUS_BADGE', () => {
  it('has a badge for every lifecycle status, keyed to its own label', () => {
    for (const status of PET_TAG_STATUSES) {
      expect(PET_TAG_STATUS_BADGE[status]).toBeDefined();
      expect(PET_TAG_STATUS_BADGE[status].labelKey).toBe(status);
    }
  });
});
