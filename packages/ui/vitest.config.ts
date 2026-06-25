import { defineConfig } from 'vitest/config';

// jsdom + automatic JSX runtime so components render without importing React; jest-dom matchers
// are registered in ./test/setup.ts. Mirrors packages/core's vitest setup, plus a DOM environment.
export default defineConfig({
  esbuild: { jsx: 'automatic', jsxImportSource: 'react' },
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['test/**/*.test.{ts,tsx}'],
    setupFiles: ['./test/setup.ts'],
  },
});
