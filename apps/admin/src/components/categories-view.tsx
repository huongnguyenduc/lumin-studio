'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button, Card, Input } from '@lumin/ui';
import type { components } from '@lumin/api-client';
import {
  createCategory,
  deleteCategory,
  updateCategory,
  type CategoryWriteCode,
} from '@/lib/categories-actions';
import { slugify, validateCategoryInput } from '@/lib/categories-form';

type AdminCategory = components['schemas']['AdminCategory'];

// "Danh mục" (/danh-muc, P3-o slice o-1b): the admin taxonomy manager — list every category with its product
// count, plus create/rename/delete. Owner-only at the server (a staff write collapses to `forbidden` here;
// the FE has no /auth/me yet so it optimistically shows the controls — the server is the wall). A category
// still holding products can't be deleted (409 → `inUse`), so the row disables delete and steers to reassign.
// router.refresh() after each write re-reads the RSC list.

/** Dialog state: closed, adding, or editing a specific category. */
type Editing = null | { mode: 'add' } | { mode: 'edit'; category: AdminCategory };

export function CategoriesView({ categories }: { categories: AdminCategory[] }) {
  const t = useTranslations('categories');
  const [editing, setEditing] = useState<Editing>(null);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-text-strong">{t('title')}</h1>
          <p className="mt-1 text-sm text-text-muted">{t('subtitle')}</p>
        </div>
        <Button onClick={() => setEditing({ mode: 'add' })}>{t('add')}</Button>
      </div>

      {categories.length === 0 ? (
        <Card elevation="md" className="flex flex-col items-center gap-4 px-5 py-16 text-center">
          <p className="text-text-muted">{t('empty')}</p>
          <Button onClick={() => setEditing({ mode: 'add' })}>{t('emptyCta')}</Button>
        </Card>
      ) : (
        <Card elevation="md" className="p-0">
          <ul className="divide-y divide-border-subtle">
            {categories.map((c) => (
              <CategoryRow
                key={c.id}
                category={c}
                onEdit={() => setEditing({ mode: 'edit', category: c })}
              />
            ))}
          </ul>
        </Card>
      )}

      {editing && (
        <CategoryDialog
          mode={editing.mode}
          category={editing.mode === 'edit' ? editing.category : undefined}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function CategoryRow({ category, onEdit }: { category: AdminCategory; onEdit: () => void }) {
  const t = useTranslations('categories');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<CategoryWriteCode | null>(null);
  const hasProducts = category.productCount > 0;

  function remove() {
    setError(null);
    startTransition(async () => {
      const res = await deleteCategory(category.id);
      if (res.ok) {
        router.refresh();
      } else {
        setConfirming(false);
        setError(res.code);
      }
    });
  }

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate font-display font-semibold text-text-strong">{category.name}</p>
        <p className="truncate font-mono text-xs text-text-muted">/{category.slug}</p>
      </div>

      <span className="shrink-0 rounded-pill bg-surface-sunken px-2.5 py-0.5 text-xs text-text-muted">
        {t('productCount', { count: category.productCount })}
      </span>

      <div className="flex shrink-0 items-center gap-2">
        {confirming ? (
          <>
            <span className="text-sm text-text-muted">{t('deleteConfirm')}</span>
            <button
              type="button"
              onClick={remove}
              disabled={pending}
              className="min-h-[44px] rounded-pill px-3 text-sm font-semibold text-danger hover:bg-danger/5"
            >
              {pending ? t('saving') : t('deleteConfirmYes')}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={pending}
              className="min-h-[44px] rounded-pill px-3 text-sm text-text-muted hover:bg-surface-sunken"
            >
              {t('deleteConfirmNo')}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={onEdit}
              className="min-h-[44px] rounded-pill px-3 text-sm text-text-body hover:bg-surface-sunken"
            >
              {t('rename')}
            </button>
            {hasProducts ? (
              // A category still referenced by a product can't be hard-deleted (409). Steer to reassign
              // instead of offering a delete that always fails — the server 409 remains the wall for races.
              <span className="text-xs text-text-muted">{t('deleteBlocked')}</span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="min-h-[44px] rounded-pill px-3 text-sm text-danger hover:bg-danger/5"
              >
                {t('delete')}
              </button>
            )}
          </>
        )}
      </div>

      {error && (
        <p role="alert" className="w-full text-sm text-danger">
          {t(`formError.${error}`)}
        </p>
      )}
    </li>
  );
}

function CategoryDialog({
  mode,
  category,
  onClose,
}: {
  mode: 'add' | 'edit';
  category?: AdminCategory;
  onClose: () => void;
}) {
  const t = useTranslations('categories');
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(category?.name ?? '');
  const [slug, setSlug] = useState(category?.slug ?? '');
  const [attempted, setAttempted] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<CategoryWriteCode | null>(null);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const fieldErrors = validateCategoryInput({ name, slug });

  function submit() {
    setAttempted(true);
    setError(null);
    if (Object.keys(fieldErrors).length > 0) return;
    startTransition(async () => {
      const input = { name: name.trim(), slug: slug.trim() };
      const res =
        mode === 'edit' && category
          ? await updateCategory(category.id, input)
          : await createCategory(input);
      if (res.ok) {
        router.refresh();
        onClose();
      } else {
        setError(res.code);
      }
    });
  }

  const titleId = 'category-dialog-title';
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
          submit();
        }}
        className="flex flex-col gap-4 p-6"
      >
        <h2 id={titleId} className="font-display text-xl font-semibold text-text-strong">
          {mode === 'edit' ? t('editTitle') : t('addTitle')}
        </h2>

        <Input
          label={t('nameLabel')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('namePlaceholder')}
          autoComplete="off"
          error={attempted && fieldErrors.name ? t(`err.${fieldErrors.name}`) : undefined}
        />

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

        {error && (
          <p role="alert" className="text-sm text-danger">
            {t(`formError.${error}`)}
          </p>
        )}

        <div className="mt-1 flex justify-end gap-3">
          <Button variant="outline" onClick={onClose} disabled={pending}>
            {t('cancel')}
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? t('saving') : t('save')}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
