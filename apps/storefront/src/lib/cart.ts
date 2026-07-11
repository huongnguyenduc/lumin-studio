import type { components } from '@lumin/api-client';
import type { ProductDetailView } from './product-view';

/** The ADR-037 configurator selections, exactly as they go on the wire (OrderItemInput.partColors /
 *  optionChoices). A product with named parts sends one PartColorSelection per part instead of the flat
 *  colorId; a choice-option that offers choices sends one OptionChoiceSelection (text/toggle options stay
 *  in optionIds). Pure id pairs — the human labels live in the separate display snapshots on CartItem. */
type PartColorSelection = components['schemas']['PartColorSelection'];
type OptionChoiceSelection = components['schemas']['OptionChoiceSelection'];

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
  /** Selected CHOICE add-on option ids (toggle options with no enumerated choices; never the engrave
   *  text option — that's `engrave`, nor an enumerated choice-option — that's `optionChoices`). */
  optionIds: string[];
  /** Display snapshot: labels aligned to optionIds, for the summary line. */
  optionLabels: string[];
  /** ADR-037: the colour chosen per named part ({partId, colorId} pairs, wire-shaped). Empty for a flat
   *  product (which uses `colorId`). Part of the line key so two different per-part combinations stay
   *  distinct lines. */
  partColors: PartColorSelection[];
  /** Display snapshot: "{part}: {colour}" per entry, aligned to partColors, for the summary line. */
  partColorLabels: string[];
  /** ADR-037: the choice picked per enumerated choice-option ({optionId, choiceId} pairs, wire-shaped).
   *  Empty when the product has no enumerated choice-options. Part of the line key. */
  optionChoices: OptionChoiceSelection[];
  /** Display snapshot: "{option}: {choice}" per entry, aligned to optionChoices, for the summary line. */
  optionChoiceLabels: string[];
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
  'productId' | 'colorId' | 'optionIds' | 'quantity' | 'partColors' | 'optionChoices'
>;

/**
 * Deterministic configuration fingerprint. Same product + colour + (order-independent) option set +
 * per-part colours + per-option choices + engraving text ⇒ same key ⇒ the two adds merge. Every set-like
 * axis is canonically sorted so selection order never splits a line; the engraving TEXT is part of the key
 * because two differently-engraved items are genuinely different products ("An" vs "Bo" cannot share a
 * line). The two ADR-037 axes are what stop a "ghost line": {Chao:Đỏ,Đế:Trắng} and {Chao:Trắng,Đế:Đỏ}
 * are the SAME flat productId+colorId(null), so without partColors in the key they would wrongly merge.
 *
 * All ID axes (optionIds, partColors, optionChoices) are UUID-shaped and grouped BEFORE the free-text
 * engrave (kept last) so a stray `|` in engraving can never masquerade as a structured segment. ponytail:
 * this bumps the key FORMAT (two new segments) — a flat cart persisted across this deploy keeps its old
 * key (sanitizeCart preserves it) and simply won't merge with a fresh identical add until re-added; a
 * cosmetic, self-healing, pre-launch edge (money is server-priced regardless), not worth a store migration.
 */
export function cartLineKey(
  productId: string,
  colorId: string | null,
  optionIds: readonly string[],
  engraveText: string | null,
  partColors: readonly PartColorSelection[] = [],
  optionChoices: readonly OptionChoiceSelection[] = [],
): string {
  const opts = [...optionIds].sort().join(',');
  const pc = partColors
    .map((p) => `${p.partId}:${p.colorId}`)
    .sort()
    .join(',');
  const oc = optionChoices
    .map((o) => `${o.optionId}:${o.choiceId}`)
    .sort()
    .join(',');
  return `${productId}|${colorId ?? ''}|${opts}|${pc}|${oc}|${engraveText ?? ''}`;
}

/**
 * Build a CartItem from the detail page's current selection. Pure → unit-tested. Reshapes the four
 * selection axes into the wire + display shape:
 *  - flat colour (`colorId`) for a single-piece product, OR one `partColors` entry per named part (ADR-037;
 *    the flat colorId is left null for a parts product — sending both 422s ErrColorForPartsProduct);
 *  - toggle choice-options (no enumerated choices) → `optionIds`; enumerated choice-options → one
 *    `optionChoices` entry each (ErrOptionNeedsChoice path);
 *  - the FIRST text option with non-blank engraving → `engrave` (mirrors the server engraving the first
 *    text option in optionIds); a blank field yields `engrave: null` (neither charged nor shown).
 * Each configurator axis also gets a "{part}: {colour}" / "{option}: {choice}" display snapshot for the
 * cart summary line (the cart page has no product data — labels must be captured at add-time, like
 * colorName/optionLabels). Quantity starts at 1; merging bumps it (addItem). The add-to-cart gate
 * (canAddConfiguredToCart) already blocked an incomplete/over-limit selection before this runs, so this
 * does not re-validate — it only reshapes.
 */
export function buildCartItem(
  product: ProductDetailView,
  selection: {
    colorId: string | null;
    choiceIds: readonly string[];
    engraveTexts: Record<string, string>;
    /** ADR-037: {partId → colorId} for a parts product (absent/empty for a flat product). */
    partColorByPart?: Record<string, string>;
    /** ADR-037: {optionId → choiceId} for enumerated choice-options (absent/empty when none). */
    choiceByOption?: Record<string, string>;
  },
): CartItem {
  const partColorByPart = selection.partColorByPart ?? {};
  const choiceByOption = selection.choiceByOption ?? {};

  const color =
    selection.colorId !== null
      ? (product.colors.find((c) => c.id === selection.colorId) ?? null)
      : null;

  // Per-part colours (ADR-037). Iterate the product's parts (stable order) so the snapshot is
  // deterministic; skip a part the selection lacks (the gate guarantees completeness, but stay total).
  const partColors: PartColorSelection[] = [];
  const partColorLabels: string[] = [];
  for (const part of product.parts) {
    const pickedColorId = partColorByPart[part.id];
    if (pickedColorId === undefined) continue;
    const pickedColor = product.colors.find((c) => c.id === pickedColorId);
    if (pickedColor === undefined) continue;
    partColors.push({ partId: part.id, colorId: pickedColorId });
    partColorLabels.push(`${part.name}: ${pickedColor.name}`);
  }

  // Toggle choice-options → optionIds (only options with NO enumerated choices; an enumerated option is
  // picked via optionChoices, never toggled — the server 422s a toggled enumerated option).
  const toggleOptions = product.options.filter(
    (o) => o.type === 'choice' && o.choices.length === 0 && selection.choiceIds.includes(o.id),
  );
  const optionIds = toggleOptions.map((o) => o.id);
  const optionLabels = toggleOptions.map((o) => o.label);

  // Enumerated choice-options → optionChoices (ADR-037).
  const optionChoices: OptionChoiceSelection[] = [];
  const optionChoiceLabels: string[] = [];
  for (const o of product.options) {
    if (o.type !== 'choice' || o.choices.length === 0) continue;
    const pickedChoiceId = choiceByOption[o.id];
    if (pickedChoiceId === undefined) continue;
    const pickedChoice = o.choices.find((ch) => ch.id === pickedChoiceId);
    if (pickedChoice === undefined) continue;
    optionChoices.push({ optionId: o.id, choiceId: pickedChoiceId });
    optionChoiceLabels.push(`${o.label}: ${pickedChoice.label}`);
  }

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
    key: cartLineKey(
      product.id,
      color?.id ?? null,
      keyOptionIds,
      engrave?.text ?? null,
      partColors,
      optionChoices,
    ),
    productId: product.id,
    slug: product.slug,
    name: product.name,
    imageSrc: product.images[0],
    colorId: color?.id ?? null,
    colorName: color?.name ?? null,
    optionIds,
    optionLabels,
    partColors,
    partColorLabels,
    optionChoices,
    optionChoiceLabels,
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
    // ADR-037: omit-when-empty, so a flat product's request is byte-identical to before (an absent field
    // is the legacy flat shape the server already handles); a parts/choices line sends its selection.
    ...(i.partColors.length > 0 ? { partColors: i.partColors } : {}),
    ...(i.optionChoices.length > 0 ? { optionChoices: i.optionChoices } : {}),
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

/** Coerce a persisted selection array into `{[ka],[kb]}[]` of strings; a non-array, or an entry missing
 *  either string key, is dropped. Used for partColors ({partId,colorId}) and optionChoices
 *  ({optionId,choiceId}) — a cart persisted before ADR-037 lacks the field entirely → `[]`. A count
 *  mismatch with the paired label array is harmless: the summary renders fewer labels, and the WIRE uses
 *  these id pairs (the server re-validates them → 422 on anything bogus), so a tamper can't mis-price. */
function coerceSelectionPairs(raw: unknown, ka: string, kb: string): Array<Record<string, string>> {
  if (!Array.isArray(raw)) return [];
  const out: Array<Record<string, string>> = [];
  for (const v of raw) {
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (typeof o[ka] === 'string' && typeof o[kb] === 'string') {
        out.push({ [ka]: o[ka] as string, [kb]: o[kb] as string });
      }
    }
  }
  return out;
}

/** Coerce a persisted label-snapshot array (non-strings dropped, non-array → []). */
function coerceStringArray(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
}

/**
 * Coerce untrusted persisted JSON (localStorage — user-editable, and its schema may lag this code)
 * into a valid CartItem[]. Anything malformed is DROPPED rather than crashing the cart: a tampered or
 * stale entry must never throw on read. Quantities are re-clamped. The ADR-037 configurator fields are
 * coerced leniently (default []) rather than gated in the reject list, so a cart persisted BEFORE 2c
 * (a valid flat line with no partColors/optionChoices) still loads. Keeps the store's read path total.
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
      partColors: coerceSelectionPairs(o.partColors, 'partId', 'colorId') as PartColorSelection[],
      partColorLabels: coerceStringArray(o.partColorLabels),
      optionChoices: coerceSelectionPairs(
        o.optionChoices,
        'optionId',
        'choiceId',
      ) as OptionChoiceSelection[],
      optionChoiceLabels: coerceStringArray(o.optionChoiceLabels),
      engrave:
        engrave && typeof engrave.optionId === 'string' && typeof engrave.text === 'string'
          ? { optionId: engrave.optionId, text: engrave.text }
          : null,
      quantity: clampQuantity(o.quantity),
    });
  }
  return out;
}
