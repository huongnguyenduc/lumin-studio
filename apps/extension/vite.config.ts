import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.config';

// MV3 build via CRXJS: it reads manifest.config.ts, wires the side-panel HTML (index.html) + the
// toolbar quick-actions popup HTML (popup.html), and emits a loadable extension to dist/. React
// plugin renders both.
export default defineConfig({
  plugins: [react(), crx({ manifest })],
  server: { port: 5178, strictPort: true },
});
