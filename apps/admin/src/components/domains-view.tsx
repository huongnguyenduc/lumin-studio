'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button, Card, Input } from '@lumin/ui';
import type { components } from '@lumin/api-client';
import { createDomain, deleteDomain, updateDomain } from '@/lib/domains-actions';
import type { DomainsList, DomainTargetsList } from '@/lib/domains-fetch';

type Domain = components['schemas']['Domain'];
type DomainTarget = components['schemas']['DomainTarget'];

// "Tên miền" (quản lý domain): the owner-only surface to provision/deprovision/repoint
// customer-site subdomains on *.luminstudio.vn. Each row is a live traefik Ingress in the k3s
// prod namespace — there is no DB table, so create/update/delete talk straight to core-api's
// k8s-backed endpoints. router.refresh() after each write re-reads the RSC list. DNS itself (the
// one-time wildcard *.luminstudio.vn record) is a manual, one-time Cloudflare step — not part of
// this screen. The edit dialog can also rename a subdomain (server creates the new Ingress and
// deletes the old one — no in-place host rename in the k8s API), not just repoint its target.

/** Dialog state: closed, adding a new domain, or editing an existing one's target. */
type Editing = null | { mode: 'add' } | { mode: 'edit'; domain: Domain };

export function DomainsView({
  domains,
  targets,
}: {
  domains: DomainsList;
  targets: DomainTargetsList;
}) {
  const t = useTranslations('domains');
  const [editing, setEditing] = useState<Editing>(null);

  if (domains.status === 'forbidden') {
    return (
      <Card elevation="md" className="mx-auto max-w-md px-5 py-16 text-center">
        <p className="text-4xl" aria-hidden>
          🔒
        </p>
        <h1 className="mt-3 font-display text-xl font-semibold text-text-strong">
          {t('forbiddenTitle')}
        </h1>
        <p className="mt-2 text-sm text-text-muted">{t('forbiddenBody')}</p>
      </Card>
    );
  }

  if (domains.status === 'unavailable') {
    return (
      <Card elevation="md" className="mx-auto max-w-md px-5 py-16 text-center">
        <p className="text-4xl" aria-hidden>
          🔌
        </p>
        <h1 className="mt-3 font-display text-xl font-semibold text-text-strong">
          {t('unavailableTitle')}
        </h1>
        <p className="mt-2 text-sm text-text-muted">{t('unavailableBody')}</p>
      </Card>
    );
  }

  const targetList = targets.status === 'ok' ? targets.targets : [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-text-strong">{t('title')}</h1>
          <p className="mt-1 text-sm text-text-muted">{t('subtitle')}</p>
        </div>
        <Button onClick={() => setEditing({ mode: 'add' })} disabled={targetList.length === 0}>
          {t('add')}
        </Button>
      </div>

      {domains.domains.length === 0 ? (
        <Card elevation="md" className="px-5 py-16 text-center">
          <p className="text-text-muted">{t('empty')}</p>
        </Card>
      ) : (
        <Card elevation="md" className="overflow-hidden p-0">
          <ul className="divide-y divide-border-subtle">
            {domains.domains.map((d) => (
              <DomainRow
                key={d.subdomain}
                domain={d}
                onEdit={() => setEditing({ mode: 'edit', domain: d })}
              />
            ))}
          </ul>
        </Card>
      )}

      {editing && (
        <DomainFormDialog
          mode={editing.mode}
          domain={editing.mode === 'edit' ? editing.domain : undefined}
          targets={targetList}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function DomainRow({ domain, onEdit }: { domain: Domain; onEdit: () => void }) {
  const t = useTranslations('domains');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function remove() {
    setError(null);
    startTransition(async () => {
      const res = await deleteDomain(domain.subdomain);
      if (res.ok) {
        router.refresh();
      } else {
        setConfirming(false);
        setError(res.code);
      }
    });
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-4 px-5 py-3">
      <div className="min-w-0">
        <p className="truncate font-display font-semibold text-text-strong">
          {t('hostFormat', { subdomain: domain.subdomain })}
        </p>
        <p className="truncate text-sm text-text-muted">
          {t('colTarget')}: {domain.targetService}:{domain.targetPort}
        </p>
        {error && (
          <p role="alert" className="mt-1 text-sm text-danger">
            {t(`error.${error}`)}
          </p>
        )}
      </div>
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
              {t('edit')}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="min-h-[44px] rounded-pill px-3 text-sm text-danger hover:bg-danger/5"
            >
              {t('delete')}
            </button>
          </>
        )}
      </div>
    </li>
  );
}

function DomainFormDialog({
  mode,
  domain,
  targets,
  onClose,
}: {
  mode: 'add' | 'edit';
  domain?: Domain;
  targets: DomainTarget[];
  onClose: () => void;
}) {
  const t = useTranslations('domains');
  const router = useRouter();
  const [subdomain, setSubdomain] = useState(domain?.subdomain ?? '');
  const [targetService, setTargetService] = useState(
    domain?.targetService ?? targets[0]?.name ?? '',
  );
  const selectedTarget = targets.find((s) => s.name === targetService);
  const [targetPort, setTargetPort] = useState<number>(
    domain?.targetPort ?? selectedTarget?.ports[0] ?? 0,
  );
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const canSubmit = !pending && subdomain.trim() !== '' && targetService !== '' && targetPort > 0;

  function submit() {
    setError(null);
    const sub = subdomain.trim();
    startTransition(async () => {
      const res =
        mode === 'edit' && domain
          ? await updateDomain(domain.subdomain, {
              // Only send `subdomain` when it actually changed — omitting it on a same-value
              // resubmit keeps the request a plain target repoint, not a no-op rename.
              subdomain: sub !== domain.subdomain ? sub : undefined,
              targetService,
              targetPort,
            })
          : await createDomain({ subdomain: sub, targetService, targetPort });
      if (res.ok) {
        router.refresh();
        onClose();
      } else {
        setError(res.code);
      }
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="domains-form-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) submit();
        }}
        className="flex w-[min(28rem,100%)] flex-col gap-4 rounded-lg border-2 border-border-strong bg-surface-card p-6 shadow-lg"
      >
        <h2 id="domains-form-title" className="font-display text-xl font-semibold text-text-strong">
          {t(mode === 'edit' ? 'edit' : 'add')}
        </h2>

        <Input
          label={t('subdomainLabel')}
          value={subdomain}
          onChange={(e) => setSubdomain(e.target.value.trim().toLowerCase())}
          placeholder={t('subdomainPlaceholder')}
          hint={mode === 'add' ? t('subdomainHint') : t('subdomainRenameHint')}
          autoComplete="off"
        />

        <label className="flex flex-col gap-1.5">
          <span className="font-display text-sm font-medium text-text-strong">
            {t('targetLabel')}
          </span>
          <select
            value={targetService}
            onChange={(e) => {
              const next = targets.find((s) => s.name === e.target.value);
              setTargetService(e.target.value);
              setTargetPort(next?.ports[0] ?? 0);
            }}
            className="min-h-[44px] rounded-md border border-border-default bg-surface-card px-3 text-sm text-text-body focus-visible:border-primary focus-visible:outline-none"
          >
            {targets.length === 0 && <option value="">{t('targetPlaceholder')}</option>}
            {targets.map((svc) => (
              <option key={svc.name} value={svc.name}>
                {svc.name}
              </option>
            ))}
          </select>
        </label>

        {selectedTarget && selectedTarget.ports.length > 1 && (
          <label className="flex flex-col gap-1.5">
            <span className="font-display text-sm font-medium text-text-strong">
              {t('colTarget')}
            </span>
            <select
              value={targetPort}
              onChange={(e) => setTargetPort(Number(e.target.value))}
              className="min-h-[44px] rounded-md border border-border-default bg-surface-card px-3 text-sm text-text-body focus-visible:border-primary focus-visible:outline-none"
            >
              {selectedTarget.ports.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
        )}

        {error && (
          <p role="alert" className="text-sm text-danger">
            {t(`error.${error}`)}
          </p>
        )}

        <div className="mt-1 flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            {t('deleteConfirmNo')}
          </Button>
          <Button type="submit" disabled={!canSubmit}>
            {pending ? t('saving') : t('save')}
          </Button>
        </div>
      </form>
    </div>
  );
}
