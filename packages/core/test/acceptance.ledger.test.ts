// Acceptance ledger gate (docs/acceptance.md). A line ticked `[x]` MUST name a `(test: …)` id that
// appears in some packages/**/*.test.ts — otherwise the suite fails. Since the whole `pnpm test`
// suite must be green, a referenced-but-failing test still fails the build elsewhere, so together
// they enforce "ticked ⇒ test exists AND passes". Also pins OSM-02 + MNY-03 directly (plan.md ARM).
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transition } from '../src/order-state';
import { formatVnd } from '../src/money';

function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i += 1) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('repo root (pnpm-workspace.yaml) không tìm thấy');
}

function collectTestSources(root: string): string {
  const acc: string[] = [];
  const walk = (d: string): void => {
    for (const entry of readdirSync(d)) {
      if (entry === 'node_modules' || entry === '.turbo' || entry === 'dist') continue;
      const p = join(d, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (entry.endsWith('.test.ts')) acc.push(readFileSync(p, 'utf8'));
    }
  };
  walk(join(root, 'packages'));
  return acc.join('\n');
}

const root = repoRoot();
const md = readFileSync(join(root, 'docs', 'acceptance.md'), 'utf8');
const haystack = collectTestSources(root);
// A criterion is its marker line plus any indented continuation lines (the `(test: …)` ref often
// wraps onto the next, indented line in acceptance.md).
interface LedgerEntry {
  id: string;
  checked: boolean;
  text: string;
}
function parseLedger(source: string): LedgerEntry[] {
  const lines = source.split('\n');
  const entries: LedgerEntry[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(/^- \[([ x])\] `([A-Z]+-[0-9]+)`/);
    if (!m) continue;
    let text = lines[i];
    for (
      let j = i + 1;
      j < lines.length && /^\s+\S/.test(lines[j]) && !/^- \[/.test(lines[j]);
      j += 1
    ) {
      text += `\n${lines[j]}`;
    }
    entries.push({ id: m[2], checked: m[1] === 'x', text });
  }
  return entries;
}
const ledgerEntries = parseLedger(md);

describe('acceptance ledger gate (docs/acceptance.md)', () => {
  it('finds ledger criteria', () => {
    expect(ledgerEntries.length).toBeGreaterThan(0);
  });

  for (const entry of ledgerEntries) {
    it(`${entry.id} — ${entry.checked ? 'checked ⇒ test must resolve' : 'unchecked'}`, () => {
      if (!entry.checked) return;
      const refMatch = entry.text.match(/\(test:\s*`([^`]+)`/);
      expect(refMatch, `dòng [x] ${entry.id} thiếu (test: \`…\`)`).not.toBeNull();
      if (!refMatch) return;
      const ref = refMatch[1];
      expect(
        haystack.includes(ref),
        `acceptance ${entry.id} tick [x] nhưng không thấy test '${ref}' trong packages/**/*.test.ts`,
      ).toBe(true);
    });
  }

  it('OSM-02 invariant — a transition appends exactly one statusHistory record', () => {
    const next = transition({ status: 'PAID', statusHistory: [] }, 'PRINTING', {
      role: 'owner',
      byUser: 'u',
      at: '2026-06-25T00:00:00.000Z',
    });
    expect(next.statusHistory).toHaveLength(1);
  });

  it('MNY-03 invariant — single ₫ formatter (U+20AB)', () => {
    expect(formatVnd(390000)).toBe('390.000₫');
    expect(formatVnd(390000)).toContain('₫');
  });
});
