// Shared admin style fragments (Admin.dc.html §3 — desktop-first, max 1120px).
import type { CSSProperties } from 'react';

export const INK = 'rgb(120,105,93)';
export const TAN = 'rgb(176,157,144)';
export const TAN_LIGHT = 'rgb(186,170,159)';
export const CREAM = 'rgb(255,251,248)';
export const CREAM_2 = 'rgb(249,241,232)';
export const TERRACOTTA = 'rgb(196,72,25)'; // darkened slightly for AA text contrast on CREAM
export const GREEN = 'oklch(0.52 0.09 155)';
export const RED = 'oklch(0.52 0.09 30)';
export const HAIRLINE = 'rgb(235,226,217)';
export const RING = `0 0 0 0.5px ${TAN}`;

export const SCRIPT = 'var(--font-script), cursive';

export const card: CSSProperties = {
  background: CREAM,
  borderRadius: 10,
  boxShadow: RING,
};

// Uppercase label — kept readable via INK (TAN/TAN_LIGHT read as ~2.3:1 on the
// cream backgrounds here, well under WCAG AA 4.5:1 for text); de-emphasis comes
// from size/letter-spacing/case instead of a lighter, harder-to-read color.
export const kicker: CSSProperties = {
  fontSize: 11,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: INK,
};

export const pillSolid: CSSProperties = {
  padding: '8px 18px',
  borderRadius: 22,
  border: 'none',
  background: INK,
  color: CREAM,
  fontSize: 12,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  cursor: 'pointer',
  fontFamily: 'inherit',
  whiteSpace: 'nowrap',
};

export const pillGhost: CSSProperties = {
  padding: '8px 18px',
  borderRadius: 22,
  border: 'none',
  background: 'transparent',
  boxShadow: RING,
  color: INK,
  fontSize: 12,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  cursor: 'pointer',
  fontFamily: 'inherit',
  whiteSpace: 'nowrap',
};

export const inputBase: CSSProperties = {
  boxSizing: 'border-box',
  border: 'none',
  outline: 'none',
  background: CREAM,
  boxShadow: RING,
  fontFamily: 'inherit',
  fontSize: 13,
  color: INK,
};

// Filter/page-size chip; selected = filled ink.
export function chipStyle(selected: boolean): CSSProperties {
  return {
    padding: '5px 14px',
    borderRadius: 20,
    border: 'none',
    boxShadow: RING,
    fontSize: 12,
    cursor: 'pointer',
    background: selected ? INK : 'transparent',
    color: selected ? CREAM : INK,
    whiteSpace: 'nowrap',
    fontFamily: 'inherit',
  };
}

export const checkbox: CSSProperties = {
  width: 15,
  height: 15,
  margin: 0,
  accentColor: INK,
  cursor: 'pointer',
};
