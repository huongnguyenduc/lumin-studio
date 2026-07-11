import type { components } from '@lumin/api-client';

// Pure, framework-free helpers behind the print board (P3-h): the column grouping, the stage
// progression the "→ next" button follows, and the live-frame merge. No React/DOM/network here so
// this logic is unit-tested Docker-free (test/print-queue.test.ts).

export type PrintCard = components['schemas']['PrintQueueJob'];
export type PrintStage = components['schemas']['PrintStage'];

/**
 * The four kanban columns, left→right, matching the Postgres print_stage enum order core-api advances
 * through (NEED_PRINT → PRINTING → PACKING → SHIPPED). `nextStage` walks this array, so the advance
 * button always offers exactly the server's next step — no hard-coded drift from the backend enum.
 */
export const PRINT_STAGES = ['NEED_PRINT', 'PRINTING', 'PACKING', 'SHIPPED'] as const;

/** i18n key per stage under the `printQueue.stage.*` catalog — the label is rendered at the call site
 *  (always-must #3: no baked UI string), this is the pure key→stage map. */
export const STAGE_LABEL_KEY: Record<PrintStage, string> = {
  NEED_PRINT: 'needPrint',
  PRINTING: 'printing',
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

/** The stage after `stage` on the board, or null at the terminal column (SHIPPED) — drives the
 *  per-card advance button, the keyboard/AT/mobile alternative to dragging (D-P3-2). */
export function nextStage(stage: PrintStage): PrintStage | null {
  const i = PRINT_STAGES.indexOf(stage);
  return i >= 0 && i < PRINT_STAGES.length - 1 ? PRINT_STAGES[i + 1] : null;
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
