import { useEffect, useState } from 'react';
import { Button } from '@lumin/ui';
import { logout, type SessionUser } from '../lib/auth';
import { t } from '../i18n';
import { isLaunchTab, LAUNCH_KEY, TABS, type Tab } from '../lib/tabs';
import { CreateOrder } from './create-order';
import { Lookup } from './lookup';
import { Templates } from './templates';

// Authed shell: the panel frame once signed in — header + greeting + tab nav over the three screens
// (create order / lookup / templates). The active tab can also be deep-linked from the toolbar popup.
export function Shell({ user, onLogout }: { user: SessionUser; onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>('create');

  // Honor a deep-link from the toolbar popup: it writes the target screen to storage before opening the
  // panel. Read it on open, and keep listening so a popup click switches the tab while the panel is open.
  useEffect(() => {
    function apply(value: unknown) {
      if (isLaunchTab(value)) setTab(value);
    }
    void chrome.storage.local.get(LAUNCH_KEY).then((stored) => apply(stored[LAUNCH_KEY]));
    function onChanged(changes: Record<string, chrome.storage.StorageChange>, area: string) {
      if (area === 'local' && changes[LAUNCH_KEY]) apply(changes[LAUNCH_KEY].newValue);
    }
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  async function onLogoutClick() {
    await logout();
    onLogout();
  }

  return (
    <div className="flex h-full flex-col bg-surface-page">
      <header className="flex items-center justify-between gap-2 bg-surface-brand px-4 py-3 text-on-dark">
        <span className="flex items-center gap-2 font-display text-base font-bold">
          {t('app.name')}
          {/* Hi-fi: chip mono "extension" cạnh brand (như "admin" ở sidebar admin). */}
          <span className="rounded-pill border border-on-dark/40 px-2 py-0.5 font-mono text-[10px] font-normal lowercase">
            {t('app.badge')}
          </span>
        </span>
        <span className="flex items-center gap-1.5 font-mono text-xs">
          <span className="h-2 w-2 rounded-full bg-accent-teal" aria-hidden="true" />
          {t('shell.connected')}
        </span>
      </header>

      <div className="flex items-start justify-between gap-2 px-4 py-3">
        <div className="flex flex-col gap-1">
          <p className="font-display text-base font-semibold text-text-strong">
            {t('shell.greeting', { name: user.name })}
          </p>
          <p className="text-sm text-text-muted">{t('shell.hint')}</p>
        </div>
        <Button variant="outline" size="sm" className="min-h-11" onClick={onLogoutClick}>
          {t('shell.logout')}
        </Button>
      </div>

      <nav className="flex border-b border-border-subtle">
        {TABS.map(({ id, labelKey }) => {
          const active = tab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              aria-current={active ? 'page' : undefined}
              className={
                'min-h-11 flex-1 border-b-2 px-2 py-3 font-display text-sm ' +
                (active ? 'border-primary text-text-strong' : 'border-transparent text-text-muted')
              }
            >
              {t(labelKey)}
            </button>
          );
        })}
      </nav>

      {tab === 'create' && <CreateOrder />}
      {tab === 'lookup' && <Lookup role={user.role} />}
      {tab === 'templates' && <Templates />}
    </div>
  );
}
