import { Button } from '@lumin/ui';
import { LAUNCH_KEY, TABS, type Tab } from '../lib/tabs';
import { t } from '../i18n';

// Toolbar quick-actions popup. ASSISTIVE-ONLY (ADR-011): it is three deep-links into the panel and
// nothing else — no chat scan, no page-domain read, no auto-fill (the auto-scan chrome in the hi-fi
// stays out). Clicking a link records the target screen, opens the docked side panel, then closes the
// popup; the shell reads the target and shows that tab. Opening the panel must happen inside the click
// (a user gesture), so we query the window then call sidePanel.open before anything else.
async function launch(tab: Tab) {
  const win = await chrome.windows.getCurrent();
  if (win.id !== undefined) await chrome.sidePanel.open({ windowId: win.id });
  await chrome.storage.local.set({ [LAUNCH_KEY]: tab });
  window.close();
}

export function Popup() {
  return (
    <div className="w-72 bg-surface-page">
      <header className="bg-surface-brand px-4 py-3 text-on-dark">
        <p className="font-display text-base font-bold">{t('app.name')}</p>
        <p className="text-xs text-on-dark opacity-80">{t('popup.subtitle')}</p>
      </header>
      <nav aria-label={t('app.name')} className="flex flex-col gap-2 p-4">
        {TABS.map(({ id, labelKey }) => (
          <Button
            key={id}
            variant="secondary"
            size="md"
            className="w-full justify-start"
            onClick={() => void launch(id)}
          >
            {t(labelKey)}
          </Button>
        ))}
      </nav>
    </div>
  );
}
