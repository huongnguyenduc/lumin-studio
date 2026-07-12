'use client';

import { useMemo, useState, useTransition, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { formatVnd } from '@lumin/core';
import { Button, Card, Input, cn } from '@lumin/ui';
import type { components } from '@lumin/api-client';
import {
  MATERIALS,
  PRODUCT_STATUSES,
  emptyDraft,
  draftFromProduct,
  draftToInput,
  validateDraft,
  slugify,
  serverFieldErrors,
  type ProductDraft,
  type ProductFieldErrors,
} from '@/lib/product-form';
import { parseIntField } from '@/lib/materials';
import { createProduct, updateProduct, deleteProduct, type WriteCode } from '@/lib/product-actions';
import { ProductGallery } from './product-gallery';
import { ProductModel } from './product-model';
import { ProductColors } from './product-colors';
import { ProductOptions } from './product-options';

type Product = components['schemas']['Product'];
type Category = components['schemas']['Category'];
type FilamentMaterial = components['schemas']['FilamentMaterial'];

/**
 * The core product editor (P3-l l-1) — fills the two seams the P3-k list left (card → /san-pham/{id},
 * "+ Thêm" → /san-pham/moi). Create collects the core fields → POST → redirect to the edit route (where
 * colors/options/model become editable in later slices, ADR grain: product is the aggregate root, sub-
 * resources need an id). Edit PATCHes and router.refresh()es. Client validation mirrors the BE and nudges
 * early; the server is the wall (a duplicate slug etc. comes back as a per-field 400). Owner-gated at the
 * server — the FE shows the actions optimistically (P3-e ROLE precedent; no /auth/me until P3-q).
 */
export function ProductEditor({
  product,
  categories,
  filaments = [],
}: {
  product?: Product;
  categories: Category[];
  filaments?: FilamentMaterial[];
}) {
  const t = useTranslations('products');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const isEdit = !!product;

  const [draft, setDraft] = useState<ProductDraft>(() =>
    product ? draftFromProduct(product) : emptyDraft(categories[0]?.id ?? ''),
  );
  const [errors, setErrors] = useState<ProductFieldErrors>({});
  const [formError, setFormError] = useState<WriteCode | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // /categories only lists categories that have an active product (plan §6), so when editing keep the
  // product's own category selectable even if it isn't in the list.
  const categoryOptions = useMemo(() => {
    if (product && !categories.some((c) => c.id === product.categoryId)) {
      return [{ id: product.categoryId, slug: '', name: t('edit.currentCategory') }, ...categories];
    }
    return categories;
  }, [categories, product, t]);

  function set<K extends keyof ProductDraft>(key: K, value: ProductDraft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));
    setSaved(false);
  }

  function fieldError(key: keyof ProductDraft): string | undefined {
    const code = errors[key];
    return code ? t(`edit.err.${code}`) : undefined;
  }

  function onSave() {
    const found = validateDraft(draft);
    setErrors(found);
    setFormError(null);
    setSaved(false);
    if (Object.keys(found).length > 0) return;
    const input = draftToInput(draft);
    startTransition(async () => {
      const res = isEdit ? await updateProduct(product.id, input) : await createProduct(input);
      if (res.ok) {
        if (isEdit) {
          setSaved(true);
          router.refresh();
        } else {
          router.push(`/san-pham/${res.id}`);
        }
        return;
      }
      if (res.fields) setErrors(serverFieldErrors(res.fields));
      setFormError(res.code);
    });
  }

  function onDelete() {
    setFormError(null);
    startTransition(async () => {
      const res = await deleteProduct(product!.id);
      if (res.ok) router.push('/san-pham');
      else {
        setConfirmingDelete(false);
        setFormError(res.code);
      }
    });
  }

  const basePriceInt = parseIntField(draft.basePrice);

  return (
    <div className="flex max-w-2xl flex-col gap-6 pb-24 md:pb-6">
      {/* Header: back + title + save */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            href="/san-pham"
            className="rounded-pill px-2 py-1 font-semibold text-text-body hover:text-text-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2"
          >
            {t('edit.back')}
          </Link>
          <h1 className="font-display text-2xl font-semibold text-text-strong">
            {isEdit ? t('edit.titleEdit', { name: product.name }) : t('edit.titleNew')}
          </h1>
        </div>
        <Button onClick={onSave} disabled={pending}>
          {t('edit.save')}
        </Button>
      </div>

      {/* Feedback line */}
      {saved && (
        <p role="status" className="text-sm text-accent-teal">
          {t('edit.saved')}
        </p>
      )}
      {formError && (
        <p role="alert" className="text-sm text-danger">
          {t(`edit.formError.${formError}`)}
        </p>
      )}

      {/* Thông tin */}
      <Card elevation="md" className="flex flex-col gap-4 px-5 py-5">
        <h2 className="font-semibold text-text-strong">{t('edit.sectionInfo')}</h2>
        <Input
          label={t('edit.nameLabel')}
          value={draft.name}
          onChange={(e) => set('name', e.target.value)}
          error={fieldError('name')}
          autoComplete="off"
        />
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Input
              label={t('edit.slugLabel')}
              hint={t('edit.slugHint')}
              value={draft.slug}
              onChange={(e) => set('slug', e.target.value)}
              error={fieldError('slug')}
              autoComplete="off"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => set('slug', slugify(draft.name))}
            disabled={draft.name.trim() === ''}
          >
            {t('edit.slugFromName')}
          </Button>
        </div>
        <TextArea
          label={t('edit.descLabel')}
          value={draft.description}
          onChange={(v) => set('description', v)}
          error={fieldError('description')}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label={t('edit.categoryLabel')}
            value={draft.categoryId}
            onChange={(v) => set('categoryId', v)}
            error={fieldError('categoryId')}
          >
            <option value="" disabled>
              {t('edit.categoryPlaceholder')}
            </option>
            {categoryOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Select
            label={t('edit.statusLabel')}
            value={draft.status}
            onChange={(v) => set('status', v as ProductDraft['status'])}
          >
            {PRODUCT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`status.${s}`)}
              </option>
            ))}
          </Select>
        </div>
      </Card>

      {/* Giá & quy cách */}
      <Card elevation="md" className="flex flex-col gap-4 px-5 py-5">
        <h2 className="font-semibold text-text-strong">{t('edit.sectionSpec')}</h2>
        <Input
          label={t('edit.priceLabel')}
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          value={draft.basePrice}
          onChange={(e) => set('basePrice', e.target.value)}
          error={fieldError('basePrice')}
          hint={basePriceInt !== null ? formatVnd(basePriceInt) : t('edit.vndHint')}
          autoComplete="off"
        />
        <fieldset>
          <legend className="mb-1.5 font-display text-sm font-medium text-text-strong">
            {t('edit.dimsLabel')}
          </legend>
          <div className="grid grid-cols-3 gap-3">
            {(['dimW', 'dimD', 'dimH'] as const).map((key) => (
              <Input
                key={key}
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                aria-label={t(`edit.${key}`)}
                placeholder={t(`edit.${key}`)}
                value={draft[key]}
                onChange={(e) => set(key, e.target.value)}
                error={errors[key] ? t(`edit.err.${errors[key]}`) : undefined}
                autoComplete="off"
              />
            ))}
          </div>
        </fieldset>
        <Select
          label={t('edit.materialLabel')}
          value={draft.material}
          onChange={(v) => set('material', v)}
          error={fieldError('material')}
        >
          {MATERIALS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </Select>
      </Card>

      {/* Colours & parts (edit only — per-row sub-resources keyed by product id). ADR-037 two-tone: named
          parts group the colours; a colour can link to a shop filament (ADR-039) for deduct-on-print. */}
      {isEdit && (
        <Card elevation="md" className="flex flex-col gap-4 px-5 py-5">
          <div>
            <h2 className="font-semibold text-text-strong">{t('edit.sectionColors')}</h2>
            <p className="mt-0.5 text-sm text-text-muted">{t('edit.colorsHint')}</p>
          </div>
          <ProductColors
            productId={product.id}
            parts={product.parts}
            colors={product.colors}
            filaments={filaments}
          />
        </Card>
      )}

      {/* Customization options (edit only — per-row sub-resources). A text option = engraving field with a
          char limit; a choice option owns enumerated choices (ADR-037). */}
      {isEdit && (
        <Card elevation="md" className="flex flex-col gap-4 px-5 py-5">
          <div>
            <h2 className="font-semibold text-text-strong">{t('edit.sectionOptions')}</h2>
            <p className="mt-0.5 text-sm text-text-muted">{t('edit.optionsHint')}</p>
          </div>
          <ProductOptions productId={product.id} options={product.options} />
        </Card>
      )}

      {/* Media (edit only — model-upload/asset-jobs are keyed by an existing product id; create is core-
          only → redirect → edit here). Gallery is a Product field (saves with "Lưu sản phẩm"); the model
          upload enqueues its render jobs immediately. */}
      {isEdit && (
        <>
          <Card elevation="md" className="flex flex-col gap-4 px-5 py-5">
            <div>
              <h2 className="font-semibold text-text-strong">{t('edit.sectionGallery')}</h2>
              <p className="mt-0.5 text-sm text-text-muted">{t('edit.galleryHint')}</p>
            </div>
            <ProductGallery images={draft.images} onChange={(next) => set('images', next)} />
          </Card>
          <Card elevation="md" className="flex flex-col gap-4 px-5 py-5">
            <div>
              <h2 className="font-semibold text-text-strong">{t('edit.sectionModel')}</h2>
              <p className="mt-0.5 text-sm text-text-muted">{t('edit.modelHint')}</p>
            </div>
            <ProductModel productId={product.id} model3dUrl={product.model3dUrl} />
          </Card>
        </>
      )}

      {/* Delete (edit only) — two-step confirm, no blocking browser dialog */}
      {isEdit && (
        <Card elevation="md" className="flex flex-wrap items-center gap-3 px-5 py-4">
          <div className="mr-auto">
            <p className="font-semibold text-text-strong">{t('edit.deleteTitle')}</p>
            <p className="text-sm text-text-muted">{t('edit.deleteHint')}</p>
          </div>
          {confirmingDelete ? (
            <>
              <Button
                variant="outline"
                onClick={() => setConfirmingDelete(false)}
                disabled={pending}
              >
                {t('edit.deleteCancel')}
              </Button>
              <button
                type="button"
                onClick={onDelete}
                disabled={pending}
                className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-danger px-4 py-2 text-sm font-semibold text-danger hover:bg-danger hover:text-on-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2 disabled:opacity-60"
              >
                {t('edit.deleteConfirm')}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              disabled={pending}
              className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-border-strong px-4 py-2 text-sm font-semibold text-text-body hover:border-danger hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2"
            >
              {t('edit.delete')}
            </button>
          )}
        </Card>
      )}
    </div>
  );
}

// Local token-styled select (no @lumin/ui Select primitive) — matches the materials-dialog select. Label
// wired via htmlFor; error text with role=alert. ponytail: third consumer → extract to @lumin/ui.
function Select({
  label,
  value,
  onChange,
  error,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-display text-sm font-medium text-text-strong">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        className={cn(
          'h-11 rounded-md border bg-surface-card px-3 text-base text-text-body focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2',
          error ? 'border-danger' : 'border-border-default',
        )}
      >
        {children}
      </select>
      {error && (
        <span role="alert" className="text-sm text-danger">
          {error}
        </span>
      )}
    </label>
  );
}

// Local token-styled textarea (no @lumin/ui Textarea primitive). Label wired; error with role=alert.
function TextArea({
  label,
  value,
  onChange,
  error,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-display text-sm font-medium text-text-strong">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        aria-invalid={error ? true : undefined}
        className={cn(
          'min-h-24 rounded-md border bg-surface-card px-3 py-2 text-base leading-relaxed text-text-body focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2',
          error ? 'border-danger' : 'border-border-default',
        )}
      />
      {error && (
        <span role="alert" className="text-sm text-danger">
          {error}
        </span>
      )}
    </label>
  );
}
