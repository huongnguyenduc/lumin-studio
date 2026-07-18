'use client';

import { useTranslations } from 'next-intl';
import { formatVnDateTime, type OrderStatus } from '@lumin/core';
import { Badge, cn, ORDER_STATUS_TONE } from '@lumin/ui';
import type { StepState, TimelineModel } from '@/lib/order-lookup-view';

/** The toned status pill with its translated label — shared by the result header and the close banner. */
export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const tStatus = useTranslations('core.orderStatus');
  const { tone, solid } = ORDER_STATUS_TONE[status];
  return (
    <Badge tone={tone} solid={solid}>
      {tStatus(status)}
    </Badge>
  );
}

/** The step marker. Decorative — the status is conveyed by the adjacent label text, so it's aria-hidden. */
function StepDot({ state }: { state: StepState }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'mt-0.5 h-4 w-4 shrink-0 rounded-full',
        state === 'done' && 'bg-border-strong',
        state === 'current' && 'bg-accent-flame ring-2 ring-border-strong ring-offset-1',
        state === 'upcoming' && 'border-2 border-border-default bg-surface-card',
      )}
    />
  );
}

/**
 * The order status timeline: a vertical stepper over the 5 progress milestones (spec §04), plus a
 * separate close banner when the order was cancelled/refunded and a carrier-code row once shipping.
 * Status names come from @lumin/core (core.orderStatus.*, shared with the account P1-s); timestamps
 * from formatVnDateTime (core — the only place Intl date formatting lives). Pure presentation.
 */
export function OrderTimeline({ model }: { model: TimelineModel }) {
  const tStatus = useTranslations('core.orderStatus');
  const t = useTranslations('lookup');

  return (
    <div>
      <h3 className="font-display text-base font-bold text-text-strong">{t('timelineHeading')}</h3>

      <ol className="mt-4">
        {model.steps.map((step, i) => {
          const isLast = i === model.steps.length - 1;
          return (
            <li
              key={step.status}
              aria-current={step.state === 'current' ? 'step' : undefined}
              className="flex gap-3"
            >
              <div className="flex flex-col items-center self-stretch">
                <StepDot state={step.state} />
                {!isLast ? (
                  <span
                    aria-hidden="true"
                    className={cn(
                      'w-0.5 flex-1',
                      step.state === 'done' ? 'bg-border-strong' : 'bg-border-subtle',
                    )}
                  />
                ) : null}
              </div>

              <div className={cn(isLast ? 'pb-0' : 'pb-6')}>
                <p
                  className={cn(
                    'font-display text-sm',
                    step.state === 'upcoming'
                      ? 'font-medium text-text-muted'
                      : 'font-bold text-text-strong',
                    step.state === 'current' && 'text-accent-flame',
                  )}
                >
                  {tStatus(step.status)}
                  {step.state === 'current' ? (
                    <span className="sr-only">{t('currentStep')}</span>
                  ) : null}
                </p>
                {step.at ? (
                  <p className="mt-0.5 font-mono text-xs text-text-muted">
                    {formatVnDateTime(step.at)}
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      {model.closeState ? (
        <div className="mt-2 flex flex-col items-start gap-2 rounded-lg border-2 border-border-default bg-surface-sunken p-4">
          <OrderStatusBadge status={model.closeState.status} />
          <p className="text-sm text-text-muted">
            {t(model.closeState.status === 'CANCELLED' ? 'cancelledNote' : 'refundedNote')}
          </p>
          {model.closeState.at ? (
            <p className="font-mono text-xs text-text-muted">
              {formatVnDateTime(model.closeState.at)}
            </p>
          ) : null}
        </div>
      ) : null}

      {model.trackingCode ? (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border-2 border-border-default bg-surface-card p-4">
          <span className="text-sm font-medium text-text-strong">{t('trackingLabel')}</span>
          <span className="font-mono text-sm text-text-body">{model.trackingCode}</span>
        </div>
      ) : null}
    </div>
  );
}
