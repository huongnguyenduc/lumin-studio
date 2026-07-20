'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Checkbox, Input, PriceTag, cn } from '@lumin/ui';
import { cartCount, cartQuoteItems, cartSignature, selectedItems } from '@/lib/cart';
import { useCart } from '@/lib/cart-store';
import { quoteCart } from '@/lib/quote';
import {
  buildWebOrderInput,
  EMPTY_CHECKOUT_FORM,
  personalizationAckMet,
  validateCheckoutForm,
  type CheckoutErrors,
  type CheckoutField,
  type CheckoutFormState,
  type ValidatedCheckout,
} from '@/lib/checkout-form';
import {
  createPaymentProofUpload,
  placeOrder,
  type CreateOrderResult,
  type ProofUploadContentType,
} from '@/lib/order-submit';
import type { CheckoutConfigResult } from '@/lib/checkout-config';
import { CtaLink } from './cta-link';
import { WaitScreen } from './wait-screen';

/** MIME types the receipt upload accepts — exactly the set the presigned-POST policy allows (P2-c). */
const PROOF_TYPES: readonly ProofUploadContentType[] = ['image/jpeg', 'image/png', 'image/webp'];

/** Receipt-image upload progress (browser → Garage via the P2-c presigned POST). `done` carries the
 *  host-pinned finalUrl submitted as paymentProofUrl. `error` codes tell the shopper what to fix. */
type ProofState =
  | { status: 'idle' }
  | { status: 'uploading' }
  | { status: 'done'; finalUrl: string; fileName: string }
  | { status: 'error'; code: 'type' | 'size' | 'upload' };

/** Debounce before (re-)quoting: coalesces province edits / cart changes into one server round-trip. */
const QUOTE_DEBOUNCE_MS = 350;

type QuoteState =
  | { status: 'idle' }
  | { status: 'loading' }
  // A resolved quote records the cart `signature` + `province` it priced; it is applied only while BOTH
  // still match the current form, so a superseded quote never paints a stale total. (Two fields, not one
  // concatenated key: engrave text in the signature can contain spaces, so no separator is collision-free.)
  | {
      status: 'ok';
      signature: string;
      province: string;
      subtotal: number;
      shippingFee?: number;
      total?: number;
    }
  | {
      status: 'error';
      signature: string;
      province: string;
      code: 'unavailable' | 'no_shipping_rule' | 'error';
    };

/**
 * Checkout info step (/thanh-toan, C1 — P2-d). Guest-first: reads the persisted cart (useCart), collects
 * contact + shipping address, and prices the cart server-side WITH the chosen province (POST /price/quote
 * → shipping + total), never summing money on the client (conventions §Tiền / ADR-019). It discloses the
 * đổi-trả policy and a PDPL privacy notice BEFORE purchase for EVERY cart (compliance §2/§3). "Tiếp tục
 * thanh toán" validates (rules mirror the server, lib/checkout-form.ts) and advances to the payment step,
 * whose header (recipient + totals) this PR renders and P2-f fills with QR + biên lai + submit.
 *
 * States: mount skeleton (localStorage isn't readable during SSR) · config load error (retryable) · empty
 * cart (CTA to catalog) · the priced form · shipping/total loading + error inside the summary.
 */
export function CheckoutView({ config }: { config: CheckoutConfigResult }) {
  const t = useTranslations('checkout');
  const tStates = useTranslations('states');
  const router = useRouter();
  const { items: cartItems, clearSelected } = useCart();
  // Hi-fi 05 "chọn món": checkout covers ONLY the selected cart lines — everything below (quote,
  // engraving acks, order input, counts, the empty state) works on this filtered view. All lines
  // deselected reads as an empty checkout; the deselected lines stay in the cart afterwards.
  const items = useMemo(() => selectedItems(cartItems), [cartItems]);

  // localStorage is unreadable during SSR/first paint → gate on mount so we show a skeleton instead of
  // flashing the empty state before the persisted cart loads.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [form, setForm] = useState<CheckoutFormState>(EMPTY_CHECKOUT_FORM);
  const [errors, setErrors] = useState<CheckoutErrors>({});
  const [formError, setFormError] = useState(false);
  const [step, setStep] = useState<'info' | 'payment'>('info');
  const [validated, setValidated] = useState<ValidatedCheckout | null>(null);
  // ADR-012 dual-ack, gated only when the cart has engraving (see hasPersonalization below).
  const [personalizationAck, setPersonalizationAck] = useState(false);
  const [engraveEchoConfirmed, setEngraveEchoConfirmed] = useState(false);

  const [quote, setQuote] = useState<QuoteState>({ status: 'idle' });
  const [retryNonce, setRetryNonce] = useState(0);

  // Payment step (C2, P2-f): receipt upload progress, in-flight submit, the mapped submit error, and the
  // created-order result (which switches the view to the done screen).
  const [proof, setProof] = useState<ProofState>({ status: 'idle' });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<'no_stk' | 'no_shipping_rule' | 'error' | null>(
    null,
  );
  const [placed, setPlaced] = useState<CreateOrderResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Synchronous double-submit latch (see onSubmitOrder). A ref, NOT the `submitting` state: setSubmitting
  // is async, so a second click fired before React commits the re-render would read the same stale closure
  // and pass a state-only guard, minting a duplicate order (the server has no idempotency yet — ADR-033
  // parked it for exactly this slice). A ref flips within the same tick, closing that window.
  const submitLatch = useRef(false);

  const refundHeadingId = useId();
  const engraveHeadingId = useId();
  const provinceFieldId = useId();
  const signature = cartSignature(items);
  const province = form.province.trim();

  // A cart line is "personalized" iff it carries non-blank engraving — the exact predicate the server
  // uses (checkout.go personalizationFrom: a personalization whose TrimSpace(text) != ""). Mirroring the
  // trim keeps the client from over-gating a tampered cart the server would accept without acks. flatMap
  // narrows engrave to non-null so the echo below can read .text without a non-null assertion.
  const engravedLines = items.flatMap((i) =>
    i.engrave && i.engrave.text.trim() !== ''
      ? [{ key: i.key, name: i.name, text: i.engrave.text }]
      : [],
  );
  const hasPersonalization = engravedLines.length > 0;
  const acksMet = personalizationAckMet(
    hasPersonalization,
    personalizationAck,
    engraveEchoConfirmed,
  );

  useEffect(() => {
    if (items.length === 0) {
      setQuote({ status: 'idle' });
      return;
    }
    let cancelled = false;
    setQuote({ status: 'loading' });
    const timer = setTimeout(async () => {
      const result = await quoteCart(cartQuoteItems(items), province || undefined);
      if (cancelled) return;
      setQuote(
        result.ok
          ? {
              status: 'ok',
              signature,
              province,
              subtotal: result.subtotal,
              shippingFee: result.shippingFee,
              total: result.total,
            }
          : { status: 'error', signature, province, code: result.code },
      );
    }, QUOTE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // Keyed on signature + province (both stable strings); the new-items/province closure is current
    // because a change to either follows a re-render. retryNonce re-runs the same quote after a failure.
  }, [signature, province, retryNonce]);

  const matches = (q: { signature: string; province: string }) =>
    q.signature === signature && q.province === province;
  const okQuote = quote.status === 'ok' && matches(quote) ? quote : null;
  const errQuote = quote.status === 'error' && matches(quote) ? quote : null;

  const setField = (field: CheckoutField | 'note', value: string) => {
    setForm((f) => ({ ...f, [field]: value }));
    // Clear that field's error as the shopper fixes it (note has no error).
    if (field !== 'note') {
      setErrors((e) => {
        if (!e[field]) return e;
        const next = { ...e };
        delete next[field];
        return next;
      });
    }
    setFormError(false);
  };

  const onSubmitInfo = (e: FormEvent) => {
    e.preventDefault();
    const result = validateCheckoutForm(form);
    if (!result.ok) {
      setErrors(result.errors);
      setFormError(true);
      return;
    }
    // result.ok ⇒ province is non-empty; block if its server total isn't settled (loading / unshippable
    // / transient error) — the summary already shows why (skeleton / no_shipping_rule / pricing error) and
    // the button is disabled, so return without a misleading form-level "check your info" message. (Only
    // reachable via Enter, since the submit button is disabled while the total is pending.)
    if (okQuote?.total === undefined) {
      return;
    }
    // ADR-012 dual-ack (checkout.go:241): an engraved cart can't advance until both boxes are ticked.
    // The button is already disabled while unmet; this guards the Enter-key path, mirroring the quote
    // gate above (silent no-op — the unchecked required checkboxes are the visible nudge).
    if (!acksMet) {
      return;
    }
    setErrors({});
    setFormError(false);
    // Carry the acks only for an engraved cart (both true, since acksMet just passed); the server
    // ignores them otherwise, so a non-engraved order omits them like a blank note.
    setValidated(
      hasPersonalization
        ? { ...result.value, personalizationAck, engraveEchoConfirmed }
        : result.value,
    );
    setStep('payment');
  };

  // Receipt upload: pick → get a presigned POST for the file's type (P2-c) → upload the bytes STRAIGHT to
  // Garage (not through core-api) → keep the host-pinned finalUrl for the order. Errors map to a code the
  // status line translates. Size is checked against the policy's own maxBytes so we fail fast with a
  // friendly message instead of letting Garage 400 the oversize part.
  const onPickFile = async (file: File | undefined) => {
    if (!file) return;
    // ponytail: trust the browser's file.type — reliable for phone screenshots (the 99% receipt case). A
    // file whose MIME the OS reports empty/wrong is rejected with a clear "only JPG/PNG/WebP" nudge and the
    // shopper re-picks; add extension-sniffing + a retyped Blob only if real devices show false rejects.
    const contentType = PROOF_TYPES.find((type) => type === file.type);
    if (!contentType) {
      setProof({ status: 'error', code: 'type' });
      return;
    }
    setProof({ status: 'uploading' });
    const bootstrap = await createPaymentProofUpload(contentType);
    if (!bootstrap.ok) {
      setProof({ status: 'error', code: 'upload' });
      return;
    }
    const { uploadUrl, fields, finalUrl, maxBytes } = bootstrap.upload;
    if (file.size > maxBytes) {
      setProof({ status: 'error', code: 'size' });
      return;
    }
    // S3/Garage presigned POST: every policy field first, the file part LAST.
    const body = new FormData();
    for (const [key, value] of Object.entries(fields)) body.append(key, value);
    body.append('file', file);
    try {
      const res = await fetch(uploadUrl, { method: 'POST', body });
      if (!res.ok) {
        setProof({ status: 'error', code: 'upload' });
        return;
      }
      setProof({ status: 'done', finalUrl, fileName: file.name });
    } catch {
      setProof({ status: 'error', code: 'upload' });
    }
  };

  // Submit the order. The double-submit guard is the synchronous `submitLatch` ref (see its declaration) —
  // it closes the window that async setState leaves open. On 201 the cart is emptied (a placed order's
  // items must not linger) and the done view takes over; a mapped failure re-enables the form (latch reset)
  // with a loud message (never silent).
  const onSubmitOrder = async () => {
    if (
      !validated ||
      proof.status !== 'done' ||
      okQuote?.total === undefined ||
      submitLatch.current
    ) {
      return;
    }
    submitLatch.current = true;
    setSubmitError(null);
    setSubmitting(true);
    const result = await placeOrder(buildWebOrderInput(validated, items, proof.finalUrl));
    if (result.ok) {
      // Leave the latch set — the done view replaces this screen, so no further submit is possible.
      // Only the ORDERED (selected) lines leave the cart; deselected ones stay for next time.
      clearSelected();
      setPlaced(result.result);
      return;
    }
    submitLatch.current = false;
    setSubmitting(false);
    setSubmitError(result.code);
  };

  if (!mounted) {
    return <CheckoutSkeleton heading={t('heading')} />;
  }

  if (!config.ok) {
    return (
      <Shell heading={t('heading')}>
        <div
          role="alert"
          className="mt-6 rounded-lg border-2 border-border-strong bg-surface-card p-8 text-center"
        >
          <p className="text-text-body">{tStates('errorBody')}</p>
          <button
            type="button"
            onClick={() => router.refresh()}
            className="mt-4 inline-flex min-h-11 items-center rounded-pill border-2 border-border-strong bg-surface-card px-5 font-display text-sm font-semibold text-text-strong transition-colors hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2"
          >
            {tStates('retry')}
          </button>
        </div>
      </Shell>
    );
  }

  // Order placed (checked BEFORE the empty-cart guard, because submitting cleared the cart): the C3
  // wait-screen (P2-g) takes over — auto-polls GET /orders/track with the 201 trackingToken, shows the
  // live OrderTimeline + the phone-less /o/{code}-{token} copy link, and handles the CANCELLED branch.
  if (placed) {
    return <WaitScreen code={placed.order.code} token={placed.trackingToken} justPlaced />;
  }

  // C2½ full-screen "sending your order" while POST /orders is in flight (design C2½ — a dedicated
  // screen, not just a disabled button). prefers-reduced-motion stops the spinner.
  if (submitting) {
    return <SubmittingScreen title={t('submittingTitle')} body={t('submittingBody')} />;
  }

  if (items.length === 0) {
    return (
      <Shell heading={t('heading')}>
        <div className="mt-6 rounded-lg border-2 border-dashed border-border-default bg-surface-sunken p-10 text-center">
          <p className="font-display text-lg font-semibold text-text-strong">{t('emptyTitle')}</p>
          <p className="mt-2 text-text-muted">{t('emptyBody')}</p>
          <CtaLink href="/" className="mt-4">
            {t('emptyCta')}
          </CtaLink>
        </div>
      </Shell>
    );
  }

  const { shippableProvinces, refundPolicy, bankAccount, vietqrUrl } = config.config;
  const provinceChosen = province !== '';
  const total = okQuote?.total;
  const quotePending = provinceChosen && !okQuote && !errQuote;
  // Can't advance to payment without a server-computed total for the chosen province (still quoting,
  // unshippable, or a transient quote error) — the summary shows why — nor while the ADR-012 engrave
  // acks are unmet (a non-engraved cart is never gated: acksMet is true).
  const continueDisabled = (provinceChosen && total === undefined) || !acksMet;

  const fieldError = (field: CheckoutField): string | undefined =>
    errors[field] ? t(`errors.${errors[field]}`) : undefined;

  const summary = (
    <div className="rounded-md border-2 border-border-strong bg-surface-sunken p-4 shadow-pop-sm">
      <h2 className="font-display text-base font-bold text-text-strong">
        {t('orderSummaryHeading')}
      </h2>
      <p className="mt-1 font-mono text-xs text-text-muted">
        {t('summaryItemCount', { count: cartCount(items) })}
      </p>
      <div className="mt-2 flex items-center justify-between gap-3">
        <span className="text-text-body">{t('subtotalLabel')}</span>
        {/* aria-live so assistive tech announces the recomputed total after a quote settles. */}
        <span aria-live="polite">
          {okQuote ? <PriceTag amount={okQuote.subtotal} /> : <SummarySkeleton />}
        </span>
      </div>
      {!provinceChosen ? (
        <p className="mt-2 text-sm text-text-muted">{t('shippingPending')}</p>
      ) : okQuote && okQuote.shippingFee !== undefined && okQuote.total !== undefined ? (
        <>
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="text-text-body">{t('shippingLabel')}</span>
            <PriceTag amount={okQuote.shippingFee} />
          </div>
          <div className="mt-2 flex items-center justify-between gap-3 border-t border-border-subtle pt-2">
            <span className="font-display font-bold text-text-strong">{t('totalLabel')}</span>
            <PriceTag amount={okQuote.total} className="text-xl" />
          </div>
        </>
      ) : errQuote ? (
        <div className="mt-3">
          <p role="alert" className="text-sm font-semibold text-accent-flame">
            {errQuote.code === 'no_shipping_rule'
              ? t('noShippingRule')
              : errQuote.code === 'unavailable'
                ? t('unavailableError')
                : t('pricingError')}
          </p>
          {errQuote.code === 'error' ? (
            <button
              type="button"
              onClick={() => setRetryNonce((n) => n + 1)}
              className="mt-2 inline-flex min-h-11 items-center rounded-pill border-2 border-border-strong bg-surface-card px-5 font-display text-sm font-semibold text-text-strong transition-colors hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2"
            >
              {t('retry')}
            </button>
          ) : null}
        </div>
      ) : (
        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="text-text-body">{t('shippingLabel')}</span>
          <SummarySkeleton />
        </div>
      )}
    </div>
  );

  // Payment step (C2, P2-f): recipient + totals header, the VietQR panel, the receipt upload and submit.
  if (step === 'payment' && validated) {
    // A shop with no STK configured cannot take a web payment (mirrors the server's NO_STK_CONFIGURED,
    // P2-a) — show a friendly closed-notice instead of a broken QR. Submit additionally needs an uploaded
    // receipt and a settled server total (carried from C1).
    const stkConfigured = Boolean(bankAccount.accountNumber);
    const canSubmit = stkConfigured && proof.status === 'done' && okQuote?.total !== undefined;
    return (
      <Shell heading={t('heading')}>
        <div className="mt-4 rounded-lg border-2 border-border-strong bg-surface-card p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display text-base font-bold text-text-strong">
              {t('deliverToLabel')}
            </h2>
            <button
              type="button"
              onClick={() => setStep('info')}
              className="text-sm font-semibold text-accent-flame focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky"
            >
              {t('editLabel')}
            </button>
          </div>
          <p className="mt-2 font-medium text-text-strong">
            {t('recipientLine', {
              name: validated.customer.name,
              phone: validated.customer.phone,
            })}
          </p>
          <p className="text-text-body">
            {t('addressLine', {
              street: validated.shippingAddress.street,
              ward: validated.shippingAddress.ward,
              province: validated.shippingAddress.province,
            })}
          </p>
          {/* The customer note is collected on C1 (validated.note) but deliberately NOT echoed here: the
              web order contract has no `note` field yet, so the note isn't sent — showing it on the review
              screen would imply it was saved. It re-appears once CreateWebOrderInput gains an additive
              `note?` and buildWebOrderInput maps it (deferred follow-up; see lib/checkout-form.ts). */}
        </div>
        <div className="mt-4">{summary}</div>

        {stkConfigured ? (
          <>
            {/* VietQR panel — the server-built img.vietqr.io QR + the STK. The bank name is intentionally
                not shown (config carries only the bin, not a human name); the QR image renders it, and we
                show account number + holder. ponytail: bin→name map deferred until the shop asks. */}
            <section className="mt-4 rounded-lg border-2 border-border-strong bg-surface-card p-4">
              <h2 className="font-display text-base font-bold text-text-strong">
                {t('payHeading')}
              </h2>
              <p className="mt-1 text-sm text-text-body">{t('payIntro')}</p>
              <div className="mt-3 flex items-center gap-4">
                {/* Plain <img> for the remote QR host (matches product-detail / cart-line — no next/image
                    remotePatterns to maintain). */}
                <img
                  src={vietqrUrl}
                  alt={t('qrAlt')}
                  width={160}
                  height={160}
                  className="h-40 w-40 flex-none rounded-md border border-border-subtle bg-white object-contain"
                />
                <dl className="min-w-0 flex-1 text-sm">
                  <dt className="text-text-muted">{t('accountNumberLabel')}</dt>
                  <dd className="font-mono font-semibold text-text-strong">
                    {bankAccount.accountNumber}
                  </dd>
                  <dt className="mt-2 text-text-muted">{t('accountNameLabel')}</dt>
                  <dd className="font-semibold text-text-strong">{bankAccount.accountName}</dd>
                </dl>
              </div>
            </section>

            {/* Receipt upload (P2-c). The proof is REQUIRED (contract) — the submit button stays disabled
                until an upload finishes, so the warm copy doesn't imply it's optional. */}
            <section className="mt-4 rounded-lg border-2 border-border-strong bg-surface-card p-4">
              <h2 className="font-display text-base font-bold text-text-strong">
                {t('proofHeading')}
              </h2>
              <p className="mt-1 text-sm text-text-body">{t('proofIntro')}</p>
              <input
                ref={fileInputRef}
                type="file"
                accept={PROOF_TYPES.join(',')}
                className="sr-only"
                onChange={(e) => {
                  onPickFile(e.target.files?.[0]);
                  // Reset so re-picking the SAME file after an error still fires onChange.
                  e.target.value = '';
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="md"
                className="mt-3"
                disabled={proof.status === 'uploading'}
                onClick={() => fileInputRef.current?.click()}
              >
                {proof.status === 'done' ? t('proofChange') : t('proofPick')}
              </Button>
              {/* aria-live so assistive tech announces the upload result. */}
              <p className="mt-2 text-sm" aria-live="polite">
                {proof.status === 'uploading' ? (
                  <span className="text-text-muted">{t('proofUploading')}</span>
                ) : proof.status === 'done' ? (
                  <span className="font-semibold text-primary">
                    {t('proofDone', { name: proof.fileName })}
                  </span>
                ) : proof.status === 'error' ? (
                  <span role="alert" className="font-semibold text-danger">
                    {t(`proofErrors.${proof.code}`)}
                  </span>
                ) : null}
              </p>
            </section>

            {submitError ? (
              <p role="alert" className="mt-4 text-sm font-semibold text-danger">
                {t(`submitErrors.${submitError}`)}
              </p>
            ) : null}

            <Button
              type="button"
              variant="pop"
              size="lg"
              className="mt-4 w-full"
              disabled={!canSubmit}
              onClick={onSubmitOrder}
            >
              {t('submitCta')}
            </Button>
          </>
        ) : (
          <p
            role="alert"
            className="mt-6 rounded-lg border-2 border-border-strong bg-surface-sunken p-6 text-center text-sm text-text-body"
          >
            {t('noStk')}
          </p>
        )}
      </Shell>
    );
  }

  return (
    <Shell heading={t('heading')} wide>
      {/* Hi-fi C1 desktop: form on the left, the "Đơn hàng" summary card sticky on the right; on
          mobile the summary stays first (the hi-fi top strip). One <form>, two grid areas. */}
      <form
        onSubmit={onSubmitInfo}
        noValidate
        className="mt-6 gap-8 lg:grid lg:grid-cols-[1fr_340px] lg:items-start"
      >
        <aside className="lg:sticky lg:top-24 lg:col-start-2 lg:row-start-1">{summary}</aside>

        <div className="mt-5 flex min-w-0 flex-col gap-5 lg:col-start-1 lg:row-start-1 lg:mt-0">
          <fieldset className="flex min-w-0 flex-col gap-4 border-0 p-0">
            <legend className="mb-1 font-display text-base font-bold text-text-strong">
              {t('contactHeading')}
            </legend>
            <Input
              label={t('emailLabel')}
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              placeholder={t('emailPlaceholder')}
              value={form.email}
              onChange={(e) => setField('email', e.target.value)}
              error={fieldError('email')}
            />
            <Input
              label={t('nameLabel')}
              autoComplete="name"
              placeholder={t('namePlaceholder')}
              value={form.name}
              onChange={(e) => setField('name', e.target.value)}
              error={fieldError('name')}
            />
            <Input
              label={t('phoneLabel')}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder={t('phonePlaceholder')}
              value={form.phone}
              onChange={(e) => setField('phone', e.target.value)}
              error={fieldError('phone')}
            />
          </fieldset>

          <fieldset className="flex min-w-0 flex-col gap-4 border-0 p-0">
            <legend className="mb-1 font-display text-base font-bold text-text-strong">
              {t('addressHeading')}
            </legend>
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor={provinceFieldId}
                className="font-display text-sm font-medium text-text-strong"
              >
                {t('provinceLabel')}
              </label>
              <select
                id={provinceFieldId}
                value={form.province}
                onChange={(e) => setField('province', e.target.value)}
                aria-invalid={errors.province ? true : undefined}
                aria-describedby={errors.province ? `${provinceFieldId}-desc` : undefined}
                className={cn(
                  'h-11 rounded-md border bg-surface-card px-3 font-body text-text-strong',
                  'focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky',
                  errors.province ? 'border-danger' : 'border-border-default',
                )}
              >
                <option value="">{t('provincePlaceholder')}</option>
                {shippableProvinces.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              {errors.province ? (
                <p id={`${provinceFieldId}-desc`} role="alert" className="text-sm text-danger">
                  {t(`errors.${errors.province}`)}
                </p>
              ) : null}
            </div>
            <Input
              label={t('wardLabel')}
              autoComplete="address-level2"
              placeholder={t('wardPlaceholder')}
              value={form.ward}
              onChange={(e) => setField('ward', e.target.value)}
              error={fieldError('ward')}
            />
            <Input
              label={t('streetLabel')}
              autoComplete="address-line1"
              placeholder={t('streetPlaceholder')}
              value={form.street}
              onChange={(e) => setField('street', e.target.value)}
              error={fieldError('street')}
            />
            <Input
              label={`${t('noteLabel')} ${t('optional')}`}
              placeholder={t('notePlaceholder')}
              value={form.note}
              onChange={(e) => setField('note', e.target.value)}
            />
          </fieldset>

          {/* Đổi-trả disclosure — shown for EVERY cart before purchase (compliance §3). */}
          <section
            aria-labelledby={refundHeadingId}
            className="rounded-lg border border-border-subtle bg-surface-sunken p-4"
          >
            <h2 id={refundHeadingId} className="font-display text-sm font-bold text-text-strong">
              {t('refundHeading')}
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-text-body">
              {refundPolicy.trim() || t('refundFallback')}
            </p>
            <Link
              href="/chinh-sach#doi-tra"
              className="mt-2 inline-block text-sm font-semibold text-primary underline"
            >
              {t('refundLink')}
            </Link>
          </section>

          {/* Engrave add-on (ADR-012) — ONLY when the cart is personalized. Stacks ON TOP of the đổi-trả
            disclosure above (does not replace it): echoes the engraved text for a last check, states the
            prepay rule, and gates "continue" on the two required acks (personalizationAck + the
            engrave-echo confirmation) mirrored server-side at checkout.go:241. */}
          {hasPersonalization ? (
            <section
              aria-labelledby={engraveHeadingId}
              className="rounded-lg border-2 border-border-strong bg-surface-card p-4"
            >
              <h2 id={engraveHeadingId} className="font-display text-sm font-bold text-text-strong">
                {t('engraveHeading')}
              </h2>
              <p className="mt-1 text-sm text-text-body">{t('engraveEchoIntro')}</p>
              <ul className="mt-1.5 flex flex-col gap-1">
                {engravedLines.map((l) => (
                  <li key={l.key} className="text-sm font-medium text-text-strong">
                    {t('engraveEchoLine', { name: l.name, text: l.text })}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-sm text-text-muted">{t('prepayNote')}</p>
              <div className="mt-3 flex flex-col gap-1">
                <Checkbox
                  checked={personalizationAck}
                  onChange={(e) => setPersonalizationAck(e.target.checked)}
                  label={t('ackNoReturn')}
                />
                <Checkbox
                  checked={engraveEchoConfirmed}
                  onChange={(e) => setEngraveEchoConfirmed(e.target.checked)}
                  label={t('ackEcho')}
                />
              </div>
            </section>
          ) : null}

          {/* PDPL privacy notice — informational, unbundled, no marketing tick (compliance §2). */}
          <p className="text-sm text-text-muted">
            {t('privacyNotice')}{' '}
            <Link
              href="/chinh-sach#quyen-rieng-tu"
              className="font-semibold text-primary underline"
            >
              {t('privacyLink')}
            </Link>
          </p>

          {formError ? (
            <p role="alert" className="text-sm font-semibold text-danger">
              {t('errors.formError')}
            </p>
          ) : null}

          {/* Nudge (not a 400): the button is disabled until both engrave acks are ticked (ADR-012). */}
          {hasPersonalization && !acksMet ? (
            <p className="text-sm text-text-muted">{t('ackHint')}</p>
          ) : null}

          <Button
            type="submit"
            variant="pop"
            size="lg"
            className="w-full"
            disabled={continueDisabled}
            aria-busy={quotePending}
          >
            {t('continueCta')} <span aria-hidden="true">→</span>
          </Button>
        </div>
      </form>
    </Shell>
  );
}

/** Shared page shell: centred container + the checkout heading. `wide` is the hi-fi C1 desktop
 *  two-column layout (form + sticky "Đơn hàng" card); the narrow default fits every other state. */
function Shell({
  heading,
  wide = false,
  children,
}: {
  heading: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        'mx-auto w-full px-4 py-6 md:px-6 md:py-10',
        wide ? 'max-w-[1100px]' : 'max-w-[520px]',
      )}
    >
      <h1 className="font-display text-2xl font-bold text-text-strong md:text-3xl">{heading}</h1>
      {children}
    </section>
  );
}

/** Mount-time placeholder while the persisted cart loads (localStorage is client-only). */
function CheckoutSkeleton({ heading }: { heading: string }) {
  return (
    <Shell heading={heading}>
      <div className="mt-6 h-16 animate-pulse rounded-lg bg-surface-sunken motion-reduce:animate-none" />
      <div className="mt-6 flex flex-col gap-4" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-11 animate-pulse rounded-md bg-surface-sunken motion-reduce:animate-none"
          />
        ))}
      </div>
    </Shell>
  );
}

/** Small inline pulse for a money value that is still (re-)quoting. */
function SummarySkeleton() {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-5 w-20 animate-pulse rounded bg-surface-sunken motion-reduce:animate-none"
    />
  );
}

/** C2½ full-screen "sending your order" state while POST /orders is in flight (design C2½ — a dedicated
 *  screen, not just a disabled button). The spinner is paused under prefers-reduced-motion. */
function SubmittingScreen({ title, body }: { title: string; body: string }) {
  return (
    <Shell heading={title}>
      <div role="status" className="mt-10 flex flex-col items-center gap-4 text-center">
        <span
          aria-hidden="true"
          className="h-12 w-12 animate-spin rounded-full border-4 border-surface-sunken border-t-primary motion-reduce:animate-none"
        />
        <p className="text-text-body">{body}</p>
      </div>
    </Shell>
  );
}
