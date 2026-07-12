'use client';

import { useEffect, useRef, useState, useTransition, type ChangeEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button, Card, Input, Switch } from '@lumin/ui';
import type { components } from '@lumin/api-client';
import { GripIcon } from './icons';
import {
  createCategory,
  deleteCategory,
  reorderCategories,
  updateCategory,
  type CategoryWriteCode,
} from '@/lib/categories-actions';
import { slugify, validateCategoryInput } from '@/lib/categories-form';
import { uploadProofFile, type UploadError } from '@/lib/upload-proof';

type AdminCategory = components['schemas']['AdminCategory'];

// "Danh mục" (/danh-muc, P3-o slice o-2): the admin taxonomy manager — "sắp xếp menu khách thấy". The list
// (left) is drag-reorderable (⠿ handle, @dnd-kit sortable) with a per-row visibility toggle + thumbnail +
// product count; the edit panel (right) adds/edits a category's name, short description, cover image, and
// visibility. Every write is owner-only at the server (a staff attempt collapses to `forbidden`; the FE has
// no /auth/me yet so it optimistically shows the controls — the server is the wall). Ordering (display_order)
// and the customer-menu visibility both flow to the storefront GetCategories. router.refresh() re-reads the
// RSC list after every write.

export function CategoriesView({ categories }: { categories: AdminCategory[] }) {
  const t = useTranslations('categories');
  const router = useRouter();
  const [items, setItems] = useState(categories);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [, startReorder] = useTransition();
  const [reduced, setReduced] = useState(false);

  // Re-sync from the server list after any router.refresh() (create/edit/delete/reorder all re-read).
  useEffect(() => setItems(categories), [categories]);

  // prefers-reduced-motion → kill the sortable drop-settle animation (the drag still translates; only the
  // decorative settle is suppressed). Mirrors print-board.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  // Pointer: an 8px move starts a drag (a plain click still selects). Keyboard: focus the handle and use the
  // arrow keys to reorder (a11y — no mouse required).
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const selected = adding ? null : (items.find((c) => c.id === selectedId) ?? null);

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex((c) => c.id === active.id);
    const newIndex = items.findIndex((c) => c.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(items, oldIndex, newIndex);
    setItems(next); // optimistic — the row moves immediately
    startReorder(async () => {
      const res = await reorderCategories(next.map((c) => c.id));
      if (!res.ok) router.refresh(); // persist failed → re-read the true server order
    });
  }

  function startAdd() {
    setAdding(true);
    setSelectedId(null);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-text-strong">
            {t('title')} <span className="font-mono text-sm text-text-muted">· {items.length}</span>
          </h1>
          <p className="mt-1 max-w-prose text-sm text-text-muted">{t('reorderHint')}</p>
        </div>
        <Button onClick={startAdd}>{t('add')}</Button>
      </div>

      {items.length === 0 && !adding ? (
        <Card elevation="md" className="flex flex-col items-center gap-4 px-5 py-16 text-center">
          <p className="text-text-muted">{t('empty')}</p>
          <Button onClick={startAdd}>{t('emptyCta')}</Button>
        </Card>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[1.6fr_1fr]">
          <Card elevation="md" className="overflow-hidden p-0">
            <div className="flex items-center gap-3 border-b border-border-subtle bg-surface-sunken px-4 py-2 font-mono text-[0.65rem] uppercase tracking-wide text-text-muted">
              <span className="w-5" aria-hidden />
              <span className="w-10">{t('colImage')}</span>
              <span className="flex-1">{t('colName')}</span>
              <span className="w-20 text-right">{t('colProducts')}</span>
              <span className="w-14 text-right">{t('colVisible')}</span>
            </div>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext
                items={items.map((c) => c.id)}
                strategy={verticalListSortingStrategy}
              >
                <ul className="divide-y divide-border-subtle">
                  {items.map((c) => (
                    <SortableRow
                      key={c.id}
                      category={c}
                      selected={!adding && c.id === selectedId}
                      reduced={reduced}
                      onSelect={() => {
                        setSelectedId(c.id);
                        setAdding(false);
                      }}
                      onRefresh={() => router.refresh()}
                    />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
          </Card>

          {adding || selected ? (
            <CategoryEditPanel
              key={adding ? 'add' : selected!.id}
              mode={adding ? 'add' : 'edit'}
              category={selected ?? undefined}
              onDone={() => {
                setAdding(false);
                router.refresh();
              }}
              onCancel={() => setAdding(false)}
            />
          ) : (
            <Card elevation="md" className="px-5 py-10 text-center text-sm text-text-muted">
              {t('selectPrompt')}
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

/** One draggable list row: ⠿ handle · thumbnail · name (click to edit) · product count · visibility toggle. */
function SortableRow({
  category,
  selected,
  reduced,
  onSelect,
  onRefresh,
}: {
  category: AdminCategory;
  selected: boolean;
  reduced: boolean;
  onSelect: () => void;
  onRefresh: () => void;
}) {
  const t = useTranslations('categories');
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: category.id,
  });
  const [pending, startVisibility] = useTransition();

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: reduced ? undefined : transition,
  };

  // Flip visibility inline (immediate PATCH). The row carries every editable field, so it re-sends a full
  // CategoryUpdate with `visible` toggled — displayOrder is untouched by the edit endpoint.
  function toggleVisible() {
    startVisibility(async () => {
      const res = await updateCategory(category.id, {
        slug: category.slug,
        name: category.name,
        description: category.description,
        imageUrl: category.imageUrl,
        visible: !category.visible,
      });
      if (res.ok) onRefresh();
    });
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 px-4 py-2.5 ${isDragging ? 'relative z-10 bg-surface-card shadow-pop' : ''} ${
        selected ? 'bg-primary/5' : ''
      } ${category.visible ? '' : 'opacity-60'}`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={t('dragHandle', { name: category.name })}
        className="flex h-11 w-5 shrink-0 cursor-grab touch-none items-center justify-center text-text-muted hover:text-text-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky"
      >
        <GripIcon className="h-4 w-4" />
      </button>

      <span className="h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-border-subtle bg-surface-sunken">
        {category.imageUrl ? (
          <img src={category.imageUrl} alt="" className="h-full w-full object-cover" />
        ) : null}
      </span>

      <button
        type="button"
        onClick={onSelect}
        className="min-w-0 flex-1 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky"
      >
        <span className="block truncate font-display font-semibold text-text-strong">
          {category.name}
        </span>
        <span className="block truncate font-mono text-xs text-text-muted">/{category.slug}</span>
      </button>

      <span className="w-20 shrink-0 text-right font-mono text-xs text-text-muted">
        {t('productCount', { count: category.productCount })}
      </span>

      <span className="flex w-14 shrink-0 justify-end">
        <Switch
          checked={category.visible}
          onCheckedChange={toggleVisible}
          disabled={pending}
          label={t(category.visible ? 'hideRow' : 'showRow', { name: category.name })}
        />
      </span>
    </li>
  );
}

/** Add (name + slug) or edit (name + description + cover image + visibility) a category, in the right panel. */
function CategoryEditPanel({
  mode,
  category,
  onDone,
  onCancel,
}: {
  mode: 'add' | 'edit';
  category?: AdminCategory;
  onDone: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations('categories');
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(category?.name ?? '');
  const [slug, setSlug] = useState(category?.slug ?? '');
  const [description, setDescription] = useState(category?.description ?? '');
  const [imageUrl, setImageUrl] = useState(category?.imageUrl ?? '');
  const [visible, setVisible] = useState(category?.visible ?? true);
  const [attempted, setAttempted] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [pending, startTransition] = useTransition();
  const [uploading, startUpload] = useTransition();
  const [uploadError, setUploadError] = useState<UploadError | null>(null);
  const [error, setError] = useState<CategoryWriteCode | null>(null);

  const isEdit = mode === 'edit';
  // Add validates name + slug; edit validates name + description (slug is preserved, not edited here).
  const fieldErrors = isEdit
    ? validateCategoryInput({ name, slug: category!.slug, description })
    : validateCategoryInput({ name, slug });

  function onPickImage(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;
    setUploadError(null);
    startUpload(async () => {
      const res = await uploadProofFile(file);
      if (res.ok) setImageUrl(res.url);
      else setUploadError(res.error);
    });
  }

  function submit() {
    setAttempted(true);
    setError(null);
    if (Object.keys(fieldErrors).length > 0) return;
    startTransition(async () => {
      const res = isEdit
        ? await updateCategory(category!.id, {
            slug: category!.slug, // preserved — the edit panel does not re-slug (stable storefront URL)
            name: name.trim(),
            description: description.trim(),
            imageUrl,
            visible,
          })
        : await createCategory({ name: name.trim(), slug: slug.trim() });
      if (res.ok) onDone();
      else setError(res.code);
    });
  }

  function remove() {
    if (!category) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteCategory(category.id);
      if (res.ok) onDone();
      else {
        setConfirmingDelete(false);
        setError(res.code);
      }
    });
  }

  const hasProducts = (category?.productCount ?? 0) > 0;
  const busy = pending || uploading;

  return (
    <Card elevation="md" className="flex flex-col gap-4 p-5">
      <h2 className="font-display text-lg font-semibold text-text-strong">
        {isEdit ? t('editTitle') : t('addTitle')}
      </h2>

      <Input
        label={t('nameLabel')}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t('namePlaceholder')}
        autoComplete="off"
        error={attempted && fieldErrors.name ? t(`err.${fieldErrors.name}`) : undefined}
      />

      {/* Slug: only on ADD (edit keeps the existing slug to avoid breaking storefront URLs). */}
      {!isEdit && (
        <div className="flex flex-col gap-1.5">
          <Input
            label={t('slugLabel')}
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="den-de-ban"
            autoComplete="off"
            inputMode="url"
            error={attempted && fieldErrors.slug ? t(`err.${fieldErrors.slug}`) : undefined}
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-text-muted">{t('slugHint')}</span>
            <button
              type="button"
              onClick={() => setSlug(slugify(name))}
              disabled={name.trim() === ''}
              className="shrink-0 rounded-pill px-2 py-1 text-xs font-medium text-text-body hover:bg-surface-sunken disabled:opacity-50"
            >
              {t('slugFromName')}
            </button>
          </div>
        </div>
      )}

      {/* Description + cover image + visibility: edit only (create is name/slug, then edit for the rest). */}
      {isEdit && (
        <>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="category-description" className="text-sm font-medium text-text-body">
              {t('descLabel')}
            </label>
            <textarea
              id="category-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('descPlaceholder')}
              rows={3}
              className="w-full resize-y rounded-lg border border-border-strong bg-surface-card px-3 py-2 text-sm text-text-body placeholder:text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky"
            />
            {attempted && fieldErrors.description && (
              <span role="alert" className="text-sm text-danger">
                {t(`err.${fieldErrors.description}`)}
              </span>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-text-body">{t('imageLabel')}</span>
            <div className="flex items-center gap-3">
              <span className="h-14 w-[4.5rem] shrink-0 overflow-hidden rounded-lg border border-border-subtle bg-surface-sunken">
                {imageUrl ? (
                  <img src={imageUrl} alt="" className="h-full w-full object-cover" />
                ) : null}
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={onPickImage}
                  className="sr-only"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => imageInputRef.current?.click()}
                  disabled={uploading}
                >
                  {uploading ? t('imageUploading') : imageUrl ? t('imageChange') : t('imageAdd')}
                </Button>
                {imageUrl && (
                  <button
                    type="button"
                    onClick={() => setImageUrl('')}
                    className="min-h-[44px] rounded-pill px-3 text-sm text-text-muted hover:bg-surface-sunken"
                  >
                    {t('imageRemove')}
                  </button>
                )}
              </div>
            </div>
            {uploadError && (
              <span role="alert" className="text-sm text-danger">
                {t(`uploadErr.${uploadError}`)}
              </span>
            )}
          </div>

          <Switch checked={visible} onCheckedChange={setVisible} label={t('visibleLabel')} />

          <p className="font-mono text-xs text-text-muted">
            {t('productsInCategory', { count: category!.productCount })}
          </p>
        </>
      )}

      {error && (
        <p role="alert" className="text-sm text-danger">
          {t(`formError.${error}`)}
        </p>
      )}

      <div className="mt-1 flex items-center justify-between gap-3">
        {/* Delete (edit only) — a category with products can't be hard-deleted (409); steer to reassign. */}
        {isEdit ? (
          hasProducts ? (
            <span className="text-xs text-text-muted">{t('deleteBlocked')}</span>
          ) : confirmingDelete ? (
            <span className="flex items-center gap-2">
              <button
                type="button"
                onClick={remove}
                disabled={busy}
                className="min-h-[44px] rounded-pill px-3 text-sm font-semibold text-danger hover:bg-danger/5"
              >
                {pending ? t('saving') : t('deleteConfirmYes')}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                disabled={busy}
                className="min-h-[44px] rounded-pill px-3 text-sm text-text-muted hover:bg-surface-sunken"
              >
                {t('deleteConfirmNo')}
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              className="min-h-[44px] rounded-pill px-3 text-sm text-danger hover:bg-danger/5"
            >
              {t('delete')}
            </button>
          )
        ) : (
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            {t('cancel')}
          </Button>
        )}

        <Button type="button" onClick={submit} disabled={busy}>
          {pending ? t('saving') : isEdit ? t('save') : t('create')}
        </Button>
      </div>
    </Card>
  );
}
