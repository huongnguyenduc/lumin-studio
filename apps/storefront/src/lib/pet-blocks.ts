import type { PetBlock } from './pet-page';

// Pet-page content blocks (spec §10 ProfileBlock, P3-t t-4c-2). The page renders content in the owner's
// block order, skipping hidden blocks. `photo_name` (the avatar + name header) is FIXED: always first,
// never hidden (spec §10 "Khối photo_name luôn ở đầu, không ẩn được"). The reorder mode edits only the
// content blocks below it. Kept in lock-step with core-api's petBlockTypes (the write validates the same set).

export type BlockType = 'photo_name' | 'bio' | 'gallery' | 'favorites' | 'medical' | 'socials';

// The reorderable content blocks, in their default order — photo_name is the fixed header, not in this list.
export const CONTENT_BLOCK_TYPES: readonly BlockType[] = [
  'bio',
  'gallery',
  'favorites',
  'medical',
  'socials',
];
export const PHOTO_NAME: BlockType = 'photo_name';

export type Block = { type: BlockType; order: number; visible: boolean };

export function isBlockType(v: unknown): v is BlockType {
  return v === PHOTO_NAME || (CONTENT_BLOCK_TYPES as readonly string[]).includes(v as string);
}

// defaultBlocks is the layout a page carries before the owner ever reorders: photo_name first, then every
// content block visible in the default order.
export function defaultBlocks(): Block[] {
  return [PHOTO_NAME, ...CONTENT_BLOCK_TYPES].map((type, i) => ({
    type: type as BlockType,
    order: i,
    visible: true,
  }));
}

// normalizeBlocks turns a possibly-partial / out-of-order / stale block list (or nothing) into the canonical
// ordered list the page + reorder mode use: photo_name forced first + visible, then the content blocks by
// their stored order, APPENDING any content type not present (default visible) so a profile written before a
// block type existed still renders it. order is re-indexed 0..n so it's always contiguous.
export function normalizeBlocks(blocks: PetBlock[] | undefined): Block[] {
  const stored = new Map<BlockType, Block>();
  for (const b of blocks ?? []) {
    if (isBlockType(b.type) && b.type !== PHOTO_NAME && !stored.has(b.type)) {
      stored.set(b.type, { type: b.type, order: b.order, visible: b.visible });
    }
  }
  const content = CONTENT_BLOCK_TYPES.map(
    (type, i): Block => stored.get(type) ?? { type, order: i, visible: true },
  );
  content.sort((a, b) => a.order - b.order);
  return [{ type: PHOTO_NAME, order: 0, visible: true }, ...content].map((b, i) => ({
    ...b,
    order: i,
  }));
}

// moveContentBlock reorders the content blocks by swapping the one at `index` (into `content`, i.e. excluding
// the fixed photo_name header) with its neighbour in `dir`. A no-op at the ends. Returns a fresh list with
// `order` re-indexed FROM THE NEW POSITIONS — not via normalizeBlocks, which would re-sort by the old order
// and undo the swap. photo_name stays pinned first.
export function moveContentBlock(blocks: Block[], index: number, dir: -1 | 1): Block[] {
  const content = blocks.filter((b) => b.type !== PHOTO_NAME);
  const target = index + dir;
  if (index < 0 || index >= content.length || target < 0 || target >= content.length) return blocks;
  const next = [...content];
  const tmp = next[index] as Block;
  next[index] = next[target] as Block;
  next[target] = tmp;
  const photo = blocks.find((b) => b.type === PHOTO_NAME) ?? {
    type: PHOTO_NAME,
    order: 0,
    visible: true,
  };
  return [{ ...photo, order: 0 }, ...next.map((b, i) => ({ ...b, order: i + 1 }))];
}

// toggleBlockVisible flips a content block's visibility (photo_name can't be hidden → ignored).
export function toggleBlockVisible(blocks: Block[], type: BlockType): Block[] {
  if (type === PHOTO_NAME) return blocks;
  return blocks.map((b) => (b.type === type ? { ...b, visible: !b.visible } : b));
}
