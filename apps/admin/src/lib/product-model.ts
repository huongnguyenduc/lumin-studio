/**
 * Collapse an asset-job list to the latest job per type. Each model upload enqueues both a
 * `model_ingest` and a `sprite_render` job, and old attempts (including resolved failures) are never
 * pruned server-side — so the raw `GET .../asset-jobs` list piles up superseded rows (e.g. a stale
 * `failed` sprite_render sitting next to the newer `ready` one from a re-upload). The endpoint returns
 * jobs newest-first, so the first row seen per type is the current one: keep those, drop the rest,
 * preserving order. Generic over the one field it reads so it stays trivially unit-testable.
 */
export function latestJobsByType<T extends { jobType: string }>(jobs: T[]): T[] {
  return jobs.filter((j, i) => jobs.findIndex((k) => k.jobType === j.jobType) === i);
}

/**
 * The product's DEFAULT paint: first AVAILABLE colour per mapped part (keyed by modelObjectName, the
 * material name in the structured glb — f-3/f-4), plus the first available product-level colour for a
 * flat (no-parts) product. Mirrors the storefront's default selection (product-view.ts) and the
 * sprite's freeze at enqueue (core-api spritePartColors) — one convention, three surfaces. The admin
 * 3D previews apply these so the owner sees the model in the colours a customer opens on, not the
 * glb's baked material.
 */
export function defaultModelColors(
  parts: { id: string; modelObjectName?: string }[],
  colors: { partId?: string | null; hex: string; available: boolean }[],
): { flatHex?: string; byObject: Record<string, string> } {
  const byObject: Record<string, string> = {};
  for (const p of parts) {
    const obj = p.modelObjectName?.trim();
    if (!obj) continue;
    const c = colors.find((c) => c.partId === p.id && c.available);
    if (c) byObject[obj] = c.hex;
  }
  const flat = colors.find((c) => !c.partId && c.available);
  return { flatHex: parts.length === 0 ? flat?.hex : undefined, byObject };
}
