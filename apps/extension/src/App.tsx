import { useEffect, useState } from 'react';
import { getUser, type SessionUser } from './lib/auth';
import { Login } from './screens/login';
import { Shell } from './screens/shell';
import { t } from './i18n';

type State = { status: 'loading' } | { status: 'login' } | { status: 'authed'; user: SessionUser };

// Root: read the stored session once, then route to the login screen or the authed shell. A logout
// or a login flips the state in place (the panel never navigates — it is a single side-panel page).
export function App() {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let live = true;
    getUser().then((user) => {
      if (live) setState(user ? { status: 'authed', user } : { status: 'login' });
    });
    return () => {
      live = false;
    };
  }, []);

  if (state.status === 'loading') {
    return (
      <div
        className="flex h-full items-center justify-center bg-surface-page"
        role="status"
        aria-label={t('app.loading')}
      >
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-border-subtle border-t-primary motion-reduce:animate-none" />
      </div>
    );
  }
  if (state.status === 'login') {
    return <Login onSuccess={(user) => setState({ status: 'authed', user })} />;
  }
  return <Shell user={state.user} onLogout={() => setState({ status: 'login' })} />;
}
