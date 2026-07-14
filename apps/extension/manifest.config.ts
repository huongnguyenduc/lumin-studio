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
  // action.default_popup → the toolbar icon opens a small quick-actions popup (popup.html): three
  // deep-links (Tạo đơn / Tra cứu / Mẫu) that open the docked side panel on the chosen screen. This
  // REPLACES the former one-click-straight-to-panel (the old background.ts + openPanelOnActionClick, now
  // removed) — a deliberate e-4 trade: the picker costs one extra click to reach the panel but lands
  // staff on the right screen. ASSISTIVE-ONLY (ADR-011): the popup only deep-links — it never scans the
  // chat, reads the page domain, or auto-fills (the auto-scan chrome in the hi-fi stays out).
  action: { default_title: 'Mở bảng Lumin Studio', default_popup: 'popup.html' },
  side_panel: { default_path: 'index.html' },
  // storage: the Bearer token/session (chrome.storage.local, ADR-043). sidePanel: the popup opens the
  // docked panel via chrome.sidePanel.open — so there is no background service worker anymore.
  permissions: ['storage', 'sidePanel'],
  host_permissions: ['http://localhost:8090/*'],
});
