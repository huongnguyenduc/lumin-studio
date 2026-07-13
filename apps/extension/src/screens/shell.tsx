import { useState } from 'react';
import { Button } from '@lumin/ui';
import { logout, type SessionUser } from '../lib/auth';
import { t, type MessageKey } from '../i18n';
import { CreateOrder } from './create-order';
import { Lookup } from './lookup';

type Tab = 'create' | 'lookup' | 'templates';
const TABS: { id: Tab; labelKey: MessageKey }[] = [
  { id: 'create', labelKey: 'nav.create' },
  { id: 'lookup', labelKey: 'nav.lookup' },
  { id: 'templates', labelKey: 'nav.templates' },
];

// Authed shell: the panel frame once signed in — header + greeting + tab nav. The tab bodies (create
// order / lookup / templates) arrive in slices e-2..e-4; for now each shows a "coming soon" placeholder.
export function Shell({ user, onLogout }: { user: SessionUser; onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>('create');

  async function onLogoutClick() {
    await logout();
    onLogout();
  }

  return (
    <div className="flex h-full flex-col bg-surface-page">
      <header className="flex items-center justify-between gap-2 bg-surface-brand px-4 py-3 text-on-dark">
        <span className="font-display text-base font-bold">{t('app.name')}</span>
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
      {tab === 'templates' && (
        <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-text-muted">
          {t('shell.comingSoon')}
        </div>
      )}
    </div>
  );
}
