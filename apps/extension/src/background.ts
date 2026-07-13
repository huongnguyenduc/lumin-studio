// Service worker — the ONLY background logic: open the side panel when the toolbar icon is clicked
// (there is no default_popup). No tabs, no scripting, no Meta-domain contact (ADR-011).
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err) => console.error('[lumin] side panel behavior', err));
