import type { components } from '@lumin/api-client';
import { PRODUCT_STATUSES, type ProductStatus } from './products';
import { parseIntField } from './materials';

// Pure adapters for the product editor (P3-l l-1): wire ⇄ draft form state + client validation. No I/O
// (the RSC fetch is ./product-detail-fetch, the Server Actions ./product-actions), so the wire mapping,
// the money/dimension parse and the field rules are pinned by a Docker-free unit test. The client rules
// MIRROR the BE (admin_products.go cleanProductInput) — they nudge early, but the server is the wall.

type Product = components['schemas']['Product'];
type ProductInput = components['schemas']['ProductInput'];

/** The 3 print materials the BE accepts (admin_products.go TEXT+CHECK, ADR-028). First = the new-product default. */
export const MATERIALS = ['PLA', 'PETG', 'recycled-PLA'] as const;

export { PRODUCT_STATUSES };

// Numbers (basePrice, dims) live in the draft as the raw <input> text and are parsed at validate/submit —
// same discipline as the materials dialog (int-only, no client math). Enums stay their wire strings.
export interface ProductDraft {
  name: string;
  slug: string;
  description: string;
  categoryId: string;
  basePrice: string;
  dimW: string;
  dimD: string;
  dimH: string;
  material: string;
  status: ProductStatus;
}

/** One error code per invalid draft field; the view maps it to an i18n message. Empty object = valid. */
export type ProductFieldErrors = Partial<Record<keyof ProductDraft, ProductErrorCode>>;
export type ProductErrorCode =
  | 'required'
  | 'slug'
  | 'tooLong'
  | 'int'
  | 'positive'
  | 'taken'
  | 'invalid';

// Mirror admin_products.go slugRe — lowercase alphanumerics in dash-separated groups.
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_NAME = 200;
const MAX_SLUG = 200;
const MAX_DESC = 10000;

/** A blank draft for /san-pham/moi. A new product starts as a draft (owner publishes when ready) in PLA. */
export function emptyDraft(categoryId = ''): ProductDraft {
  return {
    name: '',
    slug: '',
    description: '',
    categoryId,
    basePrice: '',
    dimW: '',
    dimD: '',
    dimH: '',
    material: MATERIALS[0],
    status: 'draft',
  };
}

/** Wire Product → editable draft (numbers → their input text). */
export function draftFromProduct(p: Product): ProductDraft {
  return {
    name: p.name,
    slug: p.slug,
    description: p.description,
    categoryId: p.categoryId,
    basePrice: String(p.basePrice),
    dimW: String(p.dimensions.w),
    dimD: String(p.dimensions.d),
    dimH: String(p.dimensions.h),
    material: p.material,
    status: p.status,
  };
}

/** Client-side field rules mirroring the BE. Returns a code per invalid field; {} = valid. */
export function validateDraft(d: ProductDraft): ProductFieldErrors {
  const e: ProductFieldErrors = {};

  const name = d.name.trim();
  if (name === '') e.name = 'required';
  else if (name.length > MAX_NAME) e.name = 'tooLong';

  const slug = d.slug.trim();
  if (slug === '') e.slug = 'required';
  else if (slug.length > MAX_SLUG || !SLUG_RE.test(slug)) e.slug = 'slug';

  if (d.categoryId === '') e.categoryId = 'required';
  if (d.description.length > MAX_DESC) e.description = 'tooLong';
  if (!(MATERIALS as readonly string[]).includes(d.material)) e.material = 'invalid';

  // basePrice = non-negative int-VND; dims = positive int mm.
  if (parseIntField(d.basePrice) === null) e.basePrice = 'int';
  for (const key of ['dimW', 'dimD', 'dimH'] as const) {
    const n = parseIntField(d[key]);
    if (n === null || n <= 0) e[key] = 'positive';
  }

  return e;
}

/** Draft → wire ProductInput. Call only after validateDraft passes; the `?? 0` are type-guards, not fallbacks. */
export function draftToInput(d: ProductDraft): ProductInput {
  return {
    slug: d.slug.trim(),
    name: d.name.trim(),
    description: d.description.trim(),
    categoryId: d.categoryId,
    basePrice: parseIntField(d.basePrice) ?? 0,
    dimensions: {
      w: parseIntField(d.dimW) ?? 0,
      d: parseIntField(d.dimD) ?? 0,
      h: parseIntField(d.dimH) ?? 0,
    },
    material: d.material,
    status: d.status,
  };
}

/**
 * A URL slug suggested from the product name — so the owner never hand-types one. Folds Vietnamese
 * diacritics (NFD strips the combining marks; đ/Đ decompose to nothing under NFD, so map them first),
 * lowercases, and dash-joins the alphanumeric runs. "Đèn ngủ Mochi" → "den-ngu-mochi".
 */
export function slugify(name: string): string {
  return name
    .replace(/[đĐ]/g, 'd')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Map the BE 400 `fields` envelope (ErrorEnvelope.fields, keyed by ProductInput field) to draft-field
 * error codes. Client validation runs first and catches shape errors, so a server `slug` that survives is
 * a duplicate (→ 'taken'); `dimensions` maps onto the width cell. Unknown keys are ignored.
 */
export function serverFieldErrors(fields: Record<string, string>): ProductFieldErrors {
  const e: ProductFieldErrors = {};
  for (const key of Object.keys(fields)) {
    if (key === 'slug') e.slug = 'taken';
    else if (key === 'name') e.name = 'invalid';
    else if (key === 'categoryId') e.categoryId = 'invalid';
    else if (key === 'basePrice') e.basePrice = 'invalid';
    else if (key === 'dimensions') e.dimW = 'invalid';
    else if (key === 'material') e.material = 'invalid';
  }
  return e;
}
