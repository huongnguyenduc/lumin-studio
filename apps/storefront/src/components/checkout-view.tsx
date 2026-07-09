'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Checkbox, Input, PriceTag, cn } from '@lumin/ui';
import { cartCount, cartQuoteItems, cartSignature } from '@/lib/cart';
import { useCart } from '@/lib/cart-store';
import { quoteCart } from '@/lib/quote';
import {
  EMPTY_CHECKOUT_FORM,
  personalizationAckMet,
  validateCheckoutForm,
  type CheckoutErrors,
  type CheckoutField,
  type CheckoutFormState,
  type ValidatedCheckout,
} from '@/lib/checkout-form';
import type { CheckoutConfigResult } from '@/lib/checkout-config';
import { CtaLink } from './cta-link';

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
  const { items } = useCart();

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
    // ignores them otherwise, so a non-engraved order omits them like a blank email/note.
    setValidated(
      hasPersonalization
        ? { ...result.value, personalizationAck, engraveEchoConfirmed }
        : result.value,
    );
    setStep('payment');
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

  const { shippableProvinces, refundPolicy } = config.config;
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
    <div className="rounded-lg border-2 border-border-strong bg-surface-card p-4">
      <p className="text-sm text-text-muted">
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

  // Payment step (C2). This PR renders the recipient + totals header; P2-f adds QR + biên lai + submit.
  if (step === 'payment' && validated) {
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
          {validated.note ? (
            <p className="mt-1 text-sm text-text-muted">
              {t('noteSummaryLine', { note: validated.note })}
            </p>
          ) : null}
        </div>
        <div className="mt-4">{summary}</div>
        {/* ponytail: P2-f seam — replaces this line with the VietQR panel, proof upload and submit. */}
        <p className="mt-6 text-center text-sm text-text-muted">{t('paymentPending')}</p>
      </Shell>
    );
  }

  return (
    <Shell heading={t('heading')}>
      <form onSubmit={onSubmitInfo} noValidate className="mt-6 flex flex-col gap-5">
        {summary}

        <fieldset className="flex min-w-0 flex-col gap-4 border-0 p-0">
          <legend className="mb-1 font-display text-base font-bold text-text-strong">
            {t('contactHeading')}
          </legend>
          <Input
            label={`${t('emailLabel')} ${t('optional')}`}
            type="email"
            inputMode="email"
            autoComplete="email"
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
          <Link href="/chinh-sach#quyen-rieng-tu" className="font-semibold text-primary underline">
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
          {t('continueCta')}
        </Button>
      </form>
    </Shell>
  );
}

/** Shared page shell: centred container + the checkout heading. */
function Shell({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className="mx-auto w-full max-w-[520px] px-4 py-6 md:px-6 md:py-10">
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
