import type { components } from '@lumin/api-client';
import type { ProductDetailView } from './product-view';

// The pure, serialisable cart model + its reducers and the /price/quote request mapping. Deliberately
// side-effect-free (no localStorage, no React) so every invariant here is unit-testable in the node
// vitest env (test/cart.test.ts): the store (lib/cart-store.ts) is a thin localStorage shell over these
// functions, and the cart page (components/cart-view.tsx) renders their output. `import type` only, so
// this module stays client-safe — the server-only quote action (lib/quote.ts) is never pulled in here.
//
// MONEY (conventions §Tiền / ADR-019): a CartItem carries NO price. It stores the SELECTION (product +
// colour + options + engraving) plus a display snapshot (name/image/labels) taken at add-time; every
// price shown in the cart comes from a fresh POST /price/quote (server-authoritative), never summed on
// the client. That is why the reducers never touch money — they only reshape selections and quantities.

/** Highest quantity a single line may hold. Bounds an absurd qty before it reaches the server's own
 *  overflow guard (money.CalcTotals); the stepper enforces it too. */
export const MAX_QUANTITY = 99;

/** Most distinct lines a cart may hold. Mirrors the server's maxItems:50 on /price/quote (a public,
 *  unauthenticated read whose per-request work the cap bounds) so the cart never builds a quote the
 *  backend would 400. A real made-to-order cart never approaches this. */
export const MAX_LINES = 50;

/**
 * One cart line: the customer's product choice plus a display snapshot. The `key` is a deterministic
 * fingerprint of the *configuration* (product + colour + options + engraving text) — two adds of the
 * SAME configuration merge into one line (quantities sum); a different colour/option/engraving is a
 * distinct line. Prices are never stored (see the module note); `optionLabels`/`colorName`/`engrave`
 * are a snapshot only for the summary line the cart renders.
 */
export type CartItem = {
  /** Deterministic configuration fingerprint (see cartLineKey). Stable across reloads. */
  key: string;
  /** Product UUID — the only identity the /price/quote request needs (OrderItemInput.productId). */
  productId: string;
  /** Slug for linking the line back to /san-pham/{slug}. */
  slug: string;
  /** Display snapshot: product name at add-time. */
  name: string;
  /** Display snapshot: cover image (Product.images[0]); undefined → the line shows a placeholder. */
  imageSrc?: string;
  /** Selected colour id, or null when the product has no colours / none was required. */
  colorId: string | null;
  /** Display snapshot: the selected colour's name, for the summary line. */
  colorName: string | null;
  /** Selected CHOICE add-on option ids (never the engrave text option — that's `engrave`). */
  optionIds: string[];
  /** Display snapshot: labels aligned to optionIds, for the summary line. */
  optionLabels: string[];
  /** Engraving: the text option's id + the entered text, when the customer engraved (non-blank).
   *  null = no engraving. The optionId is folded into the quote's optionIds so its priceDelta is
   *  charged; the text stays client-side until Phase-2 checkout (it does not affect the price). */
  engrave: { optionId: string; text: string } | null;
  /** Line quantity, 1..MAX_QUANTITY. */
  quantity: number;
};

/** The slice of OrderItemInput a quote needs — no personalization (engraving does not change the price;
 *  the server derives every price from productId + colorId + optionIds), so no placeholder zoneId ever
 *  goes on the wire in Phase 1 (§5: zoneId is free-form/unvalidated; it re-enters at Phase-2 checkout). */
export type QuoteItem = Pick<
  components['schemas']['OrderItemInput'],
  'productId' | 'colorId' | 'optionIds' | 'quantity'
>;

/**
 * Deterministic configuration fingerprint. Same product + colour + (order-independent) option set +
 * engraving text ⇒ same key ⇒ the two adds merge. optionIds are sorted so selection order never splits
 * a line; the engraving TEXT is part of the key because two differently-engraved items are genuinely
 * different products ("An" vs "Bo" cannot share a line).
 */
export function cartLineKey(
  productId: string,
  colorId: string | null,
  optionIds: readonly string[],
  engraveText: string | null,
): string {
  const opts = [...optionIds].sort().join(',');
  return `${productId}|${colorId ?? ''}|${opts}|${engraveText ?? ''}`;
}

/**
 * Build a CartItem from the detail page's current selection. Pure → unit-tested. Picks the selected
 * choice options (label snapshot for the summary line) and the FIRST text option that has non-blank
 * engraving (mirrors the server, which engraves the first text option in optionIds). A blank engrave
 * field yields `engrave: null` and does NOT include the text option — so it is neither charged nor
 * shown. Quantity starts at 1; merging bumps it (addItem). The add-to-cart button gate
 * (canAddToCartWithOptions) already blocked out-of-limit engraving and unpicked colours before this
 * runs, so this does not re-validate — it only reshapes.
 */
export function buildCartItem(
  product: ProductDetailView,
  selection: {
    colorId: string | null;
    choiceIds: readonly string[];
    engraveTexts: Record<string, string>;
  },
): CartItem {
  const color =
    selection.colorId !== null
      ? (product.colors.find((c) => c.id === selection.colorId) ?? null)
      : null;

  const choiceOptions = product.options.filter(
    (o) => o.type === 'choice' && selection.choiceIds.includes(o.id),
  );
  const optionIds = choiceOptions.map((o) => o.id);
  const optionLabels = choiceOptions.map((o) => o.label);

  const textOption = product.options.find(
    (o) => o.type === 'text' && (selection.engraveTexts[o.id] ?? '').trim() !== '',
  );
  const engrave = textOption
    ? { optionId: textOption.id, text: selection.engraveTexts[textOption.id] }
    : null;

  // The key spans EVERY priced/identifying axis, including the engrave option id (so an engraved and a
  // non-engraved otherwise-identical line stay distinct even before the text differs).
  const keyOptionIds = engrave ? [...optionIds, engrave.optionId] : optionIds;

  return {
    key: cartLineKey(product.id, color?.id ?? null, keyOptionIds, engrave?.text ?? null),
    productId: product.id,
    slug: product.slug,
    name: product.name,
    imageSrc: product.images[0],
    colorId: color?.id ?? null,
    colorName: color?.name ?? null,
    optionIds,
    optionLabels,
    engrave,
    quantity: 1,
  };
}

/** Clamp a quantity into 1..MAX_QUANTITY (a 0 or negative is handled by setItemQuantity as a remove). */
function clampQuantity(qty: number): number {
  if (qty < 1) return 1;
  if (qty > MAX_QUANTITY) return MAX_QUANTITY;
  return Math.floor(qty);
}

/**
 * Add a line, merging into an existing line with the same configuration key (quantities sum, clamped to
 * MAX_QUANTITY). A new configuration appends — unless the cart is already at MAX_LINES, in which case
 * the cart is returned UNCHANGED. That is a silent backstop bounding the quote fan-out: MAX_LINES (50)
 * is far beyond any real made-to-order cart, so it is not surfaced in the UI (a shopper never reaches
 * 50 distinct configured lines); merges into existing lines are always allowed. Returns a NEW array
 * (never mutates) so the external store's snapshot identity changes on every write.
 */
export function addItem(items: readonly CartItem[], item: CartItem): CartItem[] {
  const idx = items.findIndex((i) => i.key === item.key);
  if (idx === -1) {
    if (items.length >= MAX_LINES) return [...items];
    return [...items, { ...item, quantity: clampQuantity(item.quantity) }];
  }
  return items.map((i, n) =>
    n === idx ? { ...i, quantity: clampQuantity(i.quantity + item.quantity) } : i,
  );
}

/** Set a line's quantity. A quantity ≤ 0 REMOVES the line (the stepper's "decrement at 1 → remove",
 *  design 05: "GIẢM =1 → XOÁ"); otherwise it is clamped to 1..MAX_QUANTITY. New array, no mutation. */
export function setItemQuantity(items: readonly CartItem[], key: string, qty: number): CartItem[] {
  if (qty <= 0) return removeItem(items, key);
  return items.map((i) => (i.key === key ? { ...i, quantity: clampQuantity(qty) } : i));
}

/** Remove a line by key. New array, no mutation. */
export function removeItem(items: readonly CartItem[], key: string): CartItem[] {
  return items.filter((i) => i.key !== key);
}

/**
 * Map the cart to a /price/quote request, positionally aligned with `items` (the response lines come
 * back in the same order — a line carries no product ref, so the client maps back by index). optionIds
 * folds the engrave text option in so its priceDelta is charged; personalization is omitted (see the
 * QuoteItem note). colorId is omitted (undefined) when none was chosen.
 */
export function cartQuoteItems(items: readonly CartItem[]): QuoteItem[] {
  return items.map((i) => ({
    productId: i.productId,
    ...(i.colorId !== null ? { colorId: i.colorId } : {}),
    optionIds: i.engrave ? [...i.optionIds, i.engrave.optionId] : [...i.optionIds],
    quantity: i.quantity,
  }));
}

/** A stable signature of the cart's priced shape (configuration + quantity per line). The cart page
 *  re-quotes whenever this changes — a display-only edit (none exist today) would not move it. */
export function cartSignature(items: readonly CartItem[]): string {
  return items.map((i) => `${i.key}x${i.quantity}`).join(';');
}

/** Total number of physical items (Σ quantity), for a count badge / summary. */
export function cartCount(items: readonly CartItem[]): number {
  return items.reduce((n, i) => n + i.quantity, 0);
}

/**
 * Coerce untrusted persisted JSON (localStorage — user-editable, and its schema may lag this code)
 * into a valid CartItem[]. Anything malformed is DROPPED rather than crashing the cart: a tampered or
 * stale entry must never throw on read. Quantities are re-clamped. Keeps the store's read path total.
 */
export function sanitizeCart(raw: unknown): CartItem[] {
  if (!Array.isArray(raw)) return [];
  const out: CartItem[] = [];
  for (const v of raw) {
    if (!v || typeof v !== 'object') continue;
    const o = v as Record<string, unknown>;
    if (
      typeof o.key !== 'string' ||
      typeof o.productId !== 'string' ||
      typeof o.slug !== 'string' ||
      typeof o.name !== 'string' ||
      typeof o.quantity !== 'number' ||
      !Number.isFinite(o.quantity) ||
      !Array.isArray(o.optionIds) ||
      !o.optionIds.every((x) => typeof x === 'string') ||
      !Array.isArray(o.optionLabels) ||
      !o.optionLabels.every((x) => typeof x === 'string')
    ) {
      continue;
    }
    const engrave =
      o.engrave && typeof o.engrave === 'object' ? (o.engrave as Record<string, unknown>) : null;
    out.push({
      key: o.key,
      productId: o.productId,
      slug: o.slug,
      name: o.name,
      imageSrc: typeof o.imageSrc === 'string' ? o.imageSrc : undefined,
      colorId: typeof o.colorId === 'string' ? o.colorId : null,
      colorName: typeof o.colorName === 'string' ? o.colorName : null,
      optionIds: o.optionIds as string[],
      optionLabels: o.optionLabels as string[],
      engrave:
        engrave && typeof engrave.optionId === 'string' && typeof engrave.text === 'string'
          ? { optionId: engrave.optionId, text: engrave.text }
          : null,
      quantity: clampQuantity(o.quantity),
    });
  }
  return out;
}
