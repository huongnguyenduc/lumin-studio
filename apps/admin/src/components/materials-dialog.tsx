'use client';

import { useEffect, useId, useRef, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { formatVnd } from '@lumin/core';
import { Button, Input, Switch } from '@lumin/ui';
import type { components } from '@lumin/api-client';
import { parseIntField } from '@/lib/materials';
import {
  createAuxCost,
  createFilamentMaterial,
  createMachine,
  importFilament,
  scrapFilament,
  type MaterialsResult,
} from '@/lib/materials-actions';

type FilamentMaterial = components['schemas']['FilamentMaterial'];

// The five Vật tư write dialogs (ADR-039 4d-2, design screen 8): thêm vật tư · nhập cuộn · thêm máy ·
// thêm chi phí · ghi in hỏng. Native <dialog> (showModal) so Esc/backdrop close + focus-trap come free;
// the parent keys each open by kind, so every open starts clean. Client-side gating only locks an
// obviously-incomplete submit — the server re-validates every field (money bounds, hex regex, unknown
// id → 404). On success router.refresh() re-reads the RSC dashboard so the new row/lot shows at once.
//
// Money (always-must #2): amounts are typed as raw int-VND into number inputs (no grouping in the box),
// with a live formatVnd echo below via the single @lumin/core formatter — never a scattered Intl.

/** Which write the dialog is showing. `import`/`scrap` need a material picked (path id). */
export type DialogKind = 'material' | 'import' | 'machine' | 'aux' | 'scrap';

const MATERIAL_KINDS = ['PLA', 'PETG', 'recycled-PLA', 'Resin'] as const;
const UNITS = ['gram', 'ml'] as const;
const AUX_KINDS = ['per_order', 'per_month'] as const;

export function MaterialDialog({
  kind,
  materials,
  onClose,
}: {
  kind: DialogKind;
  materials: FilamentMaterial[];
  onClose: () => void;
}) {
  switch (kind) {
    case 'material':
      return <MaterialForm onClose={onClose} />;
    case 'import':
      return <ImportForm materials={materials} onClose={onClose} />;
    case 'machine':
      return <MachineForm onClose={onClose} />;
    case 'aux':
      return <AuxForm onClose={onClose} />;
    case 'scrap':
      return <ScrapForm materials={materials} onClose={onClose} />;
  }
}

// ── Shared write plumbing ───────────────────────────────────────────────────────────────────────

/** Run a write in a transition, surface its collapsed error code, and on success refresh + close. */
function useWrite(onClose: () => void) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  function run(action: () => Promise<MaterialsResult>) {
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

/** parseIntField + a per-field floor (≥ 0 for money, ≥ 1 for counts). null = not yet submittable. */
function intAtLeast(raw: string, min: number): number | null {
  const n = parseIntField(raw);
  return n !== null && n >= min ? n : null;
}

function DialogShell({
  title,
  children,
  onClose,
  pending,
  error,
  canSubmit,
  submitLabel,
  onSubmit,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  pending: boolean;
  error: string | null;
  canSubmit: boolean;
  submitLabel: string;
  onSubmit: () => void;
}) {
  const t = useTranslations('materials.dialog');
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
            {pending ? t('saving') : submitLabel}
          </Button>
        </div>
      </form>
    </dialog>
  );
}

// ── Field helpers ───────────────────────────────────────────────────────────────────────────────

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

/** A raw integer field (counts + money). step=1 nudges toward integers; the submit gate + server reject
 *  anything fractional/negative regardless. */
function NumField({
  label,
  value,
  onChange,
  min,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  min: number;
  hint?: string;
}) {
  return (
    <Input
      label={label}
      type="number"
      inputMode="numeric"
      min={min}
      step={1}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      hint={hint}
      autoComplete="off"
    />
  );
}

/** An int-VND field with a live grouped-₫ echo (the single @lumin/core formatter — no scattered Intl). */
function MoneyField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const t = useTranslations('materials.dialog');
  const n = parseIntField(value);
  return (
    <NumField
      label={label}
      value={value}
      onChange={onChange}
      min={0}
      hint={n !== null ? formatVnd(n) : t('vndHint')}
    />
  );
}

// ── Tab 1 · thêm vật tư / nhập cuộn ───────────────────────────────────────────────────────────────

function MaterialForm({ onClose }: { onClose: () => void }) {
  const t = useTranslations('materials.dialog');
  const { pending, error, run } = useWrite(onClose);
  const [name, setName] = useState('');
  const [material, setMaterial] = useState<string>(MATERIAL_KINDS[0]);
  const [unit, setUnit] = useState<string>(UNITS[0]);
  const [hex, setHex] = useState('');
  const [threshold, setThreshold] = useState('0');

  const th = intAtLeast(threshold, 0);
  const canSubmit = !pending && name.trim() !== '' && th !== null;

  return (
    <DialogShell
      title={t('materialTitle')}
      onClose={onClose}
      pending={pending}
      error={error}
      canSubmit={canSubmit}
      submitLabel={t('save')}
      onSubmit={() =>
        run(() =>
          createFilamentMaterial({
            name: name.trim(),
            material,
            unit,
            hex: hex.trim() || null,
            lowStockThreshold: th ?? 0,
          }),
        )
      }
    >
      <Input
        label={t('nameLabel')}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t('namePlaceholder')}
        autoComplete="off"
      />
      <Select
        label={t('materialLabel')}
        value={material}
        onChange={setMaterial}
        options={MATERIAL_KINDS.map((m) => ({ value: m, label: m }))}
      />
      <Select
        label={t('unitLabel')}
        value={unit}
        onChange={setUnit}
        options={UNITS.map((u) => ({ value: u, label: t(`unit.${u}`) }))}
      />
      <Input
        label={t('hexLabel')}
        value={hex}
        onChange={(e) => setHex(e.target.value)}
        placeholder="#8B5CF6"
        hint={t('hexHint')}
        autoComplete="off"
      />
      <NumField
        label={t('thresholdLabel')}
        value={threshold}
        onChange={setThreshold}
        min={0}
        hint={t('thresholdHint')}
      />
    </DialogShell>
  );
}

function ImportForm({
  materials,
  onClose,
}: {
  materials: FilamentMaterial[];
  onClose: () => void;
}) {
  const t = useTranslations('materials.dialog');
  const { pending, error, run } = useWrite(onClose);
  const [materialId, setMaterialId] = useState(materials[0]?.id ?? '');
  const [spoolCount, setSpoolCount] = useState('1');
  const [qtyPerSpool, setQtyPerSpool] = useState('');
  const [price, setPrice] = useState('');

  const spools = intAtLeast(spoolCount, 1);
  const qty = intAtLeast(qtyPerSpool, 1);
  const priceVnd = intAtLeast(price, 0);
  const canSubmit =
    !pending && materialId !== '' && spools !== null && qty !== null && priceVnd !== null;

  return (
    <DialogShell
      title={t('importTitle')}
      onClose={onClose}
      pending={pending}
      error={error}
      canSubmit={canSubmit}
      submitLabel={t('importSave')}
      onSubmit={() =>
        run(() =>
          importFilament(materialId, {
            spoolCount: spools ?? 1,
            qtyPerSpool: qty ?? 1,
            pricePerSpoolVnd: priceVnd ?? 0,
          }),
        )
      }
    >
      <Select
        label={t('materialPickLabel')}
        value={materialId}
        onChange={setMaterialId}
        options={materials.map((m) => ({ value: m.id, label: m.name }))}
      />
      <NumField label={t('spoolCountLabel')} value={spoolCount} onChange={setSpoolCount} min={1} />
      <NumField
        label={t('qtyPerSpoolLabel')}
        value={qtyPerSpool}
        onChange={setQtyPerSpool}
        min={1}
        hint={t('qtyPerSpoolHint')}
      />
      <MoneyField label={t('pricePerSpoolLabel')} value={price} onChange={setPrice} />
    </DialogShell>
  );
}

// ── Tab 2 · thêm máy ──────────────────────────────────────────────────────────────────────────────

function MachineForm({ onClose }: { onClose: () => void }) {
  const t = useTranslations('materials.dialog');
  const { pending, error, run } = useWrite(onClose);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [months, setMonths] = useState('');
  const [hours, setHours] = useState('');
  const [isPrimary, setIsPrimary] = useState(false);

  const priceVnd = intAtLeast(price, 0);
  const dep = intAtLeast(months, 1);
  const runHours = intAtLeast(hours, 1);
  const canSubmit =
    !pending && name.trim() !== '' && priceVnd !== null && dep !== null && runHours !== null;

  return (
    <DialogShell
      title={t('machineTitle')}
      onClose={onClose}
      pending={pending}
      error={error}
      canSubmit={canSubmit}
      submitLabel={t('save')}
      onSubmit={() =>
        run(() =>
          createMachine({
            name: name.trim(),
            purchasePriceVnd: priceVnd ?? 0,
            depreciationMonths: dep ?? 1,
            expectedHoursPerMonth: runHours ?? 1,
            isPrimary,
          }),
        )
      }
    >
      <Input
        label={t('machineNameLabel')}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t('machineNamePlaceholder')}
        autoComplete="off"
      />
      <MoneyField label={t('priceLabel')} value={price} onChange={setPrice} />
      <NumField label={t('monthsLabel')} value={months} onChange={setMonths} min={1} />
      <NumField
        label={t('hoursLabel')}
        value={hours}
        onChange={setHours}
        min={1}
        hint={t('hoursHint')}
      />
      <div className="flex items-center justify-between gap-3">
        <span className="font-display text-sm font-medium text-text-strong">
          {t('primaryLabel')}
        </span>
        <Switch checked={isPrimary} onCheckedChange={setIsPrimary} label={t('primaryLabel')} />
      </div>
    </DialogShell>
  );
}

// ── Tab 3 · thêm chi phí ──────────────────────────────────────────────────────────────────────────

function AuxForm({ onClose }: { onClose: () => void }) {
  const t = useTranslations('materials.dialog');
  const { pending, error, run } = useWrite(onClose);
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<string>(AUX_KINDS[0]);
  const [amount, setAmount] = useState('');

  const amountVnd = intAtLeast(amount, 0);
  const canSubmit = !pending && label.trim() !== '' && amountVnd !== null;

  return (
    <DialogShell
      title={t('auxTitle')}
      onClose={onClose}
      pending={pending}
      error={error}
      canSubmit={canSubmit}
      submitLabel={t('save')}
      onSubmit={() =>
        run(() => createAuxCost({ label: label.trim(), kind, amountVnd: amountVnd ?? 0 }))
      }
    >
      <Input
        label={t('auxLabelLabel')}
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder={t('auxLabelPlaceholder')}
        autoComplete="off"
      />
      <Select
        label={t('auxKindLabel')}
        value={kind}
        onChange={setKind}
        options={AUX_KINDS.map((k) => ({ value: k, label: t(`auxKind.${k}`) }))}
      />
      <MoneyField label={t('amountLabel')} value={amount} onChange={setAmount} />
    </DialogShell>
  );
}

// ── Tab 4 · ghi in hỏng ───────────────────────────────────────────────────────────────────────────

function ScrapForm({ materials, onClose }: { materials: FilamentMaterial[]; onClose: () => void }) {
  const t = useTranslations('materials.dialog');
  const { pending, error, run } = useWrite(onClose);
  const [materialId, setMaterialId] = useState(materials[0]?.id ?? '');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');

  const qtyN = intAtLeast(qty, 1);
  const canSubmit = !pending && materialId !== '' && qtyN !== null;

  return (
    <DialogShell
      title={t('scrapTitle')}
      onClose={onClose}
      pending={pending}
      error={error}
      canSubmit={canSubmit}
      submitLabel={t('scrapSave')}
      onSubmit={() =>
        run(() => scrapFilament(materialId, { qty: qtyN ?? 1, reason: reason.trim() || undefined }))
      }
    >
      <Select
        label={t('materialPickLabel')}
        value={materialId}
        onChange={setMaterialId}
        options={materials.map((m) => ({ value: m.id, label: m.name }))}
      />
      <NumField label={t('scrapQtyLabel')} value={qty} onChange={setQty} min={1} />
      <Input
        label={t('scrapReasonLabel')}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={t('scrapReasonPlaceholder')}
        autoComplete="off"
      />
    </DialogShell>
  );
}
