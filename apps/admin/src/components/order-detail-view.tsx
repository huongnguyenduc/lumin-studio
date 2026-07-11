'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { formatVnd, formatVnDate, type OrderStatus, type Role } from '@lumin/core';
import type { components } from '@lumin/api-client';
import { Button, Card, cn } from '@lumin/ui';
import { OrderStatusBadge } from './order-status-badge';
import { TransitionDialog } from './transition-dialog';
import {
  availableTransitions,
  progressSteps,
  type AvailableTransition,
  type MilestoneState,
} from '@/lib/order-detail';
import { transitionOrder } from '@/lib/order-actions';

type Order = components['schemas']['Order'];

// ponytail: staff accounts don't exist yet (invite = P3-q) and the admin has no client role source
// (no /auth/me; session.ts holds only the httpOnly cookie). The one real user is the owner, so gate the
// action bar as owner — the SERVER is authoritative regardless (staff→PAID = 403, owner-only refund
// rejected in the domain guard), so this is display-only optimism. Plumb the real JWT role when staff
// land (P3-q): decode the session role server-side in the page and pass it down.
const ROLE: Role = 'owner';

const CLOSE_STATES: ReadonlySet<OrderStatus> = new Set<OrderStatus>(['CANCELLED', 'REFUNDED']);

/**
 * The admin order-detail view (P3-e): the read-only internal detail plus the transition action bar.
 * Client component — the transitions mutate and then `router.refresh()` re-reads the RSC so the
 * progress track + statusHistory reflect the new state without a full reload. `confirm`/`advance` are
 * 1-touch; `ship`/`cancel`/`refund` open <TransitionDialog> to collect the fields the server requires.
 */
export function OrderDetailView({ order }: { order: Order }) {
  const t = useTranslations('orderDetail');
  const tChannel = useTranslations('channel');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [dialog, setDialog] = useState<AvailableTransition | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const status = order.status as OrderStatus;
  const steps = progressSteps(status, order.statusHistory);
  const actions = availableTransitions(status, ROLE);
  const isClosed = CLOSE_STATES.has(status);
  const closeReason = [...order.statusHistory].reverse().find((e) => e.to === status)?.reason;

  function onAction(action: AvailableTransition) {
    if (action.kind === 'confirm' || action.kind === 'advance') {
      setErrorCode(null);
      startTransition(async () => {
        const res = await transitionOrder(order.id, { to: action.to });
        if (res.ok) router.refresh();
        else setErrorCode(res.code);
      });
    } else {
      setDialog(action);
    }
  }

  return (
    <div className="flex flex-col gap-6 pb-24 md:pb-0">
      {/* Header: back + code + status */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            href="/don-hang"
            className="rounded-pill px-2 py-1 font-semibold text-text-body hover:text-text-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2"
          >
            {t('backToList')}
          </Link>
          <h1 className="font-display text-2xl font-semibold text-text-strong">{order.code}</h1>
          <OrderStatusBadge status={status} />
          <span className="text-sm text-text-muted">{tChannel(order.channel)}</span>
        </div>
      </div>

      {/* Terminal banner for close states (carries the recorded reason) */}
      {isClosed && (
        <Card
          elevation="md"
          className={cn(
            'border-2 px-5 py-4',
            status === 'CANCELLED' ? 'border-danger' : 'border-accent-sun',
          )}
        >
          <p className="font-semibold text-text-strong">{t(`closed.${status}`)}</p>
          {closeReason && <p className="mt-1 text-sm text-text-muted">{closeReason}</p>}
        </Card>
      )}

      {/* Progress track (5 milestones) */}
      <Card elevation="md" className="px-5 py-5">
        <h2 className="mb-4 font-semibold text-text-strong">{t('progress')}</h2>
        <ol className="flex items-start">
          {steps.map((step, i) => (
            <li key={step.status} className="flex flex-1 flex-col items-center text-center">
              <div className="flex w-full items-center">
                <Connector visible={i !== 0} reached={step.state !== 'todo'} />
                <StepCircle index={i} state={step.state} />
                <Connector
                  visible={i !== steps.length - 1}
                  reached={steps[i + 1]?.state !== 'todo'}
                />
              </div>
              <span
                className={cn(
                  'mt-2 text-xs',
                  step.state === 'todo' ? 'text-text-muted' : 'font-semibold text-text-strong',
                )}
              >
                {t(`step.${step.status}`)}
              </span>
            </li>
          ))}
        </ol>
      </Card>

      <div className="grid gap-6 md:grid-cols-[1.4fr_1fr]">
        {/* Left: items + money */}
        <div className="flex flex-col gap-6">
          <Card elevation="md" className="px-5 py-5">
            <h2 className="mb-3 font-semibold text-text-strong">{t('items')}</h2>
            <ul className="flex flex-col divide-y divide-border-subtle">
              {order.items.map((item, i) => (
                <li key={i} className="flex items-start justify-between gap-4 py-3 first:pt-0">
                  <div className="min-w-0">
                    <p className="font-semibold text-text-strong">
                      {item.productName ?? '—'}
                      {item.quantity > 1 && (
                        <span className="text-text-muted"> ×{item.quantity}</span>
                      )}
                    </p>
                    <p className="text-sm text-text-muted">{itemSpecs(item, t)}</p>
                  </div>
                  <span className="shrink-0 font-mono text-sm text-text-strong">
                    {formatVnd(item.unitPrice)}
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          <Card elevation="md" className="flex flex-col gap-2 px-5 py-5">
            <h2 className="mb-1 font-semibold text-text-strong">{t('summary')}</h2>
            <Row label={t('subtotal')} value={formatVnd(order.subtotal)} />
            <Row label={t('shippingFee')} value={formatVnd(order.shippingFee)} />
            <div className="mt-1 flex items-center justify-between border-t border-border-subtle pt-2">
              <span className="font-semibold text-text-strong">{t('total')}</span>
              <span className="font-mono font-semibold text-text-strong">
                {formatVnd(order.total)}
              </span>
            </div>
            {order.paymentConfirmedAt && (
              <p className="text-sm text-accent-teal">
                {t('paidAt', { date: formatVnDate(order.paymentConfirmedAt) })}
              </p>
            )}
          </Card>
        </div>

        {/* Right: customer + proofs + note */}
        <div className="flex flex-col gap-6">
          <Card elevation="md" className="flex flex-col gap-1 px-5 py-5">
            <h2 className="mb-1 font-semibold text-text-strong">{t('customer')}</h2>
            <p className="font-semibold text-text-strong">{order.customer.name}</p>
            <p className="font-mono text-sm text-text-body">{order.customer.phone}</p>
            {order.customer.email && (
              <p className="font-mono text-sm text-text-body">{order.customer.email}</p>
            )}
            {order.customer.socialHandle && (
              <p className="text-sm text-text-body">{order.customer.socialHandle}</p>
            )}
            <p className="mt-1 text-sm text-text-muted">
              {[
                order.shippingAddress.street,
                order.shippingAddress.ward,
                order.shippingAddress.province,
              ]
                .filter(Boolean)
                .join(', ')}
            </p>
          </Card>

          <Card elevation="md" className="flex flex-col gap-3 px-5 py-5">
            <h2 className="font-semibold text-text-strong">{t('payment')}</h2>
            <ProofLink
              url={order.paymentProofUrl}
              label={t('proofPayment')}
              missing={t('noProof')}
            />
            {order.refundProofUrl && (
              <ProofLink url={order.refundProofUrl} label={t('proofRefund')} />
            )}
            {order.qcPhotoUrl && <ProofLink url={order.qcPhotoUrl} label={t('proofQc')} />}
            {order.trackingCode && (
              <p className="text-sm text-text-body">
                {t('tracking')}:{' '}
                <span className="font-mono text-text-strong">{order.trackingCode}</span>
              </p>
            )}
          </Card>

          {order.note && (
            <Card elevation="md" className="px-5 py-5">
              <h2 className="mb-1 font-semibold text-text-strong">{t('note')}</h2>
              <p className="text-sm text-text-body">{order.note}</p>
            </Card>
          )}
        </div>
      </div>

      {/* Action bar — sticky at the bottom on mobile, inline on desktop */}
      <div className="sticky bottom-0 -mx-4 border-t border-border-subtle bg-surface-card/95 px-4 py-3 backdrop-blur md:static md:mx-0 md:border-0 md:bg-transparent md:p-0">
        {errorCode && (
          <p role="alert" className="mb-2 text-sm text-danger">
            {t(`error.${errorCode}`)}
          </p>
        )}
        {actions.length === 0 ? (
          <p className="text-sm text-text-muted">{t('noActions')}</p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {actions.map((action) => (
              <Button
                key={action.to}
                variant={
                  action.kind === 'cancel' || action.kind === 'refund' ? 'outline' : 'primary'
                }
                disabled={pending}
                onClick={() => onAction(action)}
              >
                {t(`action.${action.to}`)}
              </Button>
            ))}
          </div>
        )}
      </div>

      {dialog && (
        <TransitionDialog
          key={dialog.to}
          orderId={order.id}
          action={dialog}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

// itemSpecs joins the fulfillment facts into one line: color · options · engraving (all optional).
function itemSpecs(item: Order['items'][number], t: ReturnType<typeof useTranslations>): string {
  const parts: string[] = [];
  if (item.colorName) parts.push(item.colorName);
  if (item.optionLabels) parts.push(...item.optionLabels);
  if (item.personalization?.text) parts.push(t('engrave', { text: item.personalization.text }));
  return parts.join(' · ') || '—';
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-text-muted">{label}</span>
      <span className="font-mono text-text-body">{value}</span>
    </div>
  );
}

function Connector({ visible, reached }: { visible: boolean; reached: boolean }) {
  return (
    <span
      className={cn(
        'h-0.5 flex-1',
        !visible ? 'invisible' : reached ? 'bg-border-strong' : 'bg-border-subtle',
      )}
    />
  );
}

function StepCircle({ index, state }: { index: number; state: MilestoneState }) {
  return (
    <span
      className={cn(
        'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-sm font-semibold',
        state === 'done' && 'border-border-strong bg-surface-brand text-on-dark',
        state === 'current' && 'border-border-strong bg-primary text-on-primary',
        state === 'todo' && 'border-border-subtle bg-surface-card text-text-muted',
      )}
    >
      {state === 'done' ? '✓' : index + 1}
    </span>
  );
}

// A proof image is shown as a link that opens the full image in a new tab (no inline <img> → no
// next/image remote-host config, and the owner still gets the receipt/QC/refund photo one click away).
function ProofLink({ url, label, missing }: { url?: string; label: string; missing?: string }) {
  if (!url) return missing ? <p className="text-sm text-text-muted">{missing}</p> : null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex w-fit items-center gap-1 text-sm font-semibold text-accent-teal underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2"
    >
      {label} →
    </a>
  );
}
