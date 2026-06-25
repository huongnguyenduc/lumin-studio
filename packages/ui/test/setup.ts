// Registers @testing-library/jest-dom matchers (toBeInTheDocument, toHaveClass, …) on vitest's
// expect, and tears down the DOM after each test. With vitest `globals: false`, RTL cannot
// auto-register its afterEach cleanup, so we wire it explicitly — otherwise renders accumulate and
// role/text queries find duplicate elements. Imported via vitest.config.ts setupFiles.
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});
