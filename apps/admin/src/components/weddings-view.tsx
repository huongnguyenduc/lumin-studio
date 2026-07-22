'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button, Card, Input } from '@lumin/ui';
import {
  createWedding,
  createWeddingEvent,
  deleteWedding,
  reviewSubdomain,
  setEventSubdomain,
  updateWedding,
  type WeddingsActionResult,
} from '@/lib/weddings-actions';
import type { Wedding, WeddingEvent, WeddingsData } from '@/lib/weddings-fetch';

const DOMAIN_SUFFIX = '.luminstudio.vn';
const subLabel = (host: string | null) =>
  host ? host.replace(new RegExp(`\\${DOMAIN_SUFFIX}$`), '') : '';

type Act = (fn: () => Promise<WeddingsActionResult>, successKey: string) => void;

// "Đám cưới": owner-only couple management for the wedding-invitation side. Each
// couple has one or more "đám" (events), each an invitation site with its own
// subdomain. The owner: creates couples, sets their login password, adds đám,
// sets each đám's LIVE subdomain directly, and approves/rejects a subdomain
// change a couple requested from their own admin. Data lives in wedding-api;
// every write is a Server Action, then router.refresh re-reads the RSC list.
// ponytail: couple rename/password/delete use native prompt/confirm (low-traffic
// owner tool); subdomain uses a real inline input since it's the key setup step.
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
  const act: Act = (fn, successKey) =>
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
      <div>
        <h1 className="font-display text-2xl font-semibold text-text-strong">{t('title')}</h1>
        <p className="mt-1 text-sm text-text-muted">{t('subtitle')}</p>
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
        <div className="flex flex-col gap-4">
          {data.weddings.map((wd) => (
            <WeddingCard
              key={wd.slug}
              wedding={wd}
              events={eventsFor(wd.slug)}
              pending={pending}
              t={t}
              act={act}
              flash={flash}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function WeddingCard({
  wedding,
  events,
  pending,
  t,
  act,
  flash,
}: {
  wedding: Wedding;
  events: WeddingEvent[];
  pending: boolean;
  t: ReturnType<typeof useTranslations>;
  act: Act;
  flash: (text: string, error?: boolean) => void;
}) {
  const [newEvent, setNewEvent] = useState('');

  return (
    <Card elevation="md" className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-display text-lg font-semibold text-text-strong">{wedding.name}</span>
        <span
          className={`text-xs ${wedding.hasPassword ? 'text-text-muted' : 'text-accent-flame'}`}
        >
          {wedding.hasPassword ? t('passwordSet') : t('passwordUnset')}
        </span>
        <span className="flex-1" />
        <RowButton
          disabled={pending}
          onClick={() => {
            const name = window
              .prompt(t('renamePrompt', { name: wedding.name }), wedding.name)
              ?.trim();
            if (name && name !== wedding.name)
              act(() => updateWedding(wedding.slug, { name }), 'saved');
          }}
        >
          {t('rename')}
        </RowButton>
        <RowButton
          disabled={pending}
          onClick={() => {
            const pw = window.prompt(t('passwordPrompt', { name: wedding.name }));
            if (pw === null) return;
            if (pw !== '' && (pw.length < 8 || pw.length > 72)) {
              flash(t('badPassword'), true);
              return;
            }
            act(() => updateWedding(wedding.slug, { password: pw }), 'passwordSaved');
          }}
        >
          {t('setPassword')}
        </RowButton>
        <RowButton
          danger
          disabled={pending}
          onClick={() => {
            const typed = window.prompt(t('deleteConfirm', { name: wedding.name }));
            if (typed === null) return;
            if (typed.trim() !== wedding.name) {
              flash(t('deleteMismatch'), true);
              return;
            }
            act(() => deleteWedding(wedding.slug), 'deleted');
          }}
        >
          {t('delete')}
        </RowButton>
      </div>

      {/* Each event ("đám") = one invitation site + subdomain. */}
      {events.length === 0 ? (
        <p className="text-sm text-text-muted">{t('noEvents')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border-subtle rounded-lg bg-surface-sunken">
          {events.map((e) => (
            <EventRow key={e.slug} event={e} pending={pending} t={t} act={act} />
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={newEvent}
          onChange={(ev) => setNewEvent(ev.target.value)}
          placeholder={t('addEventPlaceholder')}
          className="max-w-xs"
        />
        <Button
          variant="secondary"
          size="sm"
          disabled={pending || newEvent.trim() === ''}
          onClick={() => {
            const name = newEvent.trim();
            if (!name) return;
            setNewEvent('');
            act(() => createWeddingEvent(wedding.slug, name), 'eventCreated');
          }}
        >
          {t('addEvent')}
        </Button>
      </div>
    </Card>
  );
}

function EventRow({
  event,
  pending,
  t,
  act,
}: {
  event: WeddingEvent;
  pending: boolean;
  t: ReturnType<typeof useTranslations>;
  act: Act;
}) {
  const [label, setLabel] = useState(subLabel(event.subdomain));
  const dirty = label.trim() !== subLabel(event.subdomain);

  return (
    <li className="flex flex-col gap-2 p-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-text-strong">{event.name}</span>
          <div className="flex items-center gap-1">
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t('subdomainPlaceholder')}
              aria-label={t('subdomainLabel', { event: event.name })}
              className="w-44"
            />
            <span className="whitespace-nowrap text-sm text-text-muted">{DOMAIN_SUFFIX}</span>
          </div>
        </div>
        <Button
          size="sm"
          disabled={pending || !dirty}
          onClick={() => act(() => setEventSubdomain(event.slug, label.trim()), 'subdomainSet')}
        >
          {event.subdomain ? t('subdomainChange') : t('subdomainSet2')}
        </Button>
        {event.subdomain ? (
          <a
            href={`https://${event.subdomain}`}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-accent-sky underline"
          >
            {`https://${event.subdomain}`}
          </a>
        ) : (
          <span className="text-sm text-text-muted">{t('subdomainNone')}</span>
        )}
      </div>

      {/* A change the couple requested from their own admin — approve makes it live. */}
      {event.requestedSubdomain ? (
        <div className="flex flex-wrap items-center gap-2 rounded bg-surface-card p-2 text-sm">
          <span className="text-text-body">
            {t('pendingRequest', {
              from: event.subdomain ?? '—',
              to: event.requestedSubdomain,
            })}
          </span>
          <span className="flex-1" />
          <Button
            size="sm"
            disabled={pending}
            onClick={() => act(() => reviewSubdomain(event.slug, true), 'approved')}
          >
            {t('approve')}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() => act(() => reviewSubdomain(event.slug, false), 'rejected')}
          >
            {t('reject')}
          </Button>
        </div>
      ) : null}
    </li>
  );
}

function RowButton({
  children,
  onClick,
  disabled,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`text-sm underline hover:text-text-strong disabled:opacity-50 ${
        danger ? 'text-accent-flame hover:opacity-80' : 'text-text-body'
      }`}
    >
      {children}
    </button>
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
