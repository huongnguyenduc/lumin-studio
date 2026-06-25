import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { luminPreset } from '@lumin/tokens';

// Guard against silently-dead utility classes. Every SEMANTIC-color Tailwind utility a component
// emits (bg-primary, text-on-dark, bg-accent-teal-soft, border-border-strong …) must map to a key in
// the @lumin/tokens preset — otherwise it no-ops in the real app and NO render test catches it (there
// is no Tailwind running here; component tests assert class STRINGS, not computed pixels). This is the
// "no silent no-op" invariant from the harness applied to the design-system layer: if a primitive
// reaches for a token utility that does not exist, CI must go red. Add a key to the preset, don't
// silence this test.
const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

const colorKeys = new Set(Object.keys(luminPreset.theme.extend.colors));
// Default Tailwind color roots that are always valid regardless of the preset.
const DEFAULT_OK = new Set(['transparent', 'current', 'inherit', 'white', 'black']);
const PREFIXES = [
  'bg',
  'text',
  'border',
  'ring',
  'fill',
  'stroke',
  'from',
  'to',
  'via',
  'divide',
  'outline',
  'placeholder',
  'caret',
  'decoration',
];
// Only audit utilities whose colour part references a Lumin semantic root — this skips plain Tailwind
// (text-sm, shadow-md, border-2, ring-offset-2 …) which carry no colour token.
const SEMANTIC =
  /(primary|accent|surface|danger|on-(dark|primary|danger)|text-(strong|body|muted|subtle|link)|border-(subtle|default|strong)|flame|teal|sky|sun)/;
const UTIL = new RegExp(`\\b(${PREFIXES.join('|')})-([a-z][a-z0-9-]*)`, 'g');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/** Strip // line and block comments so prose mentioning a class name can't trip the audit. */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('@lumin/ui token coverage', () => {
  it('every emitted semantic-color utility resolves to a @lumin/tokens preset key', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(srcDir)) {
      const code = stripComments(readFileSync(file, 'utf8'));
      for (const m of code.matchAll(UTIL)) {
        const colorPart = m[2];
        if (!SEMANTIC.test(colorPart)) continue;
        if (colorKeys.has(colorPart) || DEFAULT_OK.has(colorPart)) continue;
        offenders.push(`${file.split('/').pop()}: "${m[0]}" → no preset colour key "${colorPart}"`);
      }
    }
    expect(
      offenders,
      `dead utility classes (add the key to packages/tokens/src/preset.ts):\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});
