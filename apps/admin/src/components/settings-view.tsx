'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { formatVnd } from '@lumin/core';
import { Button, Card, Input } from '@lumin/ui';
import type { components } from '@lumin/api-client';
import {
  updateBankAccount,
  updateRefundPolicy,
  updateShippingRules,
  type SettingsResult,
} from '@/lib/settings-actions';
import { WILDCARD_PROVINCE, isStkConfigured, shippingRulesOf } from '@/lib/settings';

type Settings = components['schemas']['Settings'];

// The "Cài đặt › Thanh toán & ship" screen (P3-i, design screen 13): STK edit (+ the "chưa cấu hình STK ⇒
// chặn checkout" warning), the per-region shipping-fee table, and the refund-policy text. Every write is
// owner-only at the server; on success we router.refresh() so the RSC re-reads the saved config.
//
// ponytail: role is assumed `owner` (no /auth/me + no staff accounts until P3-q). The server's
// authOwnerOnly is the real wall — a staff attempt returns `forbidden`, surfaced inline. When P3-q lands
// a role signal, gate the edit controls read-only for staff; nothing here needs rewriting for that.

/** One section's save status: idle, just-saved, or an error code from the action. */
type SaveErrorCode = Extract<SettingsResult, { ok: false }>['code'];
type Status = 'idle' | 'saved' | SaveErrorCode;

export function SettingsView({ settings }: { settings: Settings }) {
  const t = useTranslations('settings');
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-text-strong">{t('title')}</h1>
        <p className="mt-1 text-sm text-text-muted">{t('subtitle')}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr] lg:items-start">
        <div className="flex flex-col gap-6">
          <BankAccountSection settings={settings} />
          <ShippingRulesSection settings={settings} />
          <RefundPolicySection settings={settings} />
        </div>
        <SubpagesCard />
      </div>
    </div>
  );
}

/** Small inline feedback under a section's Save button (saved ✓ or a translated error). */
function Feedback({ status }: { status: Status }) {
  const t = useTranslations('settings');
  if (status === 'idle') return null;
  if (status === 'saved') {
    return (
      <p role="status" className="text-sm text-accent-teal">
        {t('saved')}
      </p>
    );
  }
  return (
    <p role="alert" className="text-sm text-danger">
      {t(`error.${status}`)}
    </p>
  );
}

function BankAccountSection({ settings }: { settings: Settings }) {
  const t = useTranslations('settings');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<Status>('idle');
  const [bin, setBin] = useState(settings.bankAccount.bin ?? '');
  const [accountNumber, setAccountNumber] = useState(settings.bankAccount.accountNumber ?? '');
  const [accountName, setAccountName] = useState(settings.bankAccount.accountName ?? '');
  const [reason, setReason] = useState('');

  const configured = isStkConfigured(settings.bankAccount);
  const canSave =
    !pending && bin.trim() !== '' && accountNumber.trim() !== '' && accountName.trim() !== '';

  function save() {
    setStatus('idle');
    startTransition(async () => {
      const res = await updateBankAccount({
        bin: bin.trim(),
        accountNumber: accountNumber.trim(),
        accountName: accountName.trim(),
        reason: reason.trim() || undefined,
      });
      if (res.ok) {
        setReason('');
        setStatus('saved');
        router.refresh();
      } else {
        setStatus(res.code);
      }
    });
  }

  return (
    <Card elevation="md" className="flex flex-col gap-4 p-5">
      <div>
        <h2 className="font-display text-lg font-semibold text-text-strong">
          {t('payment.title')}
        </h2>
        <p className="mt-1 text-sm text-text-muted">{t('payment.subtitle')}</p>
      </div>

      {!configured && (
        <div
          role="alert"
          className="rounded-lg border border-danger/40 bg-danger/5 px-4 py-3 text-sm text-danger"
        >
          <p className="font-semibold">{t('payment.stkMissingTitle')}</p>
          <p className="mt-0.5 text-danger/90">{t('payment.stkMissingBody')}</p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label={t('payment.bin')}
          value={bin}
          onChange={(e) => setBin(e.target.value)}
          inputMode="numeric"
          autoComplete="off"
          placeholder="970436"
        />
        <Input
          label={t('payment.accountNumber')}
          value={accountNumber}
          onChange={(e) => setAccountNumber(e.target.value)}
          inputMode="numeric"
          autoComplete="off"
          placeholder="1023456789"
        />
      </div>
      <Input
        label={t('payment.accountName')}
        value={accountName}
        onChange={(e) => setAccountName(e.target.value)}
        autoComplete="off"
        placeholder="LUMIN STUDIO"
      />
      <Input
        label={t('payment.reason')}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        autoComplete="off"
        hint={t('payment.reasonHint')}
      />
      <p className="text-xs text-text-muted">{t('payment.qrNote')}</p>

      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={!canSave}>
          {pending ? t('saving') : t('payment.save')}
        </Button>
        <Feedback status={status} />
      </div>
    </Card>
  );
}

/** One editable row of the shipping table: province + optional ward + fee (fee kept as a string for
 *  the input). `ward` narrows the rule to one ward within the province (e.g. the owner marking which
 *  wards count as inner-city for a different fee) — blank = the whole province. */
type FeeRow = { province: string; ward: string; fee: string };

function ShippingRulesSection({ settings }: { settings: Settings }) {
  const t = useTranslations('settings');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<Status>('idle');
  const [rows, setRows] = useState<FeeRow[]>(() =>
    shippingRulesOf(settings).map((r) => ({
      province: r.province,
      ward: r.ward ?? '',
      fee: String(r.fee),
    })),
  );

  function setRow(i: number, patch: Partial<FeeRow>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
    setStatus('idle');
  }
  function addRow() {
    setRows((prev) => [...prev, { province: '', ward: '', fee: '' }]);
    setStatus('idle');
  }
  function removeRow(i: number) {
    setRows((prev) => prev.filter((_, idx) => idx !== i));
    setStatus('idle');
  }

  // Client-side gate mirrors the server: every province non-empty, every fee an EXPLICIT non-negative
  // integer. The `r.fee.trim() !== ''` guard matters — Number('') is 0, so a blank field would otherwise
  // silently save as free shipping. The server re-validates (it is the wall); this just stops a bad submit.
  const parsed = rows.map((r) => ({
    province: r.province.trim(),
    ...(r.ward.trim() !== '' ? { ward: r.ward.trim() } : {}),
    fee: Number(r.fee),
  }));
  const allValid = rows.every((r, i) => {
    const { province, fee } = parsed[i];
    return province !== '' && r.fee.trim() !== '' && Number.isInteger(fee) && fee >= 0;
  });
  const canSave = !pending && allValid;

  function save() {
    setStatus('idle');
    startTransition(async () => {
      const res = await updateShippingRules(parsed);
      if (res.ok) {
        setStatus('saved');
        router.refresh();
      } else {
        setStatus(res.code);
      }
    });
  }

  return (
    <Card elevation="md" className="flex flex-col gap-4 p-5">
      <div>
        <h2 className="font-display text-lg font-semibold text-text-strong">
          {t('shipping.title')}
        </h2>
        <p className="mt-1 text-sm text-text-muted">{t('shipping.subtitle')}</p>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border-default px-4 py-6 text-center text-sm text-text-muted">
          {t('shipping.empty')}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((row, i) => {
            const feeNum = Number(row.fee);
            const feeValid = Number.isInteger(feeNum) && feeNum >= 0;
            return (
              <li key={i} className="flex items-end gap-2">
                <div className="flex-1">
                  <Input
                    label={i === 0 ? t('shipping.colProvince') : undefined}
                    aria-label={i === 0 ? undefined : t('shipping.colProvince')}
                    value={row.province}
                    onChange={(e) => setRow(i, { province: e.target.value })}
                    placeholder={t('shipping.provincePlaceholder')}
                    autoComplete="off"
                  />
                  {row.province.trim() === WILDCARD_PROVINCE && (
                    <span className="mt-1 block text-xs text-text-muted">
                      {t('shipping.wildcardHint')}
                    </span>
                  )}
                </div>
                <div className="flex-1">
                  <Input
                    label={i === 0 ? t('shipping.colWard') : undefined}
                    aria-label={i === 0 ? undefined : t('shipping.colWard')}
                    value={row.ward}
                    onChange={(e) => setRow(i, { ward: e.target.value })}
                    placeholder={t('shipping.wardPlaceholder')}
                    autoComplete="off"
                  />
                  {row.ward.trim() !== '' && (
                    <span className="mt-1 block text-xs text-text-muted">
                      {t('shipping.wardHint')}
                    </span>
                  )}
                </div>
                <div className="w-32">
                  <Input
                    label={i === 0 ? t('shipping.colFee') : undefined}
                    aria-label={i === 0 ? undefined : t('shipping.colFee')}
                    value={row.fee}
                    onChange={(e) => setRow(i, { fee: e.target.value })}
                    inputMode="numeric"
                    placeholder="25000"
                    autoComplete="off"
                  />
                  {row.fee.trim() !== '' && feeValid && (
                    <span className="mt-1 block text-xs text-text-muted">{formatVnd(feeNum)}</span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => removeRow(i)}
                  aria-label={t('shipping.remove')}
                  className="mb-0.5 min-h-[44px] rounded-pill px-3 text-sm text-danger hover:bg-danger/5"
                >
                  <span aria-hidden>×</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <button
        type="button"
        onClick={addRow}
        className="min-h-[44px] rounded-lg border border-dashed border-border-default px-4 text-sm text-text-body hover:bg-surface-sunken"
      >
        {t('shipping.add')}
      </button>

      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={!canSave}>
          {pending ? t('saving') : t('shipping.save')}
        </Button>
        <Feedback status={status} />
      </div>
    </Card>
  );
}

function RefundPolicySection({ settings }: { settings: Settings }) {
  const t = useTranslations('settings');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<Status>('idle');
  const [text, setText] = useState(settings.refundPolicy);

  function save() {
    setStatus('idle');
    startTransition(async () => {
      const res = await updateRefundPolicy(text.trim());
      if (res.ok) {
        setStatus('saved');
        router.refresh();
      } else {
        setStatus(res.code);
      }
    });
  }

  return (
    <Card elevation="md" className="flex flex-col gap-4 p-5">
      <div>
        <h2 className="font-display text-lg font-semibold text-text-strong">{t('refund.title')}</h2>
        <p className="mt-1 text-sm text-text-muted">{t('refund.subtitle')}</p>
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="sr-only">{t('refund.title')}</span>
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setStatus('idle');
          }}
          rows={5}
          placeholder={t('refund.placeholder')}
          className="min-h-[120px] rounded-lg border border-border-default bg-surface-card px-3 py-2 text-sm text-text-body focus-visible:border-border-strong focus-visible:outline-none"
        />
      </label>
      <p className="text-xs text-text-muted">{t('refund.hint')}</p>
      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={pending}>
          {pending ? t('saving') : t('refund.save')}
        </Button>
        <Feedback status={status} />
      </div>
    </Card>
  );
}

/** Right-column card linking to the other settings sub-pages. "Mẫu trả lời" (P3-i), "Nhân viên"
 *  (P3-q) and "Kênh chat" (P3-r) are live; Extension is a Phase-4 track, shown as coming-soon. */
function SubpagesCard() {
  const t = useTranslations('settings');
  return (
    <Card elevation="md" className="flex flex-col gap-3 p-5">
      <h2 className="font-display text-lg font-semibold text-text-strong">{t('subpages.title')}</h2>
      {(
        [
          { href: '/cai-dat/mau-tra-loi', label: t('subpages.replyTemplates') },
          { href: '/cai-dat/nhan-vien', label: t('subpages.staff') },
          { href: '/cai-dat/kenh', label: t('subpages.channels') },
        ] as const
      ).map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          className="flex min-h-[44px] items-center justify-between rounded-lg border border-border-default px-4 py-2 text-sm text-text-body hover:bg-surface-sunken"
        >
          <span>{label}</span>
          <span aria-hidden className="text-text-muted">
            →
          </span>
        </Link>
      ))}
      <ul className="flex flex-col gap-2">
        {(['extension'] as const).map((key) => (
          <li
            key={key}
            className="flex items-center justify-between rounded-lg border border-dashed border-border-default px-4 py-2 text-sm text-text-muted"
          >
            <span>{t(`subpages.${key}`)}</span>
            <span className="text-xs">{t('subpages.comingSoon')}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
