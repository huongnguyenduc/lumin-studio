import type { MessageKey } from '../i18n';

// The three panel screens, shared by the shell's tab nav and the toolbar popup's quick-actions so the
// two never drift (one list, one label per screen). Pure — no React, no chrome — so it is unit-tested.
export type Tab = 'create' | 'lookup' | 'templates';

export const TABS: { id: Tab; labelKey: MessageKey }[] = [
  { id: 'create', labelKey: 'nav.create' },
  { id: 'lookup', labelKey: 'nav.lookup' },
  { id: 'templates', labelKey: 'nav.templates' },
];

// Storage key the popup writes and the shell reads to deep-link to a screen (chrome.storage.local).
export const LAUNCH_KEY = 'launchTab';

// Guard the value read back from storage before it drives UI state — it is untrusted (stale or
// hand-edited), so anything that is not a known tab id is ignored rather than trusted.
const IDS = new Set<string>(TABS.map((tab) => tab.id));
export function isLaunchTab(value: unknown): value is Tab {
  return typeof value === 'string' && IDS.has(value);
}
