import type { components } from '@lumin/api-client';

// Pure, framework-free helpers behind the print board (P3-h): the column grouping, the stage
// progression the "→ next" button follows, and the live-frame merge. No React/DOM/network here so
// this logic is unit-tested Docker-free (test/print-queue.test.ts).

export type PrintCard = components['schemas']['PrintQueueJob'];
export type PrintStage = components['schemas']['PrintStage'];
export type ProductType = components['schemas']['ProductType'];

/**
 * The five kanban columns, left→right, matching the Postgres print_stage enum order core-api advances
 * through (NEED_PRINT → PRINTING → NFC_ENCODE → PACKING → SHIPPED). NFC_ENCODE ("Ghi chip NFC", P3-t
 * t-2) routes ONLY nfc_tag rings — a standard product skips it (see `stagesFor`/`nextStage`). `nextStage`
 * walks the product's own sub-sequence, so the advance button always offers exactly the server's next
 * step — no hard-coded drift from the backend enum.
 */
export const PRINT_STAGES = ['NEED_PRINT', 'PRINTING', 'NFC_ENCODE', 'PACKING', 'SHIPPED'] as const;

/** i18n key per stage under the `printQueue.stage.*` catalog — the label is rendered at the call site
 *  (always-must #3: no baked UI string), this is the pure key→stage map. */
export const STAGE_LABEL_KEY: Record<PrintStage, string> = {
  NEED_PRINT: 'needPrint',
  PRINTING: 'printing',
  NFC_ENCODE: 'nfcEncode',
  PACKING: 'packing',
  SHIPPED: 'shipped',
};

/**
 * Group the flat card list the endpoint returns into the four columns, preserving the server's order
 * within each (backend orders stage → created_at = FIFO per column). Every stage key is always present
 * (empty array when a column has none) so the board renders all four columns + their zero-states.
 */
export function groupByStage(cards: readonly PrintCard[]): Record<PrintStage, PrintCard[]> {
  const out: Record<PrintStage, PrintCard[]> = {
    NEED_PRINT: [],
    PRINTING: [],
    NFC_ENCODE: [],
    PACKING: [],
    SHIPPED: [],
  };
  for (const card of cards) {
    // A card whose stage is somehow outside the enum is dropped rather than crashing the board — the
    // backend constrains stage to the enum, so this only guards a malformed live frame.
    const col = out[card.stage];
    if (col) col.push(card);
  }
  return out;
}

/** The board columns a product actually walks. A standard product SKIPS NFC_ENCODE (nothing to encode);
 *  only an nfc_tag ring routes through it (spec §10, P3-t t-2). */
export function stagesFor(productType: ProductType): readonly PrintStage[] {
  return productType === 'nfc_tag' ? PRINT_STAGES : PRINT_STAGES.filter((s) => s !== 'NFC_ENCODE');
}

/** The stage after `stage` for a card of `productType`, or null at the terminal column (SHIPPED) —
 *  drives the per-card advance button (the keyboard/AT/mobile alternative to dragging, D-P3-2).
 *  Product-aware: a standard card advances PRINTING→PACKING, an nfc_tag card PRINTING→NFC_ENCODE→PACKING. */
export function nextStage(stage: PrintStage, productType: ProductType): PrintStage | null {
  const seq = stagesFor(productType);
  const i = seq.indexOf(stage);
  return i >= 0 && i < seq.length - 1 ? seq[i + 1] : null;
}

/**
 * Fold one card (from a live SSE frame or a PATCH response) into the list: replace the card with the
 * same id in place, or append it if unseen. Same-id replace keeps the board stable when the same
 * advance arrives twice — the PATCH response AND the SSE broadcast of that PATCH are the same card, so
 * merging is idempotent. Append covers a frame for a card this tab has not loaded yet.
 */
export function mergeCard(cards: readonly PrintCard[], card: PrintCard): PrintCard[] {
  const i = cards.findIndex((c) => c.id === card.id);
  if (i < 0) return [...cards, card];
  const next = cards.slice();
  next[i] = card;
  return next;
}
