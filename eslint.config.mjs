// Flat config (ESLint 10, typescript-eslint). The load-bearing rule for Lumin is the money
// formatting ban: no `Intl.NumberFormat` / `.toLocaleString` ANYWHERE outside `packages/core`
// (ADR-019 · conventions §Tiền — money is formatted by the single formatter in packages/core).
// The Phase-0 ARM-GUARD (tests/harness/guard.test.sh) greps this file for that ban.
// LIMITATION: this is a SYNTACTIC ban — it catches `Intl.NumberFormat(...)` / `x.toLocaleString()`
// but not aliasing (`const NF = Intl.NumberFormat`). The real-mutation money gate
// (osm-mutation.test.sh) + spec-guardian review are the backstop for that escape hatch.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import i18next from 'eslint-plugin-i18next';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/.next/**',
      '**/next-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'Intl',
          property: 'NumberFormat',
          message:
            'Định dạng tiền qua packages/core (formatVnd) — không gọi Intl.NumberFormat trực tiếp (ADR-019).',
        },
        {
          property: 'toLocaleString',
          message:
            'Không dùng toLocaleString ngoài packages/core — định dạng tiền/số qua packages/core.',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.object.name='Intl'][callee.property.name='NumberFormat']",
          message: 'Định dạng tiền qua packages/core (formatVnd) — ADR-019.',
        },
      ],
    },
  },
  {
    // packages/core is the single sanctioned home for the money formatter + Intl usage.
    files: ['packages/core/**'],
    rules: {
      'no-restricted-properties': 'off',
      'no-restricted-syntax': 'off',
    },
  },
  {
    // App surfaces (Next.js): arm a11y + i18n enforcement (ADR-019 · conventions §A11y/§i18n).
    //  - jsx-a11y recommended: labels/alt/roles/keyboard — WCAG 2.2 AA at lint time.
    //  - i18next/no-literal-string (jsx-text-only): no hard-coded VISIBLE text in JSX; every string
    //    must come from a next-intl key. The high-signal subset — object literals (messages/vi.ts),
    //    config files and attribute values are NOT flagged, so it stays green without noise.
    files: ['apps/**/*.{ts,tsx}'],
    plugins: { 'jsx-a11y': jsxA11y, i18next },
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      'i18next/no-literal-string': ['error', { mode: 'jsx-text-only' }],
    },
  },
);
