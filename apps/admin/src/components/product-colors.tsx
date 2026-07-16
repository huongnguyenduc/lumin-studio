'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { formatVnd } from '@lumin/core';
import { Badge, Button } from '@lumin/ui';
import type { components } from '@lumin/api-client';
import { groupColorsByPart } from '@/lib/product-colors';
import { deleteColor, deletePart, type SubWriteResult } from '@/lib/product-actions';
import { ProductColorDialog, type DialogTarget } from './product-colors-dialog';

type Color = components['schemas']['Color'];
type Part = components['schemas']['Part'];
type FilamentMaterial = components['schemas']['FilamentMaterial'];

/**
 * The two-tone colour section of the editor (P3-l l-3, ADR-037) — edit-mode only (parts/colours are
 * per-row sub-resources keyed by product id). Named parts group the colours (the customer picks one colour
 * per part); a colour may link to a shop filament (ADR-039) for deduct-on-print. Rows render straight from
 * the product props; every add/edit/delete persists per-row and router.refresh()es, so the list always
 * reflects the server. Owner-gated at the BE — the FE shows the actions optimistically (P3-e ROLE precedent).
 *
 * f-2: a part can map to a named object in the 3D model (parts.modelObjectName) so a later slice recolors it
 * in its filament colour. The owner picks from modelObjectNames — the object list model_ingest found (empty
 * until a model has been ingested / a single-mesh STL has none); the mapped name shows on the part row.
 */
export function ProductColors({
  productId,
  parts,
  colors,
  filaments,
  modelObjectNames,
  model3dStructuredUrl,
}: {
  productId: string;
  parts: Part[];
  colors: Color[];
  filaments: FilamentMaterial[];
  modelObjectNames: string[];
  model3dStructuredUrl?: string;
}) {
  const t = useTranslations('products.edit.colors');
  const router = useRouter();
  const [target, setTarget] = useState<DialogTarget | null>(null);
  const [pending, start] = useTransition();
  const [delError, setDelError] = useState<string | null>(null);

  const groups = groupColorsByPart(parts, colors);
  const filamentName = (id?: string | null) =>
    id ? filaments.find((f) => f.id === id)?.name : undefined;

  function runDelete(action: () => Promise<SubWriteResult>) {
    setDelError(null);
    start(async () => {
      const res = await action();
      if (res.ok) router.refresh();
      else setDelError(res.code);
    });
  }

  return (
    <div className="flex flex-col gap-5">
      {delError && (
        <p role="alert" className="text-sm text-danger">
          {t(`error.${delError}`)}
        </p>
      )}

      {/* Parts */}
      <div className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-text-strong">{t('partsTitle')}</h3>
            <p className="text-sm text-text-muted">{t('partsHint')}</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setTarget({ kind: 'part' })}>
            {t('addPart')}
          </Button>
        </div>
        {parts.length === 0 ? (
          <p className="text-sm text-text-muted">{t('noParts')}</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {parts.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border-subtle bg-surface-card px-3 py-2"
              >
                <span className="text-sm font-medium text-text-strong">
                  {p.name}
                  {p.estFilamentQty ? (
                    <span className="ml-2 font-mono text-xs text-text-muted">
                      {t('estBadge', { qty: p.estFilamentQty })}
                    </span>
                  ) : null}
                  {p.modelObjectName ? (
                    <span className="ml-2 font-mono text-xs text-accent-teal">
                      {t('objectBadge', { name: p.modelObjectName })}
                    </span>
                  ) : null}
                </span>
                <RowActions
                  onEdit={() => setTarget({ kind: 'part', part: p })}
                  onDelete={() => runDelete(() => deletePart(productId, p.id))}
                  pending={pending}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Colours, grouped by part */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-semibold text-text-strong">{t('colorsTitle')}</h3>
          <Button size="sm" onClick={() => setTarget({ kind: 'color' })}>
            {t('addColor')}
          </Button>
        </div>
        {groups.map((g) => (
          <section key={g.part?.id ?? 'flat'} className="flex flex-col gap-1.5">
            {parts.length > 0 && (
              <h4 className="font-mono text-xs uppercase tracking-wide text-text-muted">
                {g.part ? g.part.name : t('flatGroup')}
              </h4>
            )}
            {g.colors.length === 0 ? (
              <p className="text-sm text-text-muted">{t('noColorsInGroup')}</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {g.colors.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border-subtle bg-surface-card px-3 py-2"
                  >
                    <span className="flex min-w-0 flex-wrap items-center gap-2">
                      <Swatch hex={c.hex} />
                      <span className="truncate text-sm font-medium text-text-strong">
                        {c.name}
                      </span>
                      {c.priceDelta > 0 && <Badge tone="neutral">+{formatVnd(c.priceDelta)}</Badge>}
                      {!c.available && <Badge tone="danger">{t('unavailable')}</Badge>}
                      {filamentName(c.filamentMaterialId) && (
                        <span className="truncate font-mono text-xs text-text-muted">
                          {filamentName(c.filamentMaterialId)}
                        </span>
                      )}
                    </span>
                    <RowActions
                      onEdit={() => setTarget({ kind: 'color', color: c })}
                      onDelete={() => runDelete(() => deleteColor(productId, c.id))}
                      pending={pending}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>

      {target && (
        <ProductColorDialog
          productId={productId}
          target={target}
          parts={parts}
          filaments={filaments}
          modelObjectNames={modelObjectNames}
          model3dStructuredUrl={model3dStructuredUrl}
          partCount={parts.length}
          onClose={() => setTarget(null)}
        />
      )}
    </div>
  );
}

/** A small colour chip; hex is required + server-validated (regex), so it always renders. */
function Swatch({ hex }: { hex: string }) {
  return (
    <span
      aria-hidden="true"
      className="h-4 w-4 shrink-0 rounded border border-border-strong"
      style={{ backgroundColor: hex }}
    />
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
  const t = useTranslations('products.edit.colors');
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
