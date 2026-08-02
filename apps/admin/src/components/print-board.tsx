'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { formatVnDate } from '@lumin/core';
import {
  PRINT_STAGES,
  STAGE_LABEL_KEY,
  groupByStage,
  nextStage,
  mergeCard,
  type PrintCard,
  type PrintStage,
} from '@/lib/print-queue';
import { usePrintStream } from '@/lib/use-print-stream';
import { advancePrintStage } from '@/lib/print-queue-actions';
import { EncodeTagSheet } from '@/components/encode-tag-sheet';

// Per-column chrome. PRINTING is the active column → coral tint + coral border (design "Đang in").
// NFC_ENCODE ("Ghi chip NFC", P3-t t-2) gets a teal accent to stand out as the special tag-only step;
// the rest are calm sunken panels. SHIPPED cards are de-emphasized (terminal on the board).
const COLUMN_TONE: Record<PrintStage, string> = {
  NEED_PRINT: 'border-border-subtle bg-surface-sunken',
  PRINTING: 'border-primary bg-accent-flame-soft',
  NFC_ENCODE: 'border-accent-teal bg-accent-teal-soft',
  PACKING: 'border-border-subtle bg-surface-sunken',
  SHIPPED: 'border-border-subtle bg-surface-sunken',
};

/**
 * The live drag-drop print board (Hàng đợi in, P3-h). Columns = the print stages; a card is dragged
 * (pointer/touch) OR advanced with its "→ next" button (the keyboard/AT/mobile path, D-P3-2). Either way
 * it PATCHes print_jobs.stage — server-side (ADR-057) that ALSO auto-advances the order PAID→PRINTING
 * once every one of its lines has left NEED_PRINT, so a solo shop doesn't have to click twice for the
 * same fact. D6 still holds everywhere else: →SHIPPING (QC-photo/tracking gate), →CANCELLED, →REFUNDED
 * only ever happen through the guarded transition flow on the order-detail screen — a board drag never
 * touches those. The board stays live over SSE with a poll fallback (usePrintStream). Optimistic: the
 * card moves immediately, reconciles to the server card, and reverts on failure.
 */
export function PrintBoard({
  initialCards,
  highlightId,
}: {
  initialCards: PrintCard[];
  highlightId?: string;
}) {
  const t = useTranslations('printQueue');
  const router = useRouter();
  const { cards, setCards, live } = usePrintStream(initialCards);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [encodingCard, setEncodingCard] = useState<PrintCard | null>(null); // NFC-encode sheet (t-2)
  const [highlighted, setHighlighted] = useState(highlightId ?? null); // just-NFC-encoded card (P3-h follow-up)

  // prefers-reduced-motion → kill the drop settle animation (the drag itself must still translate, or
  // the card can't follow the pointer; only the decorative settle is suppressed).
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  // After the NFC-write callback redirects back here (?encoded={jobId}), the card landed in PACKING but
  // isn't necessarily at the top of that column (FIFO by created_at) — staff previously had no signal it
  // worked short of hunting the column. Scroll it into view + flash it briefly, then strip the query param
  // (router.replace, no history entry) so a refresh doesn't re-trigger the flash.
  useEffect(() => {
    if (!highlightId) return;
    const el = document.getElementById(`job-${highlightId}`);
    el?.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
    router.replace('/hang-doi-in');
    const timer = setTimeout(() => setHighlighted(null), 2500);
    return () => clearTimeout(timer);
    // Deliberately empty deps: this must run exactly once, off the FIRST-LOAD highlightId prop — not
    // re-fire if router/reduced happen to change identity later.
  }, []);

  // Mouse: an 8px move starts a drag. Touch: a 200ms press-hold starts one, so an ordinary swipe still
  // scrolls the page (no touch-action:none, which would trap scrolling on a board that fills the
  // screen). Keyboard/AT users use the per-card advance button instead of a drag sensor.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  const columns = useMemo(() => groupByStage(cards), [cards]);
  const activeCard = activeId ? (cards.find((c) => c.id === activeId) ?? null) : null;

  async function advance(id: string, to: PrintStage) {
    const card = cards.find((c) => c.id === id);
    if (!card || card.stage === to) return;
    const from = card.stage;
    setError(false);
    setCards((cs) => cs.map((c) => (c.id === id ? { ...c, stage: to } : c))); // optimistic move
    const res = await advancePrintStage(id, to);
    if (res.ok) {
      setCards((cs) => mergeCard(cs, res.card)); // reconcile with the authoritative card
    } else {
      // Revert only this card's stage (leave concurrent updates to other cards intact) + surface it.
      setCards((cs) => cs.map((c) => (c.id === id ? { ...c, stage: from } : c)));
      setError(true);
    }
  }

  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const to = e.over?.id as PrintStage | undefined;
    if (!to || !PRINT_STAGES.includes(to)) return;
    const card = cards.find((c) => c.id === String(e.active.id));
    if (!card) return;
    // A standard product has no chip — never let it land in the NFC-encode column (that column is
    // nfc_tag-only; the encode action, not a raw drag, is the blessed way through it). Snap it back.
    if (to === 'NFC_ENCODE' && card.productType !== 'nfc_tag') return;
    void advance(String(e.active.id), to);
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-bold text-text-strong">{t('title')}</h1>
          <span className="text-sm text-text-muted">{t('count', { count: cards.length })}</span>
        </div>
        <LiveHint live={live} label={live ? t('live') : t('syncing')} />
      </header>

      {error && (
        <p
          role="alert"
          className="rounded-lg border-2 border-danger bg-danger-soft px-3 py-2 text-sm text-text-strong"
        >
          {t('advanceError')}
        </p>
      )}

      {cards.length === 0 ? (
        <EmptyBoard title={t('emptyTitle')} body={t('emptyBody')} />
      ) : (
        <DndContext
          sensors={sensors}
          onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))}
          onDragCancel={() => setActiveId(null)}
          onDragEnd={onDragEnd}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {PRINT_STAGES.map((stage) => (
              <Column
                key={stage}
                stage={stage}
                cards={columns[stage]}
                onAdvance={advance}
                onEncode={setEncodingCard}
                highlightId={highlighted}
              />
            ))}
          </div>
          <DragOverlay dropAnimation={reduced ? null : undefined}>
            {activeCard ? (
              <div className="rounded-xl border-2 border-border-strong bg-surface-card p-2.5 shadow-pop">
                <CardFace card={activeCard} />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {encodingCard && (
        <EncodeTagSheet
          card={encodingCard}
          onClose={() => setEncodingCard(null)}
          onEncoded={(card) => {
            setCards((cs) => mergeCard(cs, card)); // fold the ENCODED→PACKING card back into the board
            setEncodingCard(null);
          }}
        />
      )}
    </div>
  );
}

/** One kanban column = a droppable target for its stage. Highlights while a card hovers over it. */
function Column({
  stage,
  cards,
  onAdvance,
  onEncode,
  highlightId,
}: {
  stage: PrintStage;
  cards: PrintCard[];
  onAdvance: (id: string, to: PrintStage) => void;
  onEncode: (card: PrintCard) => void;
  highlightId?: string | null;
}) {
  const t = useTranslations('printQueue');
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  const label = t(`stage.${STAGE_LABEL_KEY[stage]}`);

  return (
    <section
      ref={setNodeRef}
      aria-label={label}
      className={`flex min-h-[340px] flex-col gap-2 rounded-xl border-[1.5px] p-3 ${COLUMN_TONE[stage]} ${
        isOver ? 'ring-2 ring-primary ring-offset-1' : ''
      }`}
    >
      <div className="flex items-center justify-between">
        <h2
          className={`text-base font-semibold ${stage === 'PRINTING' ? 'text-primary' : 'text-text-strong'}`}
        >
          {label}
        </h2>
        <span className="rounded-full bg-surface-brand px-2 py-0.5 font-mono text-xs text-on-dark">
          {cards.length}
        </span>
      </div>
      {cards.length === 0 ? (
        <p className="rounded-lg border-[1.5px] border-dashed border-border-subtle px-2 py-6 text-center font-mono text-xs text-text-muted">
          {t('columnEmpty')}
        </p>
      ) : (
        cards.map((card) => (
          <DraggableCard
            key={card.id}
            card={card}
            onAdvance={onAdvance}
            onEncode={onEncode}
            highlighted={card.id === highlightId}
          />
        ))
      )}
    </section>
  );
}

/** A draggable card. Only the pointer `listeners` are spread (not dnd-kit's a11y `attributes`), so the
 *  card stays a plain container — the accessible control is the advance button inside, not a role=button
 *  wrapper (which would nest a button in a button). SHIPPED cards read as done via reduced opacity. */
function DraggableCard({
  card,
  onAdvance,
  onEncode,
  highlighted,
}: {
  card: PrintCard;
  onAdvance: (id: string, to: PrintStage) => void;
  onEncode: (card: PrintCard) => void;
  highlighted?: boolean;
}) {
  const { listeners, setNodeRef, transform, isDragging } = useDraggable({ id: card.id });
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  return (
    <div
      id={`job-${card.id}`}
      ref={setNodeRef}
      style={style}
      {...listeners}
      className={`cursor-grab rounded-xl border-2 border-border-strong bg-surface-card p-2.5 shadow-pop ${
        isDragging ? 'opacity-40' : ''
      } ${card.stage === 'SHIPPED' ? 'opacity-70' : ''} ${
        highlighted ? 'ring-4 ring-accent-teal motion-safe:animate-pulse' : ''
      }`}
    >
      <CardFace card={card} />
      <CardAdvance card={card} onAdvance={onAdvance} onEncode={onEncode} />
    </div>
  );
}

/** The card face: product (+ color) · quantity, the per-part colours (ADR-037) + chosen options, the
 *  engraving text (if any — the printer previously had NO way to see what to engrave, only the order
 *  detail showed it), then the order code · due date · printer meta line, then the internal note if set.
 *  Shared by the in-column card and the drag overlay. No money, no PII (a print card carries neither) —
 *  the engraving/note ARE the shop's own production data, not customer PII, so they're safe on the card. */
function CardFace({ card }: { card: PrintCard }) {
  const t = useTranslations('printQueue');
  const nameLine = card.colorName ? `${card.productName} · ${card.colorName}` : card.productName;
  const specParts = [...(card.partColorLabels ?? []), ...(card.optionChoiceLabels ?? [])];
  const specs = specParts.length ? specParts.join(' · ') : null;
  const meta = [
    card.orderCode,
    card.eta ? t('due', { date: formatVnDate(card.eta) }) : null,
    card.printer ?? null,
  ].filter(Boolean);

  return (
    <>
      <p className="text-sm text-text-strong">
        {nameLine}
        {card.quantity > 1 ? <span className="text-text-muted"> ×{card.quantity}</span> : null}
      </p>
      {specs ? <p className="mt-0.5 text-xs text-text-body">{specs}</p> : null}
      {card.personalization ? (
        <p className="mt-0.5 rounded bg-primary/10 px-1.5 py-0.5 font-mono text-xs font-semibold text-primary">
          {t('engrave', { text: card.personalization.text })}
        </p>
      ) : null}
      <p className="mt-0.5 font-mono text-[11px] text-text-muted">{meta.join(' · ')}</p>
      {card.orderNote ? (
        <p className="mt-0.5 text-xs italic text-text-muted">
          {t('orderNote', { note: card.orderNote })}
        </p>
      ) : null}
    </>
  );
}

/** The per-card action — the keyboard/AT/mobile alternative to dragging (D-P3-2). For an nfc_tag card at
 *  NFC_ENCODE it's the "Ghi chip NFC" button that opens the encode sheet (writes the chip + advances to
 *  PACKING); otherwise it's the plain product-aware stage advance (hidden at the terminal column).
 *  stopPropagation on mousedown AND touchstart so pressing it doesn't start a card drag. */
function CardAdvance({
  card,
  onAdvance,
  onEncode,
}: {
  card: PrintCard;
  onAdvance: (id: string, to: PrintStage) => void;
  onEncode: (card: PrintCard) => void;
}) {
  const t = useTranslations('printQueue');
  const btnBase =
    'mt-2 inline-flex min-h-[44px] w-full items-center justify-center rounded-lg border-[1.5px] px-2 py-1 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2';

  // The NFC-encode action (spec §10) — the blessed way through the NFC_ENCODE stage. Teal to match the column.
  if (card.productType === 'nfc_tag' && card.stage === 'NFC_ENCODE') {
    return (
      <button
        type="button"
        onMouseDown={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        onClick={() => onEncode(card)}
        className={`${btnBase} border-accent-teal bg-accent-teal-soft text-text-strong`}
      >
        {t('encode.open')}
      </button>
    );
  }

  const next = nextStage(card.stage, card.productType);
  if (!next) return null;
  return (
    <button
      type="button"
      onMouseDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onClick={() => onAdvance(card.id, next)}
      className={`${btnBase} border-border-strong text-text-strong hover:bg-surface-sunken`}
    >
      {t('advanceTo', { stage: t(`stage.${STAGE_LABEL_KEY[next]}`) })}
    </button>
  );
}

/** Live/reconnecting hint — a teal dot when the SSE stream is connected, muted while it (re)connects
 *  and the poll fallback is carrying the board. */
function LiveHint({ live, label }: { live: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-text-muted">
      <span
        aria-hidden
        className={`h-2 w-2 rounded-full ${live ? 'bg-accent-teal' : 'bg-border-strong'}`}
      />
      {label}
    </span>
  );
}

/** Whole-board zero-state (spec §03) — distinct from a single column's "kéo thẻ tới đây" placeholder. */
function EmptyBoard({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border-[1.5px] border-dashed border-border-subtle bg-surface-sunken px-6 py-16 text-center">
      <p className="text-lg font-semibold text-text-strong">{title}</p>
      <p className="max-w-sm text-sm text-text-muted">{body}</p>
    </div>
  );
}
