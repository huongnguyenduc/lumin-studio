import type { components } from '@lumin/api-client';
import type { BadgeTone } from '@lumin/ui';

// Pure wire→view adapters + derivations for the Vật tư & chi phí screen (ADR-039, admin design
// screen 8). No I/O — the server-side reads live in ./materials-fetch (it imports next/headers and is
// not importable here), so every derivation below is pinned by a Docker-free unit test. Money stays
// raw int-VND / raw rates on the wire; formatVnd/formatVnNumber format at render (always-must #2 — no
// number is baked into a string here).

type FilamentMaterial = components['schemas']['FilamentMaterial'];
type Machine = components['schemas']['Machine'];
type AuxCost = components['schemas']['AuxCost'];

/** The four tabs, in display order (design screen 8: Filament · Giờ máy · Chi phí phụ · Hao hụt). */
export const COSTING_TABS = ['filament', 'machine', 'aux', 'waste'] as const;
export type CostingTab = (typeof COSTING_TABS)[number];

// ── Filament ──────────────────────────────────────────────────────────────────────────────────────

/** đủ (ok) · sắp hết (low) · theo dõi (track). */
export type FilamentStatus = 'ok' | 'low' | 'track';

/** Badge hue per status: đủ = teal (healthy), sắp hết = danger (below the low-stock line), theo dõi =
 *  sun (no threshold configured → we can't warn, only watch). Labels are i18n keys, never baked here. */
export const FILAMENT_STATUS_TONE: Record<FilamentStatus, BadgeTone> = {
  ok: 'teal',
  low: 'danger',
  track: 'sun',
};

/** A material with no low-stock threshold set (0) can't be judged low → "theo dõi"; otherwise it's
 *  "sắp hết" at or below the line, else "đủ". Stock/threshold are unit qty (grams/ml), never money. */
export function filamentStatus(
  m: Pick<FilamentMaterial, 'stockQty' | 'lowStockThreshold'>,
): FilamentStatus {
  if (m.lowStockThreshold <= 0) return 'track';
  return m.stockQty <= m.lowStockThreshold ? 'low' : 'ok';
}

export interface FilamentRow {
  id: string;
  name: string;
  material: string;
  unit: string;
  hex?: string | null;
  /** Weighted-avg ₫/unit (derived rate). 0 = no imports yet → the view shows "—", not "0₫". */
  avgCostPerUnit: number;
  stockQty: number;
  status: FilamentStatus;
}

/** Wire materials → table rows (+ derived status). A nil/empty list yields []. */
export function filamentRows(list: FilamentMaterial[]): FilamentRow[] {
  return list.map((m) => ({
    id: m.id,
    name: m.name,
    material: m.material,
    unit: m.unit,
    hex: m.hex,
    avgCostPerUnit: m.avgCostPerUnit,
    stockQty: m.stockQty,
    status: filamentStatus(m),
  }));
}

/** Total gram-unit stock for the "tồn filament" KPI. ml materials (resin) can't be summed into a gram
 *  figure, so they're excluded — the roll-up is filament-in-grams (ponytail: mixed units don't add). */
export function filamentStockGrams(list: FilamentMaterial[]): number {
  return list.filter((m) => m.unit === 'gram').reduce((sum, m) => sum + m.stockQty, 0);
}

/** Materials at/below their low-stock line — drives the KPI "● N màu sắp hết" sub-line. */
export function lowStockCount(list: FilamentMaterial[]): number {
  return list.filter((m) => filamentStatus(m) === 'low').length;
}

/** Compact unit symbol for inline display: gram → "g", anything else (ml) as-is. The wire `unit` is
 *  the full word ("gram"/"ml"); the table shows "412₫/g" / "2.340g" like the design, not "/gram". */
export function unitSymbol(unit: string): string {
  return unit === 'gram' ? 'g' : unit;
}

// ── Machines ──────────────────────────────────────────────────────────────────────────────────────

/** The active primary machine drives the calc panel (tab 2). Machines arrive primary-first (openapi),
 *  but pick explicitly. null = none set → the panel shows the "chưa đặt máy chính" empty state.
 *  ponytail: picks the first active primary; if two were ever flagged primary (not DB-enforced, 4c-1
 *  note) this may differ from the snapshot's most-recently-updated tiebreak — the KPI ₫/h reads the
 *  server's authoritative value instead. */
export function primaryMachine(list: Machine[]): Machine | null {
  return list.find((m) => m.isPrimary && m.active) ?? null;
}

// ── Aux costs ─────────────────────────────────────────────────────────────────────────────────────

export interface AuxSplit {
  /** Flat cost added to every order. */
  perOrder: AuxCost[];
  /** Monthly cost amortized over the 30-day order count. */
  perMonth: AuxCost[];
}

/** Split overhead lines by kind for the two tables (design tab 3). Unknown kinds are dropped. */
export function splitAuxCosts(list: AuxCost[]): AuxSplit {
  return {
    perOrder: list.filter((a) => a.kind === 'per_order'),
    perMonth: list.filter((a) => a.kind === 'per_month'),
  };
}

/** Σ amountVnd — the "theo đơn" / "theo tháng" subtotals in the allocation panel. int-VND in, int out. */
export function sumAmountVnd(list: AuxCost[]): number {
  return list.reduce((sum, a) => sum + a.amountVnd, 0);
}

// ── Waste ─────────────────────────────────────────────────────────────────────────────────────────

/** Waste factor (e.g. 0.084) → percent (8.4) for the "+8,4%" display (formatVnRating caps 1 decimal). */
export function wastePercent(wasteFactor: number): number {
  return wasteFactor * 100;
}
