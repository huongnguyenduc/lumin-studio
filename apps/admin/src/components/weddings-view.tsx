'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button, Card, Input } from '@lumin/ui';
import {
  createWedding,
  deleteWedding,
  reviewSubdomain,
  updateWedding,
  type WeddingsActionResult,
} from '@/lib/weddings-actions';
import type { Wedding, WeddingEvent, WeddingsData } from '@/lib/weddings-fetch';

// "Đám cưới": owner-only couple management for the wedding-invitation side.
// Data lives in wedding-api; every write is a Server Action, then router.refresh
// re-reads the RSC list. ponytail: rename/set-password/delete use native
// prompt/confirm — a low-traffic owner tool doesn't need bespoke dialogs; swap
// to a modal if it ever needs richer validation.
export function WeddingsView({ data }: { data: WeddingsData }) {
  const t = useTranslations('weddings');
  const router = useRouter();
  const [newName, setNewName] = useState('');
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const [pending, startTransition] = useTransition();

  if (data.status === 'forbidden') {
    return <Notice icon="🔒" title={t('forbiddenTitle')} body={t('forbiddenBody')} />;
  }
  if (data.status === 'unavailable') {
    return <Notice icon="🔌" title={t('unavailableTitle')} body={t('unavailableBody')} />;
  }

  const flash = (text: string, error = false) => setToast({ text, error });

  // Run an action, translate its result to a toast, and refresh on success.
  const act = (fn: () => Promise<WeddingsActionResult>, successKey: string) =>
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        flash(t(successKey));
        router.refresh();
      } else {
        flash(t(`errors.${res.code}`), true);
      }
    });

  const eventsFor = (slug: string) =>
    data.events.filter((e) => e.weddingSlug === slug).sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-text-strong">{t('title')}</h1>
          <p className="mt-1 text-sm text-text-muted">{t('subtitle')}</p>
        </div>
      </div>

      {toast ? (
        <p
          className={`text-sm ${toast.error ? 'text-accent-flame' : 'text-text-muted'}`}
          role="status"
        >
          {toast.text}
        </p>
      ) : null}

      <Card elevation="md" className="flex flex-col gap-3 p-5">
        <label className="text-sm font-semibold text-text-strong" htmlFor="new-wedding">
          {t('addLabel')}
        </label>
        <div className="flex gap-2">
          <Input
            id="new-wedding"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t('addPlaceholder')}
            className="max-w-sm"
          />
          <Button
            disabled={pending || newName.trim() === ''}
            onClick={() => {
              const name = newName.trim();
              if (!name) return;
              setNewName('');
              act(() => createWedding(name), 'created');
            }}
          >
            {t('add')}
          </Button>
        </div>
      </Card>

      {data.weddings.length === 0 ? (
        <Card elevation="md" className="px-5 py-16 text-center">
          <p className="text-text-muted">{t('empty')}</p>
        </Card>
      ) : (
        <Card elevation="md" className="overflow-hidden p-0">
          <ul className="divide-y divide-border-subtle">
            {data.weddings.map((wd) => (
              <WeddingRow
                key={wd.slug}
                wedding={wd}
                events={eventsFor(wd.slug)}
                pending={pending}
                t={t}
                onRename={() => {
                  const name = window.prompt(t('renamePrompt', { name: wd.name }), wd.name)?.trim();
                  if (name && name !== wd.name)
                    act(() => updateWedding(wd.slug, { name }), 'saved');
                }}
                onSetPassword={() => {
                  const pw = window.prompt(t('passwordPrompt', { name: wd.name }));
                  if (pw === null) return;
                  if (pw !== '' && (pw.length < 8 || pw.length > 72)) {
                    flash(t('badPassword'), true);
                    return;
                  }
                  act(() => updateWedding(wd.slug, { password: pw }), 'passwordSaved');
                }}
                onDelete={() => {
                  const typed = window.prompt(t('deleteConfirm', { name: wd.name }));
                  if (typed === null) return;
                  if (typed.trim() !== wd.name) {
                    flash(t('deleteMismatch'), true);
                    return;
                  }
                  act(() => deleteWedding(wd.slug), 'deleted');
                }}
                onReview={(eventSlug, approve) =>
                  act(() => reviewSubdomain(eventSlug, approve), approve ? 'approved' : 'rejected')
                }
              />
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function WeddingRow({
  wedding,
  events,
  pending,
  t,
  onRename,
  onSetPassword,
  onDelete,
  onReview,
}: {
  wedding: Wedding;
  events: WeddingEvent[];
  pending: boolean;
  t: ReturnType<typeof useTranslations>;
  onRename: () => void;
  onSetPassword: () => void;
  onDelete: () => void;
  onReview: (eventSlug: string, approve: boolean) => void;
}) {
  const requests = events.filter((e) => e.requestedSubdomain);
  return (
    <li className="flex flex-col gap-3 px-5 py-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-semibold text-text-strong">{wedding.name}</span>
        <span
          className={`text-xs ${wedding.hasPassword ? 'text-text-muted' : 'text-accent-flame'}`}
        >
          {wedding.hasPassword ? t('passwordSet') : t('passwordUnset')}
        </span>
        <span className="text-xs text-text-muted">
          {events.length === 1 ? t('eventCountOne') : t('eventCount', { count: events.length })}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          disabled={pending}
          onClick={onRename}
          className="text-sm text-text-body underline hover:text-text-strong disabled:opacity-50"
        >
          {t('rename')}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={onSetPassword}
          className="text-sm text-text-body underline hover:text-text-strong disabled:opacity-50"
        >
          {t('setPassword')}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={onDelete}
          className="text-sm text-accent-flame underline hover:opacity-80 disabled:opacity-50"
        >
          {t('delete')}
        </button>
      </div>

      {requests.length > 0 ? (
        <ul className="flex flex-col gap-2 rounded-lg bg-surface-sunken p-3">
          {requests.map((e) => (
            <li key={e.slug} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-text-body">
                {t('pendingRequest', {
                  event: e.name,
                  from: e.subdomain ?? '—',
                  to: e.requestedSubdomain ?? '',
                })}
              </span>
              <span className="flex-1" />
              <Button size="sm" disabled={pending} onClick={() => onReview(e.slug, true)}>
                {t('approve')}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={pending}
                onClick={() => onReview(e.slug, false)}
              >
                {t('reject')}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function Notice({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <Card elevation="md" className="mx-auto max-w-md px-5 py-16 text-center">
      <p className="text-4xl" aria-hidden>
        {icon}
      </p>
      <h1 className="mt-3 font-display text-xl font-semibold text-text-strong">{title}</h1>
      <p className="mt-2 text-sm text-text-muted">{body}</p>
    </Card>
  );
}
