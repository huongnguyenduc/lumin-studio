import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.config';

// MV3 build via CRXJS: it reads manifest.config.ts, wires the side-panel HTML (index.html) + the
// toolbar quick-actions popup HTML (popup.html), and emits a loadable extension to dist/. React
// plugin renders both.
//
// server.proxy = DEV-PREVIEW ONLY (đi cùng src/dev-preview-shim.ts): mở panel trong tab thường để
// soi UI (§Visual-fidelity) thì fetch core-api bị CORS chặn (core-api không có CORS — extension
// thật đi qua host_permissions, ADR-043). Chạy `VITE_API_BASE_URL= pnpm dev` (base rỗng → fetch
// tương đối) để các path API dưới đây proxy same-origin sang :8090. Không ảnh hưởng build/extension.
export default defineConfig({
  plugins: [react(), crx({ manifest })],
  server: {
    port: 5178,
    strictPort: true,
    proxy: Object.fromEntries(
      ['/auth', '/products', '/checkout', '/price', '/orders', '/admin'].map((path) => [
        path,
        { target: 'http://localhost:8090', changeOrigin: true },
      ]),
    ),
  },
});
