// Flat config (ESLint 9, typescript-eslint). The load-bearing rule for Lumin is the money
// formatting ban: no `Intl.NumberFormat` / `.toLocaleString` ANYWHERE outside `packages/core`
// (ADR-019 · conventions §Tiền — money is formatted by the single formatter in packages/core).
// The Phase-0 ARM-GUARD (tests/harness/guard.test.sh) greps this file for that ban.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/.turbo/**', '**/coverage/**'],
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
);
