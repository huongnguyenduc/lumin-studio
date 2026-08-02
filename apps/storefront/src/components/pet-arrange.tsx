'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { PetPageProfile } from '@/lib/pet-page';
import {
  type Block,
  type BlockType,
  moveContentBlock,
  normalizeBlocks,
  PHOTO_NAME,
  toggleBlockVisible,
} from '@/lib/pet-blocks';
import { themeFormFrom, themeToWire } from '@/lib/pet-theme';
import { updatePetAppearance } from '@/lib/pet-actions';

// The owner's "sắp xếp khối" mode (spec §10 §5b, P3-t t-4c-2) — a separate mode from the in-place editor so
// "1 chạm = 1 việc": here the owner reorders (drag ⠿, OR the ▲▼ keyboard/AT fallback) and shows/hides
// content blocks, never edits content. Drag uses @dnd-kit (already a repo dependency via apps/admin's print
// board) so the ⠿ handle finally does what the design promises instead of being decorative; the ▲▼ buttons
// stay as the accessible, touch-reliable path (moveContentBlock is the SAME reducer both call — one
// implementation of "reorder", not two that could drift). The photo_name (ảnh & tên) block is fixed on top
// and can't be hidden or dragged. Save sends the FULL appearance (the unchanged theme passes through) to
// the owner-guarded PATCH, then router.refresh()es the re-ordered page.

const HANDLE = '⠿';
const UP = '▲';
const DOWN = '▼';
const CLOSE = '✕';
const BLOCK_ICON: Record<BlockType, string> = {
  photo_name: '🖼️',
  bio: '📝',
  gallery: '📷',
  favorites: '🧀',
  medical: '🩺',
  socials: '🔗',
};

export function PetArrange({ shortId, profile }: { shortId: string; profile: PetPageProfile }) {
  const t = useTranslations('petTag.page.arrange');
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-2xl border-2 border-border-strong bg-surface-card px-4 font-display font-bold text-text-strong shadow-pop"
      >
        <span aria-hidden="true">{HANDLE}</span> {t('button')}
      </button>
    );
  }
  return (
    <ArrangePanel
      shortId={shortId}
      profile={profile}
      onClose={() => setOpen(false)}
      onSaved={() => setOpen(false)}
    />
  );
}

function ArrangePanel({
  shortId,
  profile,
  onClose,
  onSaved,
}: {
  shortId: string;
  profile: PetPageProfile;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('petTag.page.arrange');
  const router = useRouter();
  const [blocks, setBlocks] = useState<Block[]>(() => normalizeBlocks(profile.blocks));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  const content = blocks.filter((b) => b.type !== PHOTO_NAME);

  // Touch needs the SAME 200ms-hold PointerSensor delay the admin print board uses (a plain swipe must
  // still scroll the panel), plus KeyboardSensor so arrow keys can reorder via the sortable handle too —
  // on top of, not instead of, the explicit ▲▼ buttons below.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = content.findIndex((b) => b.type === active.id);
    const to = content.findIndex((b) => b.type === over.id);
    if (from === -1 || to === -1) return;
    // moveContentBlock only swaps ONE adjacent step — reuse it in a loop for a multi-step drag rather
    // than writing a second reorder algorithm that could drift from the ▲▼ buttons' behavior.
    setBlocks((bs) => {
      let next = bs;
      let i = from;
      const dir = to > from ? 1 : -1;
      while (i !== to) {
        next = moveContentBlock(next, i, dir);
        i += dir;
      }
      return next;
    });
  };

  const onSave = async () => {
    setSaving(true);
    setError(null);
    const res = await updatePetAppearance(shortId, {
      // The theme is unchanged here — pass it through so the full-replace write keeps it.
      theme: themeToWire(themeFormFrom(profile.theme)),
      blocks: blocks.map((b) => ({ type: b.type, order: b.order, visible: b.visible })),
    });
    setSaving(false);
    if (res.ok) {
      onSaved();
      router.refresh();
      return;
    }
    setError(
      t(
        `error.${res.code === 'forbidden' ? 'forbidden' : res.code === 'unauthenticated' ? 'session' : 'saveFailed'}`,
      ),
    );
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('title')}
      className="fixed inset-0 z-50 overflow-y-auto bg-surface-page"
    >
      <div className="mx-auto flex min-h-full w-full max-w-[420px] flex-col">
        <div className="sticky top-0 z-10 flex items-center gap-3 border-b-2 border-border-strong bg-surface-card px-4 py-2.5">
          <button
            type="button"
            onClick={onClose}
            aria-label={t('cancel')}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center text-xl text-text-strong"
          >
            {CLOSE}
          </button>
          <span className="flex-1 font-display text-base font-bold text-text-strong">
            {t('title')}
          </span>
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="inline-flex min-h-[44px] items-center rounded-xl bg-primary px-4 font-display font-bold text-on-primary disabled:opacity-60"
          >
            {saving ? t('saving') : t('done')}
          </button>
        </div>

        <div className="flex flex-col gap-2.5 px-4 py-4">
          <p className="font-mono text-[11px] leading-relaxed text-text-muted">{t('hint')}</p>
          {/* Note: hiding the medical block only hides it at home — pet-page.tsx force-shows the allergy
              warning whenever the pet is lost (safety overrides the owner's hide), so a finder always sees it. */}

          {/* photo_name — fixed header, can't move or hide */}
          <div className="flex items-center gap-3 rounded-2xl border border-border-default bg-surface-sunken px-3 py-3">
            <span aria-hidden="true" className="text-text-subtle">
              {HANDLE}
            </span>
            <span aria-hidden="true" className="text-base">
              {BLOCK_ICON.photo_name}
            </span>
            <span className="flex-1 text-sm text-text-body">{t('block.photo_name')}</span>
            <span className="rounded-pill border border-border-default bg-surface-card px-2.5 py-0.5 font-mono text-[10px] text-text-muted">
              {t('fixed')}
            </span>
          </div>

          <DndContext sensors={sensors} onDragEnd={onDragEnd}>
            <SortableContext
              items={content.map((b) => b.type)}
              strategy={verticalListSortingStrategy}
            >
              {content.map((b, i) => (
                <SortableRow
                  key={b.type}
                  id={b.type}
                  visible={b.visible}
                  reduced={reduced}
                  dragLabel={t('dragHandle', { block: t(`block.${b.type}`) })}
                >
                  <span aria-hidden="true" className="text-base">
                    {BLOCK_ICON[b.type]}
                  </span>
                  <span className="flex-1 text-sm text-text-strong">
                    {t(`block.${b.type}`)}
                    {!b.visible && (
                      <span className="ml-1.5 font-mono text-[10px] text-text-muted">
                        {t('hidden')}
                      </span>
                    )}
                  </span>
                  <div className="flex items-center gap-1">
                    <MoveButton
                      label={t('moveUp', { block: t(`block.${b.type}`) })}
                      glyph={UP}
                      disabled={i === 0}
                      onClick={() => setBlocks((bs) => moveContentBlock(bs, i, -1))}
                    />
                    <MoveButton
                      label={t('moveDown', { block: t(`block.${b.type}`) })}
                      glyph={DOWN}
                      disabled={i === content.length - 1}
                      onClick={() => setBlocks((bs) => moveContentBlock(bs, i, 1))}
                    />
                    <VisibleToggle
                      on={b.visible}
                      label={t(b.visible ? 'hide' : 'show', { block: t(`block.${b.type}`) })}
                      onClick={() => setBlocks((bs) => toggleBlockVisible(bs, b.type))}
                    />
                  </div>
                </SortableRow>
              ))}
            </SortableContext>
          </DndContext>

          {error && (
            <p role="alert" className="text-center text-sm text-danger">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// MoveButton — a compact ▲/▼ reorder control (a11y + mobile-friendly alternative to native drag, which
// touch handles poorly). ponytail: up/down + a fixed header beats pulling in a drag-and-drop dep.
// SortableRow — one draggable content-block row. The ⠿ glyph is the ACTUAL drag handle now (was purely
// decorative before this PR — a real affordance lie, since the design promises drag). `touch-action: none`
// on the handle only (not the whole row) so the row's ▲▼/switch controls stay normal touch targets and the
// panel itself still scrolls from anywhere else.
function SortableRow({
  id,
  visible,
  reduced,
  dragLabel,
  children,
}: {
  id: BlockType;
  visible: boolean;
  reduced: boolean;
  dragLabel: string;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition: reduced ? undefined : transition,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2.5 rounded-2xl border-2 border-border-strong px-3 py-3 shadow-pop ${
        visible ? 'bg-surface-card' : 'bg-surface-sunken opacity-70'
      } ${isDragging ? 'opacity-60' : ''}`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={dragLabel}
        className="cursor-grab touch-none text-text-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky active:cursor-grabbing"
      >
        {HANDLE}
      </button>
      {children}
    </div>
  );
}

function MoveButton({
  label,
  glyph,
  disabled,
  onClick,
}: {
  label: string;
  glyph: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-border-strong bg-surface-card text-[10px] text-text-strong disabled:opacity-30"
    >
      {glyph}
    </button>
  );
}

// VisibleToggle — a switch that shows/hides a content block (role=switch for AT). Teal-on when visible.
function VisibleToggle({
  on,
  label,
  onClick,
}: {
  on: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onClick}
      className="ml-1 flex min-h-[44px] w-11 shrink-0 items-center"
    >
      {/* 44px tap target (a11y); the visual track is the 24px pill centred inside it. */}
      <span
        aria-hidden="true"
        className={`relative h-6 w-11 rounded-full border-2 ${
          on ? 'border-accent-teal bg-accent-teal' : 'border-border-default bg-surface-sunken'
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-surface-card transition-[left] ${
            on ? 'left-[22px]' : 'left-0.5'
          }`}
        />
      </span>
    </button>
  );
}
