import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.config';

// MV3 build via CRXJS: it reads manifest.config.ts, wires the side-panel HTML (index.html) + the
// background service worker, and emits a loadable extension to dist/. React plugin renders the panel.
export default defineConfig({
  plugins: [react(), crx({ manifest })],
  server: { port: 5178, strictPort: true },
});
