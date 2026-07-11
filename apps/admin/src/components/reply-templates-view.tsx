'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button, Card, Input } from '@lumin/ui';
import type { components } from '@lumin/api-client';
import {
  createReplyTemplate,
  deleteReplyTemplate,
  updateReplyTemplate,
} from '@/lib/settings-actions';
import { extractVariables } from '@/lib/settings';

type ReplyTemplate = components['schemas']['ReplyTemplate'];

// "Cài đặt › Mẫu trả lời" (P3-i, design screen 9): the reply-template library used by the extension
// (Phase 4) and review replies. Full CRUD — owner-only at the server. Variables ({phí}, {STK}…) are
// DERIVED server-side from the body; the editor shows a live preview only. router.refresh() after each
// write re-reads the RSC list.

/** Dialog state: closed, adding, or editing a specific template. */
type Editing = null | { mode: 'add' } | { mode: 'edit'; template: ReplyTemplate };

export function ReplyTemplatesView({ templates }: { templates: ReplyTemplate[] }) {
  const t = useTranslations('settings');
  const [editing, setEditing] = useState<Editing>(null);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-text-strong">
            {t('templates.title')}
          </h1>
          <p className="mt-1 text-sm text-text-muted">{t('templates.subtitle')}</p>
        </div>
        <Button onClick={() => setEditing({ mode: 'add' })}>{t('templates.add')}</Button>
      </div>

      {templates.length === 0 ? (
        <Card elevation="md" className="px-5 py-16 text-center">
          <p className="text-text-muted">{t('templates.empty')}</p>
        </Card>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {templates.map((tpl) => (
            <TemplateCard
              key={tpl.id}
              template={tpl}
              onEdit={() => setEditing({ mode: 'edit', template: tpl })}
            />
          ))}
        </ul>
      )}

      {editing && (
        <TemplateDialog
          mode={editing.mode}
          template={editing.mode === 'edit' ? editing.template : undefined}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function TemplateCard({ template, onEdit }: { template: ReplyTemplate; onEdit: () => void }) {
  const t = useTranslations('settings');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function remove() {
    setError(null);
    startTransition(async () => {
      const res = await deleteReplyTemplate(template.id);
      if (res.ok) {
        router.refresh();
      } else {
        setConfirming(false);
        setError(res.code);
      }
    });
  }

  return (
    <li>
      <Card elevation="md" className="flex h-full flex-col gap-2 p-4">
        <h3 className="font-display font-semibold text-text-strong">{template.title}</h3>
        <p className="whitespace-pre-wrap text-sm text-text-body">{template.body}</p>
        {template.variables.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {template.variables.map((v) => (
              <span
                key={v}
                className="rounded-pill bg-surface-sunken px-2 py-0.5 font-mono text-xs text-text-muted"
              >
                {v}
              </span>
            ))}
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-danger">
            {t(`error.${error}`)}
          </p>
        )}

        <div className="mt-auto flex items-center gap-2 pt-2">
          {confirming ? (
            <>
              <span className="text-sm text-text-muted">{t('templates.deleteConfirm')}</span>
              <button
                type="button"
                onClick={remove}
                disabled={pending}
                className="min-h-[44px] rounded-pill px-3 text-sm font-semibold text-danger hover:bg-danger/5"
              >
                {pending ? t('saving') : t('templates.deleteConfirmYes')}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={pending}
                className="min-h-[44px] rounded-pill px-3 text-sm text-text-muted hover:bg-surface-sunken"
              >
                {t('templates.deleteConfirmNo')}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={onEdit}
                className="min-h-[44px] rounded-pill px-3 text-sm text-text-body hover:bg-surface-sunken"
              >
                {t('templates.edit')}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="min-h-[44px] rounded-pill px-3 text-sm text-danger hover:bg-danger/5"
              >
                {t('templates.delete')}
              </button>
            </>
          )}
        </div>
      </Card>
    </li>
  );
}

function TemplateDialog({
  mode,
  template,
  onClose,
}: {
  mode: 'add' | 'edit';
  template?: ReplyTemplate;
  onClose: () => void;
}) {
  const t = useTranslations('settings');
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState(template?.title ?? '');
  const [body, setBody] = useState(template?.body ?? '');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const detected = extractVariables(body);
  const canSubmit = !pending && title.trim() !== '' && body.trim() !== '';

  function submit() {
    setError(null);
    startTransition(async () => {
      const input = { title: title.trim(), body: body.trim() };
      const res =
        mode === 'edit' && template
          ? await updateReplyTemplate(template.id, input)
          : await createReplyTemplate(input);
      if (res.ok) {
        router.refresh();
        onClose();
      } else {
        setError(res.code);
      }
    });
  }

  const titleId = 'template-dialog-title';
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      className="w-[min(34rem,calc(100vw-2rem))] rounded-lg border-2 border-border-strong bg-surface-card p-0 text-text-body shadow-lg backdrop:bg-black/40"
    >
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) submit();
        }}
        className="flex flex-col gap-4 p-6"
      >
        <h2 id={titleId} className="font-display text-xl font-semibold text-text-strong">
          {mode === 'edit' ? t('templates.editTitle') : t('templates.addTitle')}
        </h2>

        <Input
          label={t('templates.titleLabel')}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('templates.titlePlaceholder')}
          autoComplete="off"
        />

        <label className="flex flex-col gap-1.5">
          <span className="font-display text-sm font-medium text-text-strong">
            {t('templates.bodyLabel')}
          </span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={5}
            placeholder={t('templates.bodyPlaceholder')}
            className="min-h-[120px] rounded-md border border-border-default bg-surface-card px-3 py-2 text-sm text-text-body focus-visible:border-primary focus-visible:outline-none"
          />
        </label>

        <div className="text-xs text-text-muted">
          {detected.length > 0 ? (
            <span>
              {t('templates.variablesDetected')}{' '}
              <span className="font-mono text-text-body">{detected.join(', ')}</span>
            </span>
          ) : (
            <span>{t('templates.variablesNone')}</span>
          )}
        </div>

        {error && (
          <p role="alert" className="text-sm text-danger">
            {t(`error.${error}`)}
          </p>
        )}

        <div className="mt-1 flex justify-end gap-3">
          <Button variant="outline" onClick={onClose} disabled={pending}>
            {t('templates.cancel')}
          </Button>
          <Button type="submit" disabled={!canSubmit}>
            {pending ? t('saving') : t('templates.save')}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
