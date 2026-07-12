'use client';

import { useEffect, useId, useRef, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { formatVnd } from '@lumin/core';
import { Button, Input } from '@lumin/ui';
import type { components } from '@lumin/api-client';
import { parseIntField } from '@/lib/materials';
import {
  createOption,
  updateOption,
  createChoice,
  updateChoice,
  type SubWriteResult,
} from '@/lib/product-actions';

type Option = components['schemas']['Option'];
type OptionChoice = components['schemas']['OptionChoice'];
type OptionType = components['schemas']['OptionType'];

const OPTION_TYPES: OptionType[] = ['text', 'choice'];

/** What the dialog is adding/editing. Absent option/choice = a create; a choice always names its option. */
export type OptionDialogTarget =
  | { kind: 'option'; option?: Option }
  | { kind: 'choice'; optionId: string; choiceCount: number; choice?: OptionChoice };

// Add/edit dialog for a product's customization options & their choices (P3-l l-4, ADR-037). Native
// <dialog> (showModal) so Esc/backdrop close + focus-trap come free; the parent keys each open, so every
// open starts clean. The client gate only blocks an obviously-incomplete submit — the server re-validates
// (type set, money bounds, maxChars>0-or-null). On success router.refresh() re-reads the product.
// ponytail: DialogShell/useSubWrite/Select mirror product-colors-dialog's; extract to a shared form-kit if
// a further consumer appears (kept a copy to keep this slice's blast radius to new files).
export function ProductOptionDialog({
  productId,
  target,
  onClose,
}: {
  productId: string;
  target: OptionDialogTarget;
  onClose: () => void;
}) {
  if (target.kind === 'option') {
    return <OptionForm productId={productId} option={target.option} onClose={onClose} />;
  }
  return (
    <ChoiceForm
      productId={productId}
      optionId={target.optionId}
      choice={target.choice}
      choiceCount={target.choiceCount}
      onClose={onClose}
    />
  );
}

// ── Shared plumbing (mirrors product-colors-dialog) ───────────────────────────────────────────────

function useSubWrite(onClose: () => void) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  function run(action: () => Promise<SubWriteResult>) {
    setError(null);
    start(async () => {
      const res = await action();
      if (res.ok) {
        router.refresh();
        onClose();
      } else {
        setError(res.code);
      }
    });
  }
  return { pending, error, run };
}

function DialogShell({
  title,
  children,
  onClose,
  pending,
  error,
  canSubmit,
  onSubmit,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  pending: boolean;
  error: string | null;
  canSubmit: boolean;
  onSubmit: () => void;
}) {
  const t = useTranslations('products.edit.options');
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    ref.current?.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      className="w-[min(32rem,calc(100vw-2rem))] rounded-lg border-2 border-border-strong bg-surface-card p-0 text-text-body shadow-lg backdrop:bg-black/40"
    >
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) onSubmit();
        }}
        className="flex flex-col gap-4 p-6"
      >
        <h2 id={titleId} className="font-display text-xl font-semibold text-text-strong">
          {title}
        </h2>

        {children}

        {error && (
          <p role="alert" className="text-sm text-danger">
            {t(`error.${error}`)}
          </p>
        )}

        <div className="mt-1 flex justify-end gap-3">
          <Button variant="outline" onClick={onClose} disabled={pending}>
            {t('cancel')}
          </Button>
          <Button type="submit" disabled={!canSubmit}>
            {pending ? t('saving') : t('save')}
          </Button>
        </div>
      </form>
    </dialog>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex flex-col gap-1.5">
      <span className="font-display text-sm font-medium text-text-strong">{label}</span>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 rounded-md border border-border-default bg-surface-card px-3 text-base text-text-body focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

// ── Option form ───────────────────────────────────────────────────────────────────────────────────

function OptionForm({
  productId,
  option,
  onClose,
}: {
  productId: string;
  option?: Option;
  onClose: () => void;
}) {
  const t = useTranslations('products.edit.options');
  const { pending, error, run } = useSubWrite(onClose);
  const [label, setLabel] = useState(option?.label ?? '');
  const [description, setDescription] = useState(option?.description ?? '');
  const [type, setType] = useState<OptionType>(option?.type ?? 'text');
  const [price, setPrice] = useState(option?.priceDelta ? String(option.priceDelta) : '');
  const [maxChars, setMaxChars] = useState(option?.maxChars ? String(option.maxChars) : '');

  const priceVnd = price.trim() === '' ? 0 : parseIntField(price);
  // A text option's maxChars is optional (blank = no limit); when given it must be > 0. A choice option
  // carries no maxChars (its choices are priced instead).
  const maxCharsN = maxChars.trim() === '' ? null : parseIntField(maxChars);
  const maxCharsOk =
    type !== 'text' || maxChars.trim() === '' || (maxCharsN !== null && maxCharsN > 0);
  const canSubmit =
    !pending && label.trim() !== '' && priceVnd !== null && priceVnd >= 0 && maxCharsOk;

  return (
    <DialogShell
      title={option ? t('optionTitleEdit') : t('optionTitleNew')}
      onClose={onClose}
      pending={pending}
      error={error}
      canSubmit={canSubmit}
      onSubmit={() =>
        run(() => {
          const input = {
            label: label.trim(),
            description: description.trim(),
            type,
            priceDelta: priceVnd ?? 0,
            maxChars: type === 'text' ? maxCharsN : null,
          };
          return option
            ? updateOption(productId, option.id, input)
            : createOption(productId, input);
        })
      }
    >
      <Input
        label={t('labelLabel')}
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder={t('optionLabelPlaceholder')}
        autoComplete="off"
      />
      <Input
        label={t('descLabel')}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder={t('descPlaceholder')}
        autoComplete="off"
      />
      <Select
        label={t('typeLabel')}
        value={type}
        onChange={(v) => setType(v as OptionType)}
        options={OPTION_TYPES.map((ty) => ({ value: ty, label: t(`type.${ty}`) }))}
      />
      <Input
        label={t('priceLabel')}
        type="number"
        inputMode="numeric"
        min={0}
        step={1}
        value={price}
        onChange={(e) => setPrice(e.target.value)}
        hint={priceVnd !== null && priceVnd > 0 ? formatVnd(priceVnd) : t('vndHint')}
        autoComplete="off"
      />
      {type === 'text' && (
        <Input
          label={t('maxCharsLabel')}
          type="number"
          inputMode="numeric"
          min={1}
          step={1}
          value={maxChars}
          onChange={(e) => setMaxChars(e.target.value)}
          hint={t('maxCharsHint')}
          error={!maxCharsOk ? t('maxCharsErr') : undefined}
          autoComplete="off"
        />
      )}
    </DialogShell>
  );
}

// ── Choice form ───────────────────────────────────────────────────────────────────────────────────

function ChoiceForm({
  productId,
  optionId,
  choice,
  choiceCount,
  onClose,
}: {
  productId: string;
  optionId: string;
  choice?: OptionChoice;
  choiceCount: number;
  onClose: () => void;
}) {
  const t = useTranslations('products.edit.options');
  const { pending, error, run } = useSubWrite(onClose);
  const [label, setLabel] = useState(choice?.label ?? '');
  const [description, setDescription] = useState(choice?.description ?? '');
  const [price, setPrice] = useState(choice?.priceDelta ? String(choice.priceDelta) : '');

  const priceVnd = price.trim() === '' ? 0 : parseIntField(price);
  const canSubmit = !pending && label.trim() !== '' && priceVnd !== null && priceVnd >= 0;
  // Keep an edited choice's order; a new one appends to the end (spares the owner an order field).
  const displayOrder = choice?.displayOrder ?? choiceCount;

  return (
    <DialogShell
      title={choice ? t('choiceTitleEdit') : t('choiceTitleNew')}
      onClose={onClose}
      pending={pending}
      error={error}
      canSubmit={canSubmit}
      onSubmit={() =>
        run(() => {
          const input = {
            label: label.trim(),
            description: description.trim(),
            priceDelta: priceVnd ?? 0,
            displayOrder,
          };
          return choice
            ? updateChoice(productId, optionId, choice.id, input)
            : createChoice(productId, optionId, input);
        })
      }
    >
      <Input
        label={t('labelLabel')}
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder={t('choiceLabelPlaceholder')}
        autoComplete="off"
      />
      <Input
        label={t('descLabel')}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder={t('choiceDescPlaceholder')}
        autoComplete="off"
      />
      <Input
        label={t('priceLabel')}
        type="number"
        inputMode="numeric"
        min={0}
        step={1}
        value={price}
        onChange={(e) => setPrice(e.target.value)}
        hint={priceVnd !== null && priceVnd > 0 ? formatVnd(priceVnd) : t('vndHint')}
        autoComplete="off"
      />
    </DialogShell>
  );
}
