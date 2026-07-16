'use client';

import { useEffect, useId, useRef, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { formatVnd } from '@lumin/core';
import { Button, Input, Switch, cn } from '@lumin/ui';
import type { components } from '@lumin/api-client';
import { parseIntField } from '@/lib/materials';
import {
  createColor,
  updateColor,
  createPart,
  updatePart,
  type SubWriteResult,
} from '@/lib/product-actions';
import { PartObjectPicker } from './product-model-view';

type Color = components['schemas']['Color'];
type Part = components['schemas']['Part'];
type FilamentMaterial = components['schemas']['FilamentMaterial'];

/** What the dialog is adding/editing. Absent part/color = a create. */
export type DialogTarget = { kind: 'part'; part?: Part } | { kind: 'color'; color?: Color };

// Add/edit dialog for a product's parts & colours (P3-l l-3, ADR-037). Native <dialog> (showModal) so
// Esc/backdrop close + focus-trap come free; the parent keys each open, so every open starts clean. The
// client gate only blocks an obviously-incomplete submit — the server re-validates (money bounds, unknown
// filament/part id, a filament with no hex). On success router.refresh() re-reads the product so the row shows.
// ponytail: DialogShell/useSubWrite/Select mirror materials-dialog's; extract to a shared form-kit when a
// 4th consumer appears (repo already tolerates the duplicated Select in product-editor/materials-dialog).
export function ProductColorDialog({
  productId,
  target,
  parts,
  filaments,
  modelObjectNames,
  model3dStructuredUrl,
  partCount,
  onClose,
}: {
  productId: string;
  target: DialogTarget;
  parts: Part[];
  filaments: FilamentMaterial[];
  modelObjectNames: string[];
  model3dStructuredUrl?: string;
  partCount: number;
  onClose: () => void;
}) {
  if (target.kind === 'part') {
    return (
      <PartForm
        productId={productId}
        part={target.part}
        partCount={partCount}
        modelObjectNames={modelObjectNames}
        model3dStructuredUrl={model3dStructuredUrl}
        onClose={onClose}
      />
    );
  }
  return (
    <ColorForm
      productId={productId}
      color={target.color}
      parts={parts}
      filaments={filaments}
      onClose={onClose}
    />
  );
}

// ── Shared plumbing (mirrors materials-dialog) ────────────────────────────────────────────────────

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
  const t = useTranslations('products.edit.colors');
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

// ── Part form ─────────────────────────────────────────────────────────────────────────────────────

function PartForm({
  productId,
  part,
  partCount,
  modelObjectNames,
  model3dStructuredUrl,
  onClose,
}: {
  productId: string;
  part?: Part;
  partCount: number;
  modelObjectNames: string[];
  model3dStructuredUrl?: string;
  onClose: () => void;
}) {
  const t = useTranslations('products.edit.colors');
  const { pending, error, run } = useSubWrite(onClose);
  const [name, setName] = useState(part?.name ?? '');
  const [estQty, setEstQty] = useState(part?.estFilamentQty ? String(part.estFilamentQty) : '');
  // f-2: which named object in the 3D model this part maps to. '' = unmapped (renders in its default
  // filament, never grey). The owner sets it two ways — a dropdown (the ingested name list) or clicking the
  // mesh in the 3D preview below (PartObjectPicker); both write this same objectName.
  const [objectName, setObjectName] = useState(part?.modelObjectName ?? '');

  const est = estQty.trim() === '' ? 0 : parseIntField(estQty);
  const canSubmit = !pending && name.trim() !== '' && est !== null && est >= 0;
  // Keep an edited part's order; a new one appends to the end (spares the owner an order field).
  const displayOrder = part?.displayOrder ?? partCount;

  const objectOptions = [
    { value: '', label: t('objectNone') },
    ...modelObjectNames.map((n) => ({ value: n, label: n })),
  ];
  // A previously-mapped name the current model no longer lists (renamed / re-ingested / a switched source):
  // keep it selectable + flag it stale, so saving the part doesn't silently drop the owner's mapping.
  const objectStale = objectName !== '' && !modelObjectNames.includes(objectName);
  if (objectStale)
    objectOptions.push({ value: objectName, label: t('objectStale', { name: objectName }) });

  return (
    <DialogShell
      title={part ? t('partTitleEdit') : t('partTitleNew')}
      onClose={onClose}
      pending={pending}
      error={error}
      canSubmit={canSubmit}
      onSubmit={() =>
        run(() => {
          const input = {
            name: name.trim(),
            displayOrder,
            estFilamentQty: est ?? 0,
            modelObjectName: objectName,
          };
          return part ? updatePart(productId, part.id, input) : createPart(productId, input);
        })
      }
    >
      <Input
        label={t('nameLabel')}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t('partNamePlaceholder')}
        autoComplete="off"
      />
      <Input
        label={t('estQtyLabel')}
        type="number"
        inputMode="numeric"
        min={0}
        step={1}
        value={estQty}
        onChange={(e) => setEstQty(e.target.value)}
        hint={t('estQtyHint')}
        autoComplete="off"
      />
      {modelObjectNames.length > 0 || objectName !== '' || model3dStructuredUrl ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Select
              label={t('objectLabel')}
              value={objectName}
              onChange={setObjectName}
              options={objectOptions}
            />
            <p className="text-xs text-text-muted">
              {objectStale ? t('objectStaleHint') : t('objectHint')}
            </p>
          </div>
          {model3dStructuredUrl && (
            <PartObjectPicker
              src={model3dStructuredUrl}
              selected={objectName}
              onPick={setObjectName}
            />
          )}
        </div>
      ) : (
        <p className="text-sm text-text-muted">{t('objectEmptyHint')}</p>
      )}
    </DialogShell>
  );
}

// ── Colour form ───────────────────────────────────────────────────────────────────────────────────

function ColorForm({
  productId,
  color,
  parts,
  filaments,
  onClose,
}: {
  productId: string;
  color?: Color;
  parts: Part[];
  filaments: FilamentMaterial[];
  onClose: () => void;
}) {
  const t = useTranslations('products.edit.colors');
  const { pending, error, run } = useSubWrite(onClose);
  const [available, setAvailable] = useState(color?.available ?? true);
  const [price, setPrice] = useState(color?.priceDelta ? String(color.priceDelta) : '');
  const [partId, setPartId] = useState(color?.partId ?? '');
  const [filamentId, setFilamentId] = useState(color?.filamentMaterialId ?? '');

  // f-1 (ADR-039): a colour's name + hex come from its filament (copy-on-write) — the shop picks a filament,
  // it never types a name/hex. Only a filament that HAS a hex can be a swatch source (the server enforces
  // this too); a filament with no colour chip disables submit with a hint.
  const selectedFilament = filaments.find((f) => f.id === filamentId);
  const filamentHex = selectedFilament?.hex ?? null;
  const priceVnd = price.trim() === '' ? 0 : parseIntField(price);
  const canSubmit =
    !pending && filamentId !== '' && !!filamentHex && priceVnd !== null && priceVnd >= 0;

  return (
    <DialogShell
      title={color ? t('colorTitleEdit') : t('colorTitleNew')}
      onClose={onClose}
      pending={pending}
      error={error}
      canSubmit={canSubmit}
      onSubmit={() =>
        run(() => {
          const input = {
            available,
            priceDelta: priceVnd ?? 0,
            partId: partId || null,
            filamentMaterialId: filamentId,
          };
          return color ? updateColor(productId, color.id, input) : createColor(productId, input);
        })
      }
    >
      <div className="flex items-end gap-3">
        <span
          aria-hidden="true"
          className={cn(
            'mb-1 h-11 w-11 shrink-0 rounded-md border',
            filamentHex ? 'border-border-strong' : 'border-dashed border-border-strong',
          )}
          style={filamentHex ? { backgroundColor: filamentHex } : undefined}
        />
        <div className="flex-1">
          <Select
            label={t('filamentLabel')}
            value={filamentId}
            onChange={setFilamentId}
            options={[
              { value: '', label: t('filamentPlaceholder') },
              ...filaments.map((f) => ({ value: f.id, label: f.name })),
            ]}
          />
        </div>
      </div>
      {filamentId !== '' && !filamentHex && (
        <p role="alert" className="text-sm text-danger">
          {t('filamentNoHex')}
        </p>
      )}
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
      {parts.length > 0 && (
        <Select
          label={t('partLabel')}
          value={partId}
          onChange={setPartId}
          options={[
            { value: '', label: t('partNone') },
            ...parts.map((p) => ({ value: p.id, label: p.name })),
          ]}
        />
      )}
      <div className="flex items-center justify-between gap-3">
        <span className="font-display text-sm font-medium text-text-strong">
          {t('availableLabel')}
        </span>
        <Switch checked={available} onCheckedChange={setAvailable} label={t('availableLabel')} />
      </div>
    </DialogShell>
  );
}
