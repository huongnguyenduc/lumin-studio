import { defineConfig } from 'vitest/config';

// Shell test = the i18n catalog invariant (test/messages.test.ts), same pattern as
// storefront. Page rendering is covered visually against the .dc.html prototypes.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
