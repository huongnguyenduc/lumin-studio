import { defineManifest } from '@crxjs/vite-plugin';

// MV3 manifest (CRXJS reads this at build). ASSISTIVE-ONLY (ADR-011): a docked side panel that only
// calls the BFF — NO content scripts, NO tabs/scripting, NO host access to messenger.com/instagram.com,
// so it can never read or write the Meta DOM.
//
// host_permissions = the core-api origin the panel calls. MV3 grants the cross-origin fetch to hosts
// listed here — that (not a server CORS header) is what lets the panel reach the BFF (ADR-043).
// ponytail: dev origin only for now; add the prod tunnel origin here (and set VITE_API_BASE_URL to
// match, src/config.ts) when it's provisioned — least-privilege, never a `https://*/*` wildcard.
export default defineManifest({
  manifest_version: 3,
  name: 'Lumin Studio',
  description: 'Trợ lý bán hàng Lumin Studio — tạo đơn, tra cứu, mẫu trả lời ngay bên khung chat.',
  version: '0.0.0',
  // No default_popup → clicking the toolbar icon opens the side panel (background.ts sets the
  // behavior). The full toolbar-popup quick-actions screen is a later slice (e-4).
  action: { default_title: 'Mở bảng Lumin Studio' },
  side_panel: { default_path: 'index.html' },
  background: { service_worker: 'src/background.ts', type: 'module' },
  // storage: the Bearer token/session (chrome.storage.local, ADR-043). sidePanel: the docked panel.
  permissions: ['storage', 'sidePanel'],
  host_permissions: ['http://localhost:8090/*'],
});
