import { defineConfig } from 'vitest/config';

// The shell's only unit test is the i18n catalog invariant (test/messages.test.ts) — plain TS, no
// DOM. RSC page rendering is deliberately covered by Playwright in Phase 5, not here (see the
// "what we intentionally don't unit-test" note in the PR / plan.md).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
