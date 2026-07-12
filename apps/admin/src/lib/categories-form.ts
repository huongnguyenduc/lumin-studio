// Pure form logic for the categories page (/danh-muc, P3-o) — client validation that MIRRORS the BE
// cleanCategoryInput (a nudge; the server is the wall). Kept out of the view so it is unit-testable. slugify
// is re-exported from product-form (one shared implementation — Vietnamese diacritic fold), so the "tạo từ
// tên" button here and the product editor's stay identical.

export { slugify } from './product-form';

// Caps mirror the BE maxCategoryNameChars / maxSlugChars (admin_categories.go). Measured in code points
// (spread) so a multibyte Vietnamese name counts by character, matching the Go rune count.
export const CATEGORY_NAME_MAX = 200;
export const CATEGORY_SLUG_MAX = 200;

// The URL-safe slug shape the BE slugRe enforces: lowercase alphanumerics in dash-separated groups.
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type CategoryFieldErrors = {
  name?: 'required' | 'tooLong';
  slug?: 'required' | 'tooLong' | 'slug';
};

/**
 * Validate a category create/rename draft. Returns a per-field error code map (empty ⇒ valid) so the dialog
 * can gate submit and annotate the offending field. A duplicate slug is NOT caught here (the client can't
 * know the taxonomy) — it surfaces as the server's 400 → `validation` form error.
 */
export function validateCategoryInput(input: { name: string; slug: string }): CategoryFieldErrors {
  const errors: CategoryFieldErrors = {};
  const name = input.name.trim();
  const slug = input.slug.trim();

  if (name === '') errors.name = 'required';
  else if ([...name].length > CATEGORY_NAME_MAX) errors.name = 'tooLong';

  if (slug === '') errors.slug = 'required';
  else if ([...slug].length > CATEGORY_SLUG_MAX) errors.slug = 'tooLong';
  else if (!SLUG_RE.test(slug)) errors.slug = 'slug';

  return errors;
}
