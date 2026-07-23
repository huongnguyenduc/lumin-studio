// Palette + shared style fragments (HANDOFF §7). Sections use inline styles on
// purpose: the composition is absolute-positioned pixel art authored at 393px —
// mirroring the prototype's values 1:1 beats translating them into utilities.
export const INK = 'rgb(120,105,93)';
export const INK_DARK = 'rgb(101,88,77)';
export const TAN = 'rgb(176,157,144)';
export const TAN_LIGHT = 'rgb(186,170,159)';
export const CREAM = 'rgb(255,251,248)';
export const CREAM_2 = 'rgb(249,241,232)';
export const TERRACOTTA = 'rgb(203,77,28)';
// Bản rev Figma 107:240 dịu hoá lời chào trên thư mời; wishes/admin giữ tông cũ.
export const TERRACOTTA_SOFT = 'rgb(166,115,90)';
export const BRICK = 'rgb(184,82,33)';
export const DARK = 'rgb(59,47,39)';

export const SCRIPT = 'var(--font-script), cursive';
export const SERIF = 'var(--font-serif), ui-serif, Georgia, serif';

// The signature sub-pixel hairline (§7: rings are box-shadow, never borders).
export const RING = `0 0 0 0.5px ${TAN}`;

// The 4 wish-card presets (§2.7) — values must match the API/DB allowlist.
export const WISH_COLORS = [
  { key: 'colorWhite', bg: 'rgb(255,251,248)' },
  { key: 'colorCream', bg: 'rgb(255,248,240)' },
  { key: 'colorBeige', bg: 'rgb(249,241,232)' },
  
] as const;
