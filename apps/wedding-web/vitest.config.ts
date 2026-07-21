import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Shell test = the i18n catalog invariant (test/messages.test.ts), same pattern as
// storefront. Page rendering is covered visually against the .dc.html prototypes.
export default defineConfig({
  // Mirror the `@/*` path alias from tsconfig — test/img.test.ts imports the /img
  // route handler, which resolves its own imports through it. Without this vitest
  // resolves `@/lib/img` as a bare package name and the route tests can't load.
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
