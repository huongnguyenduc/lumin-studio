import type { components } from '@lumin/api-client';

// Pure order-form logic — mirrors the storefront's buildCartItem/validation (apps/storefront
// src/lib/cart.ts + product-view.ts) so the ADR-037 configurator rules are identical, minus the cart
// merge/keys and engraving (text options are deferred; see selectionComplete). No money math here —
// the server prices every line (always-must #2). Unit-tested.

type Product = components['schemas']['Product'];
type OrderItemInput = components['schemas']['OrderItemInput'];
type PartColorSelection = components['schemas']['PartColorSelection'];
type OptionChoiceSelection = components['schemas']['OptionChoiceSelection'];

export const PHONE_RE = /^(0|\+84)\d{9}$/;

/** One line's chosen variants. Flat product → colorId; parts product → partColorByPart. Choice-options
 *  with choices → choiceByOption; toggle choice-options (no choices) → toggleOptionIds. */
export interface Selection {
  colorId: string | null;
  partColorByPart: Record<string, string>;
  choiceByOption: Record<string, string>;
  toggleOptionIds: string[];
  quantity: number;
}

export function emptySelection(): Selection {
  return {
    colorId: null,
    partColorByPart: {},
    choiceByOption: {},
    toggleOptionIds: [],
    quantity: 1,
  };
}

/** Colours belonging to a part (parts product) vs the flat product's colours (partId null). */
export function partColors(product: Product, partId: string) {
  return product.colors.filter((c) => c.partId === partId);
}
export function flatColors(product: Product) {
  return product.colors.filter((c) => !c.partId);
}

/** Reshape a selection into the wire OrderItemInput (ADR-037): flat colorId XOR partColors; toggle
 *  options → optionIds; enumerated choice-options → optionChoices. optionIds is always present (the
 *  schema defaults it to []); the other axes are omitted when empty so a flat line stays the legacy
 *  shape the server already handles. Engraving/text options are not sent (deferred). */
export function buildOrderItem(product: Product, sel: Selection): OrderItemInput {
  const isParts = product.parts.length > 0;

  const pc: PartColorSelection[] = [];
  if (isParts) {
    for (const part of product.parts) {
      const colorId = sel.partColorByPart[part.id];
      if (colorId) pc.push({ partId: part.id, colorId });
    }
  }

  const optionIds: string[] = [];
  const optionChoices: OptionChoiceSelection[] = [];
  for (const o of product.options) {
    if (o.type !== 'choice') continue; // text options deferred
    if (o.choices.length === 0) {
      if (sel.toggleOptionIds.includes(o.id)) optionIds.push(o.id);
    } else {
      const choiceId = sel.choiceByOption[o.id];
      if (choiceId) optionChoices.push({ optionId: o.id, choiceId });
    }
  }

  const item: OrderItemInput = { productId: product.id, quantity: sel.quantity, optionIds };
  if (!isParts && sel.colorId) item.colorId = sel.colorId;
  if (pc.length > 0) item.partColors = pc;
  if (optionChoices.length > 0) item.optionChoices = optionChoices;
  return item;
}

/** True iff every required variant axis is picked with an AVAILABLE value: one colour per part (parts
 *  product) or the flat colour (if the flat product has colours), and one choice per enumerated
 *  choice-option. Mirrors canAddConfiguredToCart. Toggle options are optional; quantity must be ≥1. */
export function selectionComplete(product: Product, sel: Selection): boolean {
  if (sel.quantity < 1) return false;

  if (product.parts.length > 0) {
    for (const part of product.parts) {
      const colorId = sel.partColorByPart[part.id];
      const c = product.colors.find((x) => x.id === colorId && x.partId === part.id);
      if (!c || !c.available) return false;
    }
  } else {
    const flat = flatColors(product);
    if (flat.length > 0) {
      const c = flat.find((x) => x.id === sel.colorId);
      if (!c || !c.available) return false;
    }
  }

  for (const o of product.options) {
    if (o.type !== 'choice' || o.choices.length === 0) continue;
    // Mirror the storefront's allChoicesSelected: the pick must be a real choice of THIS option (a
    // stale id from a since-changed product fails here, not only server-side).
    const choiceId = sel.choiceByOption[o.id];
    if (!o.choices.some((ch) => ch.id === choiceId)) return false;
  }
  return true;
}

/** Strip spaces so "+84 90 …" matches the ^(0|+84)\d{9}$ pattern the server enforces. */
export function normalizePhone(phone: string): string {
  return phone.replace(/\s+/g, '');
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export interface CustomerFields {
  name: string;
  phone: string;
  email: string;
}
export type CustomerErrors = {
  name?: boolean;
  phone?: boolean;
  email?: boolean;
};
/** Mirror the server's Customer constraints: name 2–60 runes, phone ^(0|+84)\d{9}$, email optional. */
export function customerErrors(c: CustomerFields): CustomerErrors {
  const errs: CustomerErrors = {};
  const nameLen = Array.from(c.name.trim()).length;
  if (nameLen < 2 || nameLen > 60) errs.name = true;
  if (!PHONE_RE.test(normalizePhone(c.phone))) errs.phone = true;
  if (c.email.trim() !== '' && !EMAIL_RE.test(c.email.trim())) errs.email = true;
  return errs;
}

export interface AddressFields {
  province: string;
  ward: string;
  street: string;
}
export type AddressErrors = Partial<Record<keyof AddressFields, boolean>>;
/** Address is province/ward/street — no district (ADR-017); all three required non-empty. */
export function addressErrors(a: AddressFields): AddressErrors {
  const errs: AddressErrors = {};
  if (a.province.trim() === '') errs.province = true;
  if (a.ward.trim() === '') errs.ward = true;
  if (a.street.trim() === '') errs.street = true;
  return errs;
}

export function hasErrors(errs: Record<string, boolean | undefined>): boolean {
  return Object.values(errs).some(Boolean);
}
