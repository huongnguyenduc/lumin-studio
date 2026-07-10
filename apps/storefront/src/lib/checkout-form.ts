import type { components } from '@lumin/api-client';
import { cartQuoteItems, type CartItem } from './cart';

// Pure, client-safe validation + mapping for the C1 checkout info step (/thanh-toan, P2-d). No network,
// no 'server-only' — the view (components/checkout-view.tsx) holds the raw form state and calls this to
// gate the "continue to payment" step; the payment step (P2-f) maps a ValidatedCheckout into the
// POST /orders body (buildWebOrderInput below). Every rule below MIRRORS the server's authoritative
// validate() (checkout.go intake.validate, spec §05) so the client never rejects what the server accepts
// nor advances a payload the server would 400 on. Unit-tested (test/checkout-form.test.ts).

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
  /** Optional customer note, collected on C1. CONTRACT GAP: CreateWebOrderInput has NO `note` field today
   *  (only the inbox DTO does), so P2-f neither sends it nor echoes it on the payment review (showing it
   *  there would imply it was saved). It stays here, ready to wire once the web input gains an additive
   *  `note?` and buildWebOrderInput maps it — deferred follow-up. */
  note?: string;
  /** ADR-012 dual-ack — set ONLY when the cart has engraving (the server, checkout.go:241, ignores both
   *  otherwise). Both are true whenever present: the info step cannot advance unless personalizationAckMet
   *  holds. Unlike `note`, these fields DO exist on CreateWebOrderInput today, so P2-f maps them 1:1. */
  personalizationAck?: boolean;
  engraveEchoConfirmed?: boolean;
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

/**
 * ADR-012 dual-ack gate, mirroring the server (checkout.go:241 — `anyPersonalization && both acks`). A
 * cart with engraving may advance to payment only once the shopper has BOTH acknowledged the no-return
 * policy AND confirmed the engrave content is correct. A cart with no engraving is never gated: the
 * server ignores the flags there, so the view hides the section and never sends them true.
 */
export function personalizationAckMet(
  hasPersonalization: boolean,
  personalizationAck: boolean,
  engraveEchoConfirmed: boolean,
): boolean {
  return !hasPersonalization || (personalizationAck && engraveEchoConfirmed);
}

export type CreateWebOrderInput = components['schemas']['CreateWebOrderInput'];

/**
 * Assemble the POST /orders body for a web order (P2-f). The priced fields (productId, colorId, optionIds,
 * quantity) come STRAIGHT from cartQuoteItems — the exact mapping the info step quoted — so the order can
 * never be priced differently from the total the shopper just saw (parity by construction; the server
 * re-derives every price regardless, always-must #2). Engraved lines additionally carry the content the
 * quote omits: `personalization {text, zoneId}`, where zoneId is the engrave option's id — a stable,
 * non-blank value (the server only requires zoneId non-blank; §5 leaves it free-form). Text is trimmed to
 * mirror the server's personalizationFrom (blank text ⇒ no personalization), so a tampered blank-engrave
 * line sends none, exactly as the server would treat it.
 *
 * `paymentProofUrl` is the host-pinned finalUrl from the P2-c upload (required by the contract). The
 * ADR-012 acks are forwarded 1:1 when the cart is engraved (validated carries them only then). NOTE: the
 * customer `note` is deliberately NOT sent — CreateWebOrderInput has no `note` field (only the inbox DTO
 * does) — and P2-f also doesn't echo it on the review screen, so nothing implies it was saved. Wiring it
 * is a deferred follow-up (additive `note?` on the web input); see ValidatedCheckout.note.
 */
export function buildWebOrderInput(
  validated: ValidatedCheckout,
  items: readonly CartItem[],
  paymentProofUrl: string,
): CreateWebOrderInput {
  const priced = cartQuoteItems(items);
  const orderItems = priced.map((line, i) => {
    const engrave = items[i].engrave;
    return engrave && engrave.text.trim() !== ''
      ? { ...line, personalization: { text: engrave.text, zoneId: engrave.optionId } }
      : line;
  });
  return {
    channel: 'web',
    customer: validated.customer,
    shippingAddress: validated.shippingAddress,
    items: orderItems,
    paymentProofUrl,
    ...(validated.personalizationAck !== undefined
      ? {
          personalizationAck: validated.personalizationAck,
          engraveEchoConfirmed: validated.engraveEchoConfirmed,
        }
      : {}),
  };
}
