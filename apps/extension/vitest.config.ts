import { defineConfig } from 'vitest/config';

// Isolated from vite.config.ts (which carries the CRXJS build plugin) — the unit tests exercise the
// auth/token/i18n logic in a plain node env, no extension bundling.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
