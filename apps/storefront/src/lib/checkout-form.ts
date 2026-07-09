import type { components } from '@lumin/api-client';

// Pure, client-safe validation + mapping for the C1 checkout info step (/thanh-toan, P2-d). No network,
// no 'server-only' — the view (components/checkout-view.tsx) holds the raw form state and calls this to
// gate the "continue to payment" step; the payment step (P2-f) maps a ValidatedCheckout into the
// POST /orders body. Every rule below MIRRORS the server's authoritative validate() (checkout.go
// intake.validate, spec §05) so the client never rejects what the server accepts nor advances a payload
// the server would 400 on. Unit-tested (test/checkout-form.test.ts).

export type CheckoutAddress = components['schemas']['Address']; // { province, ward, street }
export type CheckoutCustomer = components['schemas']['Customer']; // { name, phone, email? }

/** Raw, editable form state — one string per input (a controlled form never holds undefined). */
export type CheckoutFormState = {
  email: string;
  name: string;
  phone: string;
  province: string;
  ward: string;
  street: string;
  note: string;
};

export const EMPTY_CHECKOUT_FORM: CheckoutFormState = {
  email: '',
  name: '',
  phone: '',
  province: '',
  ward: '',
  street: '',
  note: '',
};

/** Field → error message-key (checkout.errors.*). A code, never Vietnamese prose — the view translates. */
export type CheckoutFieldError =
  | 'nameInvalid'
  | 'phoneInvalid'
  | 'emailInvalid'
  | 'provinceRequired'
  | 'wardRequired'
  | 'streetRequired';

export type CheckoutField = 'name' | 'phone' | 'email' | 'province' | 'ward' | 'street';

export type CheckoutErrors = Partial<Record<CheckoutField, CheckoutFieldError>>;

export type ValidatedCheckout = {
  customer: CheckoutCustomer;
  shippingAddress: CheckoutAddress;
  /** Optional customer note. NOTE (contract gap for P2-f): CreateWebOrderInput has NO `note` field today
   *  — only the inbox DTO does. P2-f (the step that actually POSTs /orders) must add an additive
   *  `note?` to the web input or render this display-only. P2-d only collects it. */
  note?: string;
};

const NAME_MIN = 2;
const NAME_MAX = 60;

/** Vietnamese mobile, verbatim from the server contract (checkout.go vnPhoneRe, spec §05). */
const VN_PHONE_RE = /^(0|\+84)\d{9}$/;

/** Strip ALL whitespace so a display-spaced "0901 234 567" submits as the bare "0901234567" the server
 *  accepts: the server only TrimSpaces the ends before matching ^(0|\+84)\d{9}$, so internal spaces
 *  (which the phone placeholder invites) must be removed here, not left to 400 at submit. */
export function normalizePhone(raw: string): string {
  return raw.replace(/\s+/g, '');
}

/**
 * Validate the info form. On success returns the normalized, server-shaped payload the payment step
 * submits (email/note omitted when blank — both are optional). Province membership is NOT checked here:
 * the dropdown only offers shippable provinces, and an unshippable one surfaces as the quote's
 * `no_shipping_rule` (the view gates "continue" on a settled quote), matching the server, which checks
 * only non-emptiness at validate() and resolves shippability at fee time.
 */
export function validateCheckoutForm(
  form: CheckoutFormState,
): { ok: true; value: ValidatedCheckout } | { ok: false; errors: CheckoutErrors } {
  const errors: CheckoutErrors = {};

  const name = form.name.trim();
  // Rune count (utf8.RuneCountInString), not `name.length` — a Vietnamese name is multi-byte and its
  // UTF-16 length would over-count, wrongly rejecting a valid short name.
  const nameRunes = [...name].length;
  if (nameRunes < NAME_MIN || nameRunes > NAME_MAX) errors.name = 'nameInvalid';

  const phone = normalizePhone(form.phone);
  if (!VN_PHONE_RE.test(phone)) errors.phone = 'phoneInvalid';

  const email = form.email.trim();
  // Server's only explicit email rule is "contains @" (checkout.go); the native type="email" input adds
  // a format hint. Empty is valid — email is optional (no auto-account, plan D-P2/§P2-d note).
  if (email !== '' && !email.includes('@')) errors.email = 'emailInvalid';

  const province = form.province.trim();
  if (province === '') errors.province = 'provinceRequired';

  const ward = form.ward.trim();
  if (ward === '') errors.ward = 'wardRequired';

  const street = form.street.trim();
  if (street === '') errors.street = 'streetRequired';

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const note = form.note.trim();
  return {
    ok: true,
    value: {
      customer: { name, phone, ...(email !== '' ? { email } : {}) },
      shippingAddress: { province, ward, street },
      ...(note !== '' ? { note } : {}),
    },
  };
}
