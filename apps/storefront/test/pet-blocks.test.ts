import { describe, it, expect } from 'vitest';
import {
  type Block,
  CONTENT_BLOCK_TYPES,
  defaultBlocks,
  moveContentBlock,
  normalizeBlocks,
  toggleBlockVisible,
} from '../src/lib/pet-blocks';

const types = (blocks: Block[]) => blocks.map((b) => b.type);

describe('defaultBlocks', () => {
  it('puts photo_name first + visible, every content block visible in order', () => {
    const b = defaultBlocks();
    expect(types(b)).toEqual(['photo_name', ...CONTENT_BLOCK_TYPES]);
    expect(b.every((x) => x.visible)).toBe(true);
    expect(b.map((x) => x.order)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe('normalizeBlocks', () => {
  it('falls back to the default order when nothing is stored', () => {
    expect(types(normalizeBlocks(undefined))).toEqual(types(defaultBlocks()));
  });

  it('honours a stored order + visibility, forces photo_name first', () => {
    // stored: favorites before bio, socials hidden — and a stray photo_name in the middle (ignored/re-pinned).
    const stored = [
      { type: 'favorites', order: 5, visible: true },
      { type: 'photo_name', order: 9, visible: false },
      { type: 'bio', order: 7, visible: true },
      { type: 'socials', order: 6, visible: false },
    ];
    const norm = normalizeBlocks(stored);
    expect(norm[0]).toEqual({ type: 'photo_name', order: 0, visible: true }); // re-pinned first + visible
    // favorites(5) < socials(6) < bio(7); the un-stored gallery/medical default in after, by their default order.
    const idx = (t: string) => (types(norm) as string[]).indexOf(t);
    expect(idx('favorites')).toBeLessThan(idx('socials'));
    expect(idx('socials')).toBeLessThan(idx('bio'));
    expect(norm.find((b) => b.type === 'socials')?.visible).toBe(false);
    // every content type present exactly once + order re-indexed contiguous
    expect(new Set(types(norm)).size).toBe(6);
    expect(norm.map((b) => b.order)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('appends a content type missing from an old stored layout', () => {
    const norm = normalizeBlocks([{ type: 'bio', order: 1, visible: true }]);
    expect(new Set(types(norm))).toEqual(new Set(['photo_name', ...CONTENT_BLOCK_TYPES]));
  });

  it('drops unknown block types', () => {
    const norm = normalizeBlocks([{ type: 'weather', order: 1, visible: true }]);
    expect(types(norm)).not.toContain('weather');
  });
});

describe('moveContentBlock', () => {
  it('swaps a content block with its neighbour, keeps photo_name pinned', () => {
    const b = defaultBlocks(); // photo_name, bio, gallery, favorites, medical, socials
    const moved = moveContentBlock(b, 0, 1); // move bio (content index 0) down past gallery
    expect(types(moved)).toEqual([
      'photo_name',
      'gallery',
      'bio',
      'favorites',
      'medical',
      'socials',
    ]);
  });

  it('is a no-op at the ends', () => {
    const b = defaultBlocks();
    expect(types(moveContentBlock(b, 0, -1))).toEqual(types(b)); // bio already first content
    expect(types(moveContentBlock(b, 4, 1))).toEqual(types(b)); // socials already last content
  });
});

describe('toggleBlockVisible', () => {
  it('flips a content block and never hides photo_name', () => {
    const b = defaultBlocks();
    const hidden = toggleBlockVisible(b, 'socials');
    expect(hidden.find((x) => x.type === 'socials')?.visible).toBe(false);
    const stillFixed = toggleBlockVisible(b, 'photo_name');
    expect(stillFixed.find((x) => x.type === 'photo_name')?.visible).toBe(true);
  });
});
