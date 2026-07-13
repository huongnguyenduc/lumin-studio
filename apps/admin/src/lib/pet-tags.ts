import type { components } from '@lumin/api-client';
import type { BadgeTone } from '@lumin/ui';

export type AdminPetTag = components['schemas']['AdminPetTag'];
export type PetTagStatus = AdminPetTag['status']; // 'UNENCODED' | 'ENCODED' | 'ACTIVATED'

// The 3 lifecycle statuses (spec §10) in roster/filter order. The "Tất cả" chip is the null filter.
export const PET_TAG_STATUSES = ['UNENCODED', 'ENCODED', 'ACTIVATED'] as const;

export interface PetTagStatusBadgeMeta {
  /** i18n key under `petTag.status.*` — rendered at the call site, never baked here. */
  labelKey: PetTagStatus;
  tone: BadgeTone;
}

// Maps each lifecycle status to its Badge presentation (label = i18n key, tone follows the design #9
// palette): awaiting-write = coral/primary, encoded = amber/sun, activated = teal. Pure DATA so it lives
// in a .ts module (mirrors ORDER_STATUS_BADGE). Lost mode is a SEPARATE danger badge, not a status here.
export const PET_TAG_STATUS_BADGE: Record<PetTagStatus, PetTagStatusBadgeMeta> = {
  UNENCODED: { labelKey: 'UNENCODED', tone: 'primary' },
  ENCODED: { labelKey: 'ENCODED', tone: 'sun' },
  ACTIVATED: { labelKey: 'ACTIVATED', tone: 'teal' },
};

// speciesEmoji is the tiny avatar glyph for a linked pet (design #9 shows a per-species avatar). A tag with
// no pet yet (species undefined) or an unknown value falls back to the tag glyph. Decorative (aria-hidden).
export function speciesEmoji(species: AdminPetTag['species']): string {
  switch (species) {
    case 'dog':
      return '🐶';
    case 'cat':
      return '🐱';
    case 'other':
      return '🐾';
    default:
      return '🏷️';
  }
}

// filterByStatus narrows the roster to one lifecycle status; a null filter (the "Tất cả" chip) returns the
// whole list unchanged. Pure so it is unit-tested without a DOM (mirrors filterCustomers).
export function filterByStatus(tags: AdminPetTag[], status: PetTagStatus | null): AdminPetTag[] {
  if (status === null) return tags;
  return tags.filter((tag) => tag.status === status);
}

// statusCounts tallies the roster by status for the filter-chip counts — computed from the FULL list so the
// chips show live totals with no extra fetch (the roster is loaded whole, filtered in memory). `all` is the
// grand total.
export function statusCounts(tags: AdminPetTag[]): Record<'all' | PetTagStatus, number> {
  const counts: Record<'all' | PetTagStatus, number> = {
    all: tags.length,
    UNENCODED: 0,
    ENCODED: 0,
    ACTIVATED: 0,
  };
  for (const tag of tags) counts[tag.status] += 1;
  return counts;
}
