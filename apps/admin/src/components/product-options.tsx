'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { formatVnd } from '@lumin/core';
import { Badge, Button } from '@lumin/ui';
import type { components } from '@lumin/api-client';
import { sortChoices } from '@/lib/product-options';
import { deleteOption, deleteChoice, type SubWriteResult } from '@/lib/product-actions';
import { ProductOptionDialog, type OptionDialogTarget } from './product-options-dialog';

type Option = components['schemas']['Option'];
type OptionChoice = components['schemas']['OptionChoice'];

/**
 * The customization-options section of the editor (P3-l l-4, ADR-037) — edit-mode only (options/choices
 * are per-row sub-resources keyed by product id). A `text` option is an engraving field with a char limit;
 * a `choice` option owns enumerated choices the customer picks one of. Rows render straight from the
 * product props; every add/edit/delete persists per-row and router.refresh()es. Owner-gated at the BE —
 * the FE shows the actions optimistically (P3-e ROLE precedent).
 */
export function ProductOptions({ productId, options }: { productId: string; options: Option[] }) {
  const t = useTranslations('products.edit.options');
  const router = useRouter();
  const [target, setTarget] = useState<OptionDialogTarget | null>(null);
  const [pending, start] = useTransition();
  const [delError, setDelError] = useState<string | null>(null);

  function runDelete(action: () => Promise<SubWriteResult>) {
    setDelError(null);
    start(async () => {
      const res = await action();
      if (res.ok) router.refresh();
      else setDelError(res.code);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {delError && (
        <p role="alert" className="text-sm text-danger">
          {t(`error.${delError}`)}
        </p>
      )}

      <div className="flex justify-end">
        <Button size="sm" onClick={() => setTarget({ kind: 'option' })}>
          {t('addOption')}
        </Button>
      </div>

      {options.length === 0 ? (
        <p className="text-sm text-text-muted">{t('noOptions')}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {options.map((o) => (
            <li
              key={o.id}
              className="rounded-lg border border-border-subtle bg-surface-card px-3 py-2.5"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-text-strong">{o.label}</span>
                  <Badge tone={o.type === 'choice' ? 'sky' : 'neutral'}>
                    {t(`type.${o.type}`)}
                  </Badge>
                  {o.priceDelta > 0 && <Badge tone="neutral">+{formatVnd(o.priceDelta)}</Badge>}
                </span>
                <RowActions
                  onEdit={() => setTarget({ kind: 'option', option: o })}
                  onDelete={() => runDelete(() => deleteOption(productId, o.id))}
                  pending={pending}
                />
              </div>
              {o.description && <p className="mt-0.5 text-sm text-text-muted">{o.description}</p>}
              {o.type === 'text' ? (
                <p className="mt-1 font-mono text-xs text-text-muted">
                  {o.maxChars ? t('maxCharsBadge', { n: o.maxChars }) : t('textNoLimit')}
                </p>
              ) : (
                <ChoiceList
                  option={o}
                  onAdd={() =>
                    setTarget({ kind: 'choice', optionId: o.id, choiceCount: o.choices.length })
                  }
                  onEdit={(c) =>
                    setTarget({
                      kind: 'choice',
                      optionId: o.id,
                      choiceCount: o.choices.length,
                      choice: c,
                    })
                  }
                  onDelete={(c) => runDelete(() => deleteChoice(productId, o.id, c.id))}
                  pending={pending}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {target && (
        <ProductOptionDialog
          productId={productId}
          target={target}
          onClose={() => setTarget(null)}
        />
      )}
    </div>
  );
}

/** The enumerated choices under a `choice` option, in displayOrder, with a per-row edit/delete + add. */
function ChoiceList({
  option,
  onAdd,
  onEdit,
  onDelete,
  pending,
}: {
  option: Option;
  onAdd: () => void;
  onEdit: (c: OptionChoice) => void;
  onDelete: (c: OptionChoice) => void;
  pending: boolean;
}) {
  const t = useTranslations('products.edit.options');
  const choices = sortChoices(option.choices);
  return (
    <div className="mt-2 flex flex-col gap-1.5 border-l-2 border-border-subtle pl-3">
      {choices.length === 0 ? (
        <p className="text-sm text-text-muted">{t('noChoices')}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {choices.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3">
              <span className="flex min-w-0 flex-wrap items-baseline gap-2">
                <span className="text-sm text-text-strong">{c.label}</span>
                {c.description && (
                  <span className="truncate text-xs text-text-muted">{c.description}</span>
                )}
                {c.priceDelta > 0 && <Badge tone="neutral">+{formatVnd(c.priceDelta)}</Badge>}
              </span>
              <RowActions onEdit={() => onEdit(c)} onDelete={() => onDelete(c)} pending={pending} />
            </li>
          ))}
        </ul>
      )}
      <div>
        <Button size="sm" variant="outline" onClick={onAdd}>
          {t('addChoice')}
        </Button>
      </div>
    </div>
  );
}

/** Edit + a two-step inline delete (no blocking browser dialog); the second click fires onDelete. */
function RowActions({
  onEdit,
  onDelete,
  pending,
}: {
  onEdit: () => void;
  onDelete: () => void;
  pending: boolean;
}) {
  const t = useTranslations('products.edit.options');
  const [armed, setArmed] = useState(false);
  const btn =
    'min-h-[44px] rounded-md px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2 disabled:opacity-60';

  if (armed) {
    return (
      <span className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={onDelete}
          disabled={pending}
          className={`${btn} font-semibold text-danger hover:underline`}
        >
          {t('confirmDelete')}
        </button>
        <button
          type="button"
          onClick={() => setArmed(false)}
          disabled={pending}
          className={`${btn} text-text-muted hover:underline`}
        >
          {t('cancel')}
        </button>
      </span>
    );
  }
  return (
    <span className="flex shrink-0 items-center gap-1">
      <button
        type="button"
        onClick={onEdit}
        className={`${btn} font-semibold text-text-body hover:text-text-strong`}
      >
        {t('edit')}
      </button>
      <button
        type="button"
        onClick={() => setArmed(true)}
        className={`${btn} text-text-muted hover:text-danger`}
      >
        {t('delete')}
      </button>
    </span>
  );
}
