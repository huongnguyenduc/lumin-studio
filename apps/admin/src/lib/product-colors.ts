import type { components } from '@lumin/api-client';

// Pure view-model for the editor's two-tone colour section (P3-l l-3, ADR-037). The customer picks one
// colour per part, so the editor shows colours grouped under their part. This groups a product's flat
// colours[] by Color.partId against its parts[], keeping the wire data (flat colours + nullable partId)
// untouched — the grouping is presentation only.

type Color = components['schemas']['Color'];
type Part = components['schemas']['Part'];

export interface ColorGroup {
  /** The part this group belongs to, or null for the trailing "flat" group (no part / dangling partId). */
  part: Part | null;
  colors: Color[];
}

/**
 * Group colours under their part for the editor. Parts sort by displayOrder (then name) and ALWAYS get a
 * group even when empty, so the owner can add the first colour to a fresh part. A colour with no partId —
 * or a partId whose part was removed — falls into a trailing flat group so it is never hidden. That flat
 * group is shown only when it holds colours, or when there are no parts at all (then it holds everything).
 * Within a group, colours keep the API's order.
 */
export function groupColorsByPart(parts: Part[], colors: Color[]): ColorGroup[] {
  const ordered = [...parts].sort(
    (a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name),
  );
  const partIds = new Set(ordered.map((p) => p.id));
  const byPart = new Map<string, Color[]>();
  const flat: Color[] = [];
  for (const c of colors) {
    if (c.partId && partIds.has(c.partId)) {
      const list = byPart.get(c.partId) ?? [];
      list.push(c);
      byPart.set(c.partId, list);
    } else {
      flat.push(c); // no part, or a dangling partId (part deleted) → keep visible in the flat group
    }
  }
  const groups: ColorGroup[] = ordered.map((part) => ({ part, colors: byPart.get(part.id) ?? [] }));
  if (flat.length > 0 || ordered.length === 0) groups.push({ part: null, colors: flat });
  return groups;
}
