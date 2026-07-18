import { useState } from 'react';
import { Badge, Button, Input, ORDER_STATUS_TONE } from '@lumin/ui';
import { formatVnd, type OrderStatus, type Role } from '@lumin/core';
import type { components } from '@lumin/api-client';
import { t, type MessageKey } from '../i18n';
import { fetchOrderByCode, transitionOrder } from '../lib/lookup';
import { nextActions, parseOrderCode, progressSteps, type OrderAction } from '../lib/lookup-view';

type Order = components['schemas']['Order'];

// Per-status i18n label — the Badge tone/solid comes from the shared ORDER_STATUS_TONE map
// (@lumin/ui) so the panel and the desktop app read the same colours.
const STATUS_LABEL: Record<OrderStatus, MessageKey> = {
  PENDING_CONFIRM: 'lookup.status.PENDING_CONFIRM',
  PAID: 'lookup.status.PAID',
  PRINTING: 'lookup.status.PRINTING',
  SHIPPING: 'lookup.status.SHIPPING',
  COMPLETED: 'lookup.status.COMPLETED',
  CANCELLED: 'lookup.status.CANCELLED',
  REFUNDED: 'lookup.status.REFUNDED',
};

// The preset cancel reasons (mirrors the admin transition dialog). The SELECTED radio's translated label is
// what we store as statusHistory.reason (free vi text) — the server requires a non-empty reason for CANCELLED.
const CANCEL_REASON_KEYS = ['changedMind', 'outOfMaterial', 'duplicate'] as const;

type LookupState =
  | { status: 'idle' }
  | { status: 'invalid' }
  | { status: 'loading' }
  | { status: 'notfound' }
  | { status: 'error' }
  | { status: 'found'; order: Order };

// The "Tra cứu" tab: paste an order code (or a chat line containing one) → resolve it to the full order →
// show a detail card with the 5-step progress, a copy-ready status message for the customer, and the valid
// quick status updates for the actor's role. Assistive-only (ADR-011): staff paste the code and copy the
// message themselves; the panel never touches the Meta DOM.
export function Lookup({ role }: { role: Role }) {
  const [input, setInput] = useState('');
  const [state, setState] = useState<LookupState>({ status: 'idle' });

  async function onSearch() {
    const code = parseOrderCode(input);
    if (!code) {
      setState({ status: 'invalid' });
      return;
    }
    setState({ status: 'loading' });
    const res = await fetchOrderByCode(code);
    if (res.ok) setState({ status: 'found', order: res.order });
    else setState({ status: res.code === 'not_found' ? 'notfound' : 'error' });
  }

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void onSearch();
        }}
      >
        <Input
          label={t('lookup.code.label')}
          placeholder="#LMN-1000"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          error={state.status === 'invalid' ? t('lookup.code.invalid') : undefined}
        />
        <Button type="submit" className="min-h-11" disabled={state.status === 'loading'}>
          {state.status === 'loading' ? t('lookup.searching') : t('lookup.search')}
        </Button>
      </form>

      {state.status === 'loading' && (
        <p className="text-sm text-text-muted" role="status">
          {t('lookup.searching')}
        </p>
      )}
      {state.status === 'notfound' && (
        <p className="text-sm text-text-muted" role="status">
          {t('lookup.notFound')}
        </p>
      )}
      {state.status === 'error' && (
        <p className="text-sm text-danger" role="alert">
          {t('lookup.error')}
        </p>
      )}
      {state.status === 'found' && (
        <OrderCard
          order={state.order}
          role={role}
          onChanged={(order) => setState({ status: 'found', order })}
        />
      )}
    </div>
  );
}

function OrderCard({
  order,
  role,
  onChanged,
}: {
  order: Order;
  role: Role;
  onChanged: (order: Order) => void;
}) {
  const { tone, solid } = ORDER_STATUS_TONE[order.status];
  const first = order.items[0];
  const firstName = first?.productName ?? t('lookup.item.unnamed');
  const more = order.items.length - 1;

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border-subtle bg-surface-card p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="font-mono text-sm font-semibold text-text-strong">{order.code}</span>
        <Badge tone={tone} solid={solid}>
          {t(STATUS_LABEL[order.status])}
        </Badge>
      </div>

      <dl className="flex flex-col gap-1 text-sm">
        <Field label={t('lookup.field.customer')} value={order.customer.name} />
        <Field label={t('lookup.field.phone')} value={order.customer.phone} mono />
        <Field
          label={t('lookup.field.items')}
          value={more > 0 ? t('lookup.field.itemsMore', { name: firstName, more }) : firstName}
        />
        <Field label={t('lookup.field.total')} value={formatVnd(order.total)} mono strong />
      </dl>

      <ProgressTrack status={order.status} history={order.statusHistory} />

      <StatusMessage order={order} />

      <Actions order={order} role={role} onChanged={onChanged} />
    </div>
  );
}

function Field({
  label,
  value,
  mono,
  strong,
}: {
  label: string;
  value: string;
  mono?: boolean;
  strong?: boolean;
}) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-text-muted">{label}</dt>
      <dd
        className={
          'text-right ' +
          (strong ? 'font-semibold text-text-strong ' : 'text-text-body ') +
          (mono ? 'font-mono' : '')
        }
      >
        {value}
      </dd>
    </div>
  );
}

// The 5-step milestone track. Done = filled, current = ringed, todo = muted. Purely a read of the order's
// statusHistory (progressSteps) — the terminal banner for a CANCELLED/REFUNDED close state is the status Badge
// above, so the track just shows how far the happy path got.
function ProgressTrack({
  status,
  history,
}: {
  status: OrderStatus;
  history: Order['statusHistory'];
}) {
  const steps = progressSteps(status, history);
  return (
    <ol className="flex items-center gap-1" aria-label={t('lookup.progress.label')}>
      {steps.map((step, i) => (
        <li key={step.status} className="flex flex-1 items-center gap-1">
          <span
            className={
              'h-2.5 w-2.5 shrink-0 rounded-full ' +
              (step.state === 'done'
                ? 'bg-primary'
                : step.state === 'current'
                  ? 'bg-primary ring-2 ring-primary/30'
                  : 'bg-border-default')
            }
            aria-label={t(STATUS_LABEL[step.status])}
            title={t(STATUS_LABEL[step.status])}
          />
          {i < steps.length - 1 && (
            <span
              className={
                'h-0.5 flex-1 ' + (step.state === 'done' ? 'bg-primary' : 'bg-border-subtle')
              }
              aria-hidden="true"
            />
          )}
        </li>
      ))}
    </ol>
  );
}

// The copy-ready message the staff pastes to the customer (assistive-only: WE never inject it into Messenger,
// staff copy + paste it themselves — ADR-011). One friendly line per status, warm voice, with the order code.
function StatusMessage({ order }: { order: Order }) {
  const [copied, setCopied] = useState(false);
  const tracking = order.trackingCode
    ? t('lookup.msg.trackingSuffix', { code: order.trackingCode })
    : '';
  const message = t(`lookup.msg.${order.status}` as MessageKey, { code: order.code, tracking });

  async function copy() {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border-subtle bg-surface-sunken p-3">
      <p className="text-sm text-text-body">{message}</p>
      <Button variant="outline" size="sm" className="min-h-11 self-start" onClick={copy}>
        {copied ? t('lookup.msg.copied') : t('lookup.msg.copy')}
      </Button>
    </div>
  );
}

function Actions({
  order,
  role,
  onChanged,
}: {
  order: Order;
  role: Role;
  onChanged: (order: Order) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const actions = nextActions(order.status, role);
  const hasDefer = actions.some((a) => a.kind === 'defer');

  async function run(to: OrderStatus, reason?: string) {
    setBusy(true);
    setError(null);
    const res = await transitionOrder(order.id, { to, ...(reason ? { reason } : {}) });
    setBusy(false);
    if (res.ok) {
      setCancelling(false);
      onChanged(res.order);
    } else {
      setError(actionErrorKey(res.code));
    }
  }

  if (actions.length === 0) {
    return <p className="text-sm text-text-subtle">{t('lookup.action.none')}</p>;
  }

  return (
    <div className="flex flex-col gap-2 border-t border-border-subtle pt-3">
      <span className="font-display text-sm font-semibold text-text-strong">
        {t('lookup.action.section')}
      </span>

      {cancelling ? (
        <CancelReason
          busy={busy}
          onBack={() => setCancelling(false)}
          onConfirm={(key) => run('CANCELLED', t(`lookup.cancelReason.${key}` as MessageKey))}
        />
      ) : (
        <div className="flex flex-col gap-2">
          {actions.map((a) => (
            <ActionButton
              key={a.to}
              action={a}
              busy={busy}
              onDirect={run}
              onCancel={() => setCancelling(true)}
            />
          ))}
          {hasDefer && <p className="text-xs text-text-muted">{t('lookup.action.deferHint')}</p>}
        </div>
      )}

      {error && (
        <p className="text-sm text-danger" role="alert">
          {t(error)}
        </p>
      )}
    </div>
  );
}

function ActionButton({
  action,
  busy,
  onDirect,
  onCancel,
}: {
  action: OrderAction;
  busy: boolean;
  onDirect: (to: OrderStatus) => void;
  onCancel: () => void;
}) {
  const label = t(`lookup.action.${action.to}` as MessageKey);
  if (action.kind === 'defer') {
    return (
      <Button
        variant="outline"
        size="sm"
        className="min-h-11"
        disabled
        title={t('lookup.action.deferHint')}
      >
        {label} · {t('lookup.action.inAdmin')}
      </Button>
    );
  }
  if (action.kind === 'cancel') {
    return (
      <Button variant="outline" size="sm" className="min-h-11" disabled={busy} onClick={onCancel}>
        {label}
      </Button>
    );
  }
  return (
    <Button size="sm" className="min-h-11" disabled={busy} onClick={() => onDirect(action.to)}>
      {busy ? t('lookup.action.working') : label}
    </Button>
  );
}

function CancelReason({
  busy,
  onBack,
  onConfirm,
}: {
  busy: boolean;
  onBack: () => void;
  onConfirm: (key: (typeof CANCEL_REASON_KEYS)[number]) => void;
}) {
  const [key, setKey] = useState<(typeof CANCEL_REASON_KEYS)[number] | ''>('');
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-semibold text-text-strong">
        {t('lookup.cancel.reasonLabel')}
      </legend>
      {CANCEL_REASON_KEYS.map((k) => (
        <label key={k} className="flex min-h-11 items-center gap-2 text-sm text-text-body">
          <input
            type="radio"
            name="cancelReason"
            className="h-4 w-4"
            checked={key === k}
            onChange={() => setKey(k)}
          />
          {t(`lookup.cancelReason.${k}` as MessageKey)}
        </label>
      ))}
      <div className="flex gap-2">
        <Button variant="outline" size="sm" className="min-h-11" disabled={busy} onClick={onBack}>
          {t('lookup.cancel.back')}
        </Button>
        <Button
          size="sm"
          className="min-h-11"
          disabled={busy || key === ''}
          onClick={() => key !== '' && onConfirm(key)}
        >
          {busy ? t('lookup.action.working') : t('lookup.cancel.confirm')}
        </Button>
      </div>
    </fieldset>
  );
}

function actionErrorKey(code: 'forbidden' | 'conflict' | 'validation' | 'error'): MessageKey {
  switch (code) {
    case 'forbidden':
      return 'lookup.action.error.forbidden';
    case 'conflict':
      return 'lookup.action.error.conflict';
    case 'validation':
      return 'lookup.action.error.validation';
    default:
      return 'lookup.action.error.network';
  }
}
