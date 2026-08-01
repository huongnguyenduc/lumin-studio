'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button, Card, Input, cn } from '@lumin/ui';
import type { components } from '@lumin/api-client';
import { inviteStaff, createEncodeToken, revokeEncodeToken } from '@/lib/settings-actions';

type AdminStaff = components['schemas']['AdminStaff'];
type StaffData = { forbidden: true } | { forbidden: false; staff: AdminStaff[] };
type EncodeToken = components['schemas']['EncodeToken'];
type EncodeTokenData = { forbidden: true } | { forbidden: false; tokens: EncodeToken[] };

// "Cài đặt › Nhân viên & phân quyền" (P3-q, design screen 15). Owner-only: the team roster + an invite
// dialog (the owner sets an initial password shared out-of-band — no email-invite flow yet) + a
// DISPLAY-ONLY RBAC matrix. owner/staff are the two fixed roles (spec §08); the matrix documents them,
// it is NOT configurable (open-Q #3 → hiển-thị). A staff user who reaches the route gets the server's
// 403 → the "không đủ quyền" state (the FE can't read the httpOnly role). router.refresh() after an
// invite re-reads the RSC roster.

export function StaffView({ data, tokens }: { data: StaffData; tokens: EncodeTokenData }) {
  const t = useTranslations('settings');
  const [inviting, setInviting] = useState(false);

  if (data.forbidden) {
    return (
      <Card elevation="md" className="mx-auto max-w-md px-5 py-16 text-center">
        <p className="text-4xl" aria-hidden>
          🔒
        </p>
        <h1 className="mt-3 font-display text-xl font-semibold text-text-strong">
          {t('staff.forbiddenTitle')}
        </h1>
        <p className="mt-2 text-sm text-text-muted">{t('staff.forbiddenBody')}</p>
      </Card>
    );
  }

  const { staff } = data;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-text-strong">
            {t('staff.title')}
          </h1>
          <p className="mt-1 text-sm text-text-muted">{t('staff.subtitle')}</p>
        </div>
        <Button onClick={() => setInviting(true)}>{t('staff.invite')}</Button>
      </div>

      <Card elevation="md" className="overflow-hidden p-0">
        <ul className="divide-y divide-border-subtle">
          {staff.map((u) => (
            <StaffRow key={u.id} user={u} />
          ))}
        </ul>
      </Card>

      <RoleMatrix />

      {!tokens.forbidden && <EncodeTokensCard tokens={tokens.tokens} />}

      {inviting && <InviteDialog onClose={() => setInviting(false)} />}
    </div>
  );
}

function EncodeTokensCard({ tokens }: { tokens: EncodeToken[] }) {
  const t = useTranslations('settings');
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<components['schemas']['EncodeTokenCreated'] | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function doRevoke(id: string) {
    startTransition(async () => {
      await revokeEncodeToken(id);
      setRevokingId(null);
      router.refresh();
    });
  }

  return (
    <Card elevation="md" className="flex flex-col gap-4 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-semibold text-text-strong">
            {t('encodeTokens.title')}
          </h2>
          <p className="mt-1 text-sm text-text-muted">{t('encodeTokens.subtitle')}</p>
        </div>
        <Button variant="outline" onClick={() => setCreating(true)}>
          {t('encodeTokens.add')}
        </Button>
      </div>

      {tokens.length === 0 ? (
        <p className="text-sm text-text-muted">{t('encodeTokens.empty')}</p>
      ) : (
        <ul className="divide-y divide-border-subtle">
          {tokens.map((tok) => (
            <li key={tok.id} className="flex items-center justify-between gap-4 py-3">
              <div className="min-w-0">
                <p className="truncate font-display font-semibold text-text-strong">{tok.label}</p>
                <p className="truncate text-xs text-text-muted">
                  {new Date(tok.createdAt).toLocaleDateString('vi-VN')} ·{' '}
                  {tok.lastUsedAt
                    ? new Date(tok.lastUsedAt).toLocaleDateString('vi-VN')
                    : t('encodeTokens.neverUsed')}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-4">
                <span
                  className={cn(
                    'inline-flex items-center gap-1.5 text-xs',
                    tok.revoked ? 'text-text-muted' : 'text-accent-teal',
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'h-1.5 w-1.5 rounded-full',
                      tok.revoked ? 'bg-border-strong' : 'bg-accent-teal',
                    )}
                  />
                  {t(tok.revoked ? 'encodeTokens.revoked' : 'encodeTokens.active')}
                </span>
                {!tok.revoked && (
                  <Button
                    variant="outline"
                    onClick={() => setRevokingId(tok.id)}
                    disabled={pending}
                  >
                    {t('encodeTokens.revoke')}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {creating && (
        <CreateTokenDialog
          onClose={() => setCreating(false)}
          onCreated={(tok) => {
            setCreating(false);
            setCreated(tok);
            router.refresh();
          }}
        />
      )}
      {created && <TokenCreatedDialog token={created} onClose={() => setCreated(null)} />}
      {revokingId && (
        <ConfirmRevokeDialog
          onCancel={() => setRevokingId(null)}
          onConfirm={() => doRevoke(revokingId)}
          pending={pending}
        />
      )}
    </Card>
  );
}

function CreateTokenDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (token: components['schemas']['EncodeTokenCreated']) => void;
}) {
  const t = useTranslations('settings');
  const ref = useRef<HTMLDialogElement>(null);
  const [label, setLabel] = useState('');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await createEncodeToken(label.trim());
      if (res.ok) {
        onCreated(res.token);
      } else {
        setError(res.code);
      }
    });
  }

  const titleId = 'encode-token-create-title';
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      className="w-[min(28rem,calc(100vw-2rem))] rounded-lg border-2 border-border-strong bg-surface-card p-0 text-text-body shadow-lg backdrop:bg-black/40"
    >
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          if (!pending && label.trim()) submit();
        }}
        className="flex flex-col gap-4 p-6"
      >
        <h2 id={titleId} className="font-display text-xl font-semibold text-text-strong">
          {t('encodeTokens.createTitle')}
        </h2>
        <Input
          label={t('encodeTokens.labelLabel')}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={t('encodeTokens.labelPlaceholder')}
          autoComplete="off"
        />
        {error && (
          <p role="alert" className="text-sm text-danger">
            {t(`error.${error}`)}
          </p>
        )}
        <div className="mt-1 flex justify-end gap-3">
          <Button variant="outline" onClick={onClose} disabled={pending}>
            {t('encodeTokens.cancel')}
          </Button>
          <Button type="submit" disabled={pending || !label.trim()}>
            {pending ? t('encodeTokens.saving') : t('encodeTokens.save')}
          </Button>
        </div>
      </form>
    </dialog>
  );
}

function TokenCreatedDialog({
  token,
  onClose,
}: {
  token: components['schemas']['EncodeTokenCreated'];
  onClose: () => void;
}) {
  const t = useTranslations('settings');
  const ref = useRef<HTMLDialogElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const titleId = 'encode-token-created-title';
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      className="w-[min(30rem,calc(100vw-2rem))] rounded-lg border-2 border-border-strong bg-surface-card p-0 text-text-body shadow-lg backdrop:bg-black/40"
    >
      <div className="flex flex-col gap-4 p-6">
        <h2 id={titleId} className="font-display text-xl font-semibold text-text-strong">
          {t('encodeTokens.createdTitle')}
        </h2>
        <p className="text-sm text-text-muted">{t('encodeTokens.createdBody')}</p>
        <code className="break-all rounded-lg border-[1.5px] border-border-subtle bg-surface-sunken px-3 py-2 text-sm text-text-body">
          {token.token}
        </code>
        <div className="mt-1 flex justify-end gap-3">
          <Button
            variant="outline"
            onClick={() => {
              void navigator.clipboard.writeText(token.token).then(() => setCopied(true));
            }}
          >
            {copied ? t('encodeTokens.copied') : t('encodeTokens.copy')}
          </Button>
          <Button onClick={onClose}>{t('encodeTokens.done')}</Button>
        </div>
      </div>
    </dialog>
  );
}

function ConfirmRevokeDialog({
  onCancel,
  onConfirm,
  pending,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  const t = useTranslations('settings');
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      onClose={onCancel}
      className="w-[min(24rem,calc(100vw-2rem))] rounded-lg border-2 border-border-strong bg-surface-card p-6 text-text-body shadow-lg backdrop:bg-black/40"
    >
      <p className="text-sm text-text-body">{t('encodeTokens.revokeConfirm')}</p>
      <div className="mt-4 flex justify-end gap-3">
        <Button variant="outline" onClick={onCancel} disabled={pending}>
          {t('encodeTokens.revokeConfirmNo')}
        </Button>
        <Button onClick={onConfirm} disabled={pending}>
          {t('encodeTokens.revokeConfirmYes')}
        </Button>
      </div>
    </dialog>
  );
}

function StaffRow({ user }: { user: AdminStaff }) {
  const t = useTranslations('settings');
  const isOwner = user.role === 'owner';
  return (
    <li className="flex items-center justify-between gap-4 px-5 py-3">
      <div className="min-w-0">
        <p className="truncate font-display font-semibold text-text-strong">{user.name}</p>
        <p className="truncate text-sm text-text-muted">{user.email}</p>
      </div>
      <div className="flex shrink-0 items-center gap-4">
        <span className="rounded-pill bg-surface-sunken px-2.5 py-0.5 text-xs font-semibold text-text-body">
          {t(isOwner ? 'staff.roleOwner' : 'staff.roleStaff')}
        </span>
        <span
          className={cn(
            'inline-flex items-center gap-1.5 text-xs',
            user.active ? 'text-accent-teal' : 'text-text-muted',
          )}
        >
          <span
            aria-hidden
            className={cn(
              'h-1.5 w-1.5 rounded-full',
              user.active ? 'bg-accent-teal' : 'bg-border-strong',
            )}
          />
          {t(user.active ? 'staff.active' : 'staff.inactive')}
        </span>
      </div>
    </li>
  );
}

// The two fixed roles' permissions, transcribed from spec §08 (owner = full; staff = orders/print/
// reviews/extension only). Display-only — there is no toggle. `key` maps to a settings.staff.* label.
const MATRIX: { key: string; owner: boolean; staff: boolean }[] = [
  { key: 'permOrders', owner: true, staff: true },
  { key: 'permPrint', owner: true, staff: true },
  { key: 'permReviews', owner: true, staff: true },
  { key: 'permExtension', owner: true, staff: true },
  { key: 'permCatalog', owner: true, staff: false },
  { key: 'permMaterials', owner: true, staff: false },
  { key: 'permReconcile', owner: true, staff: false },
  { key: 'permSettings', owner: true, staff: false },
];

function RoleMatrix() {
  const t = useTranslations('settings');
  return (
    <Card elevation="md" className="flex flex-col gap-4 p-5">
      <div>
        <h2 className="font-display text-lg font-semibold text-text-strong">
          {t('staff.matrixTitle')}
        </h2>
        <p className="mt-1 text-sm text-text-muted">{t('staff.matrixNote')}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[24rem] border-collapse text-sm">
          <thead>
            <tr className="text-text-muted">
              <th scope="col" className="py-2 pr-4 text-left font-medium">
                {t('staff.colPerm')}
              </th>
              <th scope="col" className="px-3 py-2 text-center font-medium">
                {t('staff.roleOwner')}
              </th>
              <th scope="col" className="px-3 py-2 text-center font-medium">
                {t('staff.roleStaff')}
              </th>
            </tr>
          </thead>
          <tbody>
            {MATRIX.map((row) => (
              <tr key={row.key} className="border-t border-border-subtle">
                <th scope="row" className="py-2 pr-4 text-left font-normal text-text-body">
                  {t(`staff.${row.key}`)}
                </th>
                <MatrixCell allowed={row.owner} />
                <MatrixCell allowed={row.staff} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function MatrixCell({ allowed }: { allowed: boolean }) {
  const t = useTranslations('settings');
  return (
    <td className="px-3 py-2 text-center">
      <span className={allowed ? 'text-accent-teal' : 'text-text-muted'}>
        <span aria-hidden>{allowed ? '✓' : '—'}</span>
        <span className="sr-only">{t(allowed ? 'staff.has' : 'staff.hasNot')}</span>
      </span>
    </td>
  );
}

function InviteDialog({ onClose }: { onClose: () => void }) {
  const t = useTranslations('settings');
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AdminStaff['role']>('staff');
  const [password, setPassword] = useState('');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const canSubmit = !pending && name.trim() !== '' && email.trim() !== '' && password.length >= 8;

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await inviteStaff({ name: name.trim(), email: email.trim(), role, password });
      if (res.ok) {
        router.refresh();
        onClose();
      } else {
        setError(res.code);
      }
    });
  }

  const titleId = 'staff-invite-title';
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      className="w-[min(30rem,calc(100vw-2rem))] rounded-lg border-2 border-border-strong bg-surface-card p-0 text-text-body shadow-lg backdrop:bg-black/40"
    >
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) submit();
        }}
        className="flex flex-col gap-4 p-6"
      >
        <h2 id={titleId} className="font-display text-xl font-semibold text-text-strong">
          {t('staff.inviteTitle')}
        </h2>

        <Input
          label={t('staff.nameLabel')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('staff.namePlaceholder')}
          autoComplete="off"
        />
        <Input
          label={t('staff.emailLabel')}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t('staff.emailPlaceholder')}
          autoComplete="off"
        />

        <label className="flex flex-col gap-1.5">
          <span className="font-display text-sm font-medium text-text-strong">
            {t('staff.roleLabel')}
          </span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as AdminStaff['role'])}
            className="min-h-[44px] rounded-md border border-border-default bg-surface-card px-3 text-sm text-text-body focus-visible:border-primary focus-visible:outline-none"
          >
            <option value="staff">{t('staff.roleStaff')}</option>
            <option value="owner">{t('staff.roleOwner')}</option>
          </select>
        </label>

        <Input
          label={t('staff.passwordLabel')}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          minLength={8}
          hint={t('staff.passwordHint')}
        />

        {error && (
          <p role="alert" className="text-sm text-danger">
            {t(`error.${error}`)}
          </p>
        )}

        <div className="mt-1 flex justify-end gap-3">
          <Button variant="outline" onClick={onClose} disabled={pending}>
            {t('staff.cancel')}
          </Button>
          <Button type="submit" disabled={!canSubmit}>
            {pending ? t('staff.saving') : t('staff.save')}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
