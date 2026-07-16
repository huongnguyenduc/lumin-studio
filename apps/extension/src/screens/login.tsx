import { useState, type FormEvent } from 'react';
import { Button, Card, Input } from '@lumin/ui';
import { login, LoginError, type LoginFailure, type SessionUser } from '../lib/auth';
import { t, type MessageKey } from '../i18n';

const ERROR_KEY: Record<LoginFailure, MessageKey> = {
  invalid: 'login.error.invalid',
  network: 'login.error.network',
  notoken: 'login.error.notoken',
};

// Login screen: email + password → login() (issueToken, ADR-043) → onSuccess. States: idle /
// submitting / error. The error attaches to the credential field (Input announces it via role=alert).
export function Login({ onSuccess }: { onSuccess: (user: SessionUser) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<LoginFailure | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      onSuccess(await login(email.trim(), password));
    } catch (err) {
      setError(err instanceof LoginError ? err.reason : 'network');
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-full flex-col justify-center bg-surface-page p-5">
      {/* Hi-fi 0 (Đăng nhập): brand to, căn giữa trên card viền cocoa. */}
      <Card className="flex flex-col gap-4 border-2 border-border-strong shadow-pop-sm">
        <div className="flex flex-col items-center gap-0.5 text-center">
          <span className="font-display text-2xl font-extrabold tracking-tight text-text-strong">
            {t('app.name')}
            <span className="text-primary">.</span>
          </span>
          <span className="font-mono text-xs text-text-subtle">{t('app.tagline')}</span>
        </div>
        <div className="flex flex-col gap-1 text-center">
          <h1 className="font-display text-xl font-bold text-text-strong">{t('login.title')}</h1>
          <p className="text-sm text-text-muted">{t('login.subtitle')}</p>
        </div>
        <form className="flex flex-col gap-3" onSubmit={onSubmit}>
          <Input
            type="email"
            required
            autoComplete="username"
            label={t('login.email.label')}
            placeholder={t('login.email.placeholder')}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <Input
            type="password"
            required
            autoComplete="current-password"
            label={t('login.password.label')}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            error={error ? t(ERROR_KEY[error]) : undefined}
          />
          {/* Hi-fi: CTA chunky viền cocoa + pop shadow (nền giữ bg-primary AA thay flame-500 fail AA). */}
          <Button
            type="submit"
            disabled={submitting}
            className="border-2 border-border-strong shadow-pop-sm"
          >
            {submitting ? t('login.submitting') : t('login.submit')}
          </Button>
        </form>
      </Card>
    </div>
  );
}
