'use client';

import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { formatVnd, formatVnNumber, formatVnRating } from '@lumin/core';
import { Badge } from '@lumin/ui';
import type { CostingBundle } from '@/lib/materials-fetch';
import {
  COSTING_TABS,
  FILAMENT_STATUS_TONE,
  filamentRows,
  filamentStockGrams,
  lowStockCount,
  primaryMachine,
  splitAuxCosts,
  sumAmountVnd,
  unitSymbol,
  wastePercent,
  type CostingTab,
} from '@/lib/materials';

/**
 * Vật tư & chi phí (ADR-039, admin design screen 8) — the read-only costing dashboard: a KPI row and
 * four tabs (Filament · Giờ máy · Chi phí phụ · Hao hụt). Everything renders from four server reads
 * (materials · machines · aux-costs · costing-summary); the write dialogs (nhập cuộn / thêm vật tư /
 * thêm máy / thêm chi phí / ghi in hỏng) are a later slice, so empty states here explain rather than
 * offer a CTA.
 *
 * Money discipline (always-must #2): int-VND amounts go straight through formatVnd; derived RATES
 * (₫/unit avg cost, ₫/hour) are floats → rounded once for the single formatter (`formatRate`); a 0 /
 * absent rate shows "—", never "0₫". Percentages (waste factor) use formatVnRating. No number is baked
 * into a string here. Rates read from the costing-summary are the server's authoritative values — the
 * same inputs the per-order snapshot froze — so this dashboard can never drift from a frozen margin.
 */
export function MaterialsView({ bundle }: { bundle: CostingBundle }) {
  const t = useTranslations('materials');
  const [tab, setTab] = useState<CostingTab>('filament');
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function onTabKeyDown(e: KeyboardEvent, idx: number) {
    const last = COSTING_TABS.length - 1;
    let next: number;
    if (e.key === 'ArrowRight') next = idx === last ? 0 : idx + 1;
    else if (e.key === 'ArrowLeft') next = idx === 0 ? last : idx - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;
    else return;
    e.preventDefault();
    setTab(COSTING_TABS[next]);
    tabRefs.current[next]?.focus();
  }

  return (
    <div className="flex flex-col gap-6">
      <KpiRow bundle={bundle} />

      <div className="flex flex-col gap-4">
        <div
          role="tablist"
          aria-label={t('tabsLabel')}
          className="flex flex-wrap gap-2 border-b border-border-subtle"
        >
          {COSTING_TABS.map((key, idx) => {
            const active = tab === key;
            return (
              <button
                key={key}
                ref={(el) => {
                  tabRefs.current[idx] = el;
                }}
                role="tab"
                id={`costing-tab-${key}`}
                aria-selected={active}
                aria-controls={`costing-panel-${key}`}
                tabIndex={active ? 0 : -1}
                onClick={() => setTab(key)}
                onKeyDown={(e) => onTabKeyDown(e, idx)}
                className={`-mb-px min-h-[44px] rounded-t-lg border-2 border-b-0 px-4 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2 ${
                  active
                    ? 'border-border-strong bg-primary text-on-primary'
                    : 'border-transparent text-text-muted hover:text-text-strong'
                }`}
              >
                {t(`tabs.${key}`)}
              </button>
            );
          })}
        </div>

        <div
          role="tabpanel"
          id={`costing-panel-${tab}`}
          aria-labelledby={`costing-tab-${tab}`}
          tabIndex={0}
          className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2"
        >
          {tab === 'filament' && <FilamentPanel materials={bundle.materials} />}
          {tab === 'machine' && <MachinePanel machines={bundle.machines} />}
          {tab === 'aux' && <AuxPanel auxCosts={bundle.auxCosts} summary={bundle.summary} />}
          {tab === 'waste' && <WastePanel summary={bundle.summary} />}
        </div>
      </div>
    </div>
  );
}

/** A derived RATE (₫/unit, ₫/hour) is a float → round once for the single money formatter; a 0 or
 *  absent rate (no imports, no primary machine) shows "—", never a misleading "0₫". */
function formatRate(rate: number | null | undefined): string {
  if (rate == null || rate <= 0) return '—';
  return formatVnd(Math.round(rate));
}

// ── KPI row ─────────────────────────────────────────────────────────────────────────────────────

function KpiRow({ bundle }: { bundle: CostingBundle }) {
  const t = useTranslations('materials.kpi');
  const grams = filamentStockGrams(bundle.materials);
  const low = lowStockCount(bundle.materials);
  const { summary } = bundle;

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard
        label={t('stockLabel')}
        value={t('stock', { qty: formatVnNumber(grams) })}
        sub={low > 0 ? t('lowStock', { count: low }) : t('stockOk')}
        subTone={low > 0 ? 'danger' : 'muted'}
      />
      <KpiCard
        label={t('machineRateLabel')}
        value={
          summary.primaryMachineVndPerHour != null
            ? t('perHour', { rate: formatRate(summary.primaryMachineVndPerHour) })
            : '—'
        }
        sub={summary.primaryMachineVndPerHour != null ? t('primaryMachine') : t('noPrimary')}
        subTone="muted"
      />
      <KpiCard
        label={t('wasteLabel')}
        value={t('wasteValue', { pct: formatVnRating(wastePercent(summary.wasteFactor)) })}
        sub={t('wasteWindow')}
        subTone="muted"
      />
      <KpiCard
        label={t('auxLabel')}
        value={formatVnd(summary.auxPerOrderVnd)}
        sub={t('auxOrders', { count: summary.realOrders30d })}
        subTone="muted"
      />
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
  subTone,
}: {
  label: string;
  value: string;
  sub: string;
  subTone: 'muted' | 'danger';
}) {
  return (
    <div className="rounded-xl border border-border-subtle bg-surface-sunken px-4 py-3">
      <p className="font-mono text-xs uppercase tracking-wide text-text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-text-strong">{value}</p>
      <p
        className={`mt-1 font-mono text-xs ${subTone === 'danger' ? 'text-danger' : 'text-text-muted'}`}
      >
        {sub}
      </p>
    </div>
  );
}

// ── Shared bits ─────────────────────────────────────────────────────────────────────────────────

/** A small colour chip. hex is admin-controlled and validated server-side (regex, ADR-039 4a); an
 *  absent/blank hex → a dashed placeholder (no inline background). */
function Swatch({ hex }: { hex?: string | null }) {
  if (!hex) {
    return (
      <span
        aria-hidden="true"
        className="h-4 w-4 shrink-0 rounded border border-dashed border-border-strong"
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="h-4 w-4 shrink-0 rounded border border-border-strong"
      style={{ backgroundColor: hex }}
    />
  );
}

/** An informative empty state — prose only. The create CTA arrives with the write dialogs (next
 *  slice), so this explains what the tab holds rather than offering a dead button. */
function EmptyPanel({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border-2 border-dashed border-border-subtle bg-surface-card px-6 py-12 text-center">
      <p className="mx-auto max-w-sm text-sm text-text-muted">{children}</p>
    </div>
  );
}

/** A framed explainer / calc card (the right rail beside each tab's table). */
function InfoCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col rounded-xl border-2 border-border-strong bg-surface-sunken p-4">
      <h3 className="text-base font-semibold text-text-strong">{title}</h3>
      {children}
    </div>
  );
}

/** One "label ....... value" line inside an InfoCard. */
function CalcRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-text-muted">{label}</span>
      <span className="font-mono tabular-nums text-text-strong">{value}</span>
    </div>
  );
}

// ── Tab 1 · Filament ────────────────────────────────────────────────────────────────────────────

function FilamentPanel({ materials }: { materials: CostingBundle['materials'] }) {
  const t = useTranslations('materials.filament');
  const rows = filamentRows(materials);

  if (rows.length === 0) {
    return <EmptyPanel>{t('empty')}</EmptyPanel>;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr] lg:items-start">
      <div className="overflow-x-auto rounded-xl border border-border-subtle bg-surface-card">
        <table className="w-full min-w-[32rem] text-left text-sm">
          <thead>
            <tr className="border-b border-border-subtle font-mono text-xs uppercase tracking-wide text-text-muted">
              <th scope="col" className="px-3 py-2 font-medium">
                {t('colName')}
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                {t('colType')}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                {t('colCost')}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                {t('colStock')}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                {t('colStatus')}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-border-subtle last:border-0">
                <td className="px-3 py-2">
                  <span className="flex items-center gap-2 font-medium text-text-strong">
                    <Swatch hex={row.hex} />
                    {row.name}
                  </span>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-text-muted">{row.material}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-text-strong">
                  {row.avgCostPerUnit > 0
                    ? t('perUnit', {
                        rate: formatVnd(Math.round(row.avgCostPerUnit)),
                        unit: unitSymbol(row.unit),
                      })
                    : '—'}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-text-muted">
                  {t('qty', { qty: formatVnNumber(row.stockQty), unit: unitSymbol(row.unit) })}
                </td>
                <td className="px-3 py-2 text-right">
                  <Badge tone={FILAMENT_STATUS_TONE[row.status]}>{t(`status.${row.status}`)}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <InfoCard title={t('explainerTitle')}>
        <p className="mt-2 font-mono text-xs leading-relaxed text-text-muted">{t('explainer')}</p>
        <p className="mt-3 border-t border-dashed border-border-strong pt-3 font-mono text-xs text-text-muted">
          {t('lotsDeferred')}
        </p>
      </InfoCard>
    </div>
  );
}

// ── Tab 2 · Giờ máy ─────────────────────────────────────────────────────────────────────────────

function MachinePanel({ machines }: { machines: CostingBundle['machines'] }) {
  const t = useTranslations('materials.machine');

  if (machines.length === 0) {
    return <EmptyPanel>{t('empty')}</EmptyPanel>;
  }

  const primary = primaryMachine(machines);

  return (
    <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr] lg:items-start">
      <div className="overflow-x-auto rounded-xl border border-border-subtle bg-surface-card">
        <table className="w-full min-w-[34rem] text-left text-sm">
          <thead>
            <tr className="border-b border-border-subtle font-mono text-xs uppercase tracking-wide text-text-muted">
              <th scope="col" className="px-3 py-2 font-medium">
                {t('colMachine')}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                {t('colPrice')}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                {t('colDep')}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                {t('colHours')}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                {t('colRate')}
              </th>
            </tr>
          </thead>
          <tbody>
            {machines.map((m) => (
              <tr key={m.id} className="border-b border-border-subtle last:border-0">
                <td className="px-3 py-2">
                  <span className="flex flex-wrap items-center gap-2 font-medium text-text-strong">
                    {m.name}
                    {m.isPrimary && m.active && <Badge tone="primary">{t('primaryTag')}</Badge>}
                    {!m.active && <Badge tone="neutral">{t('inactiveTag')}</Badge>}
                  </span>
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-text-strong">
                  {formatVnd(m.purchasePriceVnd)}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-text-muted">
                  {t('months', { n: m.depreciationMonths })}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-text-muted">
                  {t('hours', { n: m.expectedHoursPerMonth })}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-text-strong">
                  {t('perHour', { rate: formatRate(m.costPerHour) })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {primary ? (
        <InfoCard title={t('calcTitle', { name: primary.name })}>
          <div className="mt-3 flex flex-col gap-2">
            <CalcRow label={t('price')} value={formatVnd(primary.purchasePriceVnd)} />
            <CalcRow label={t('dep')} value={t('months', { n: primary.depreciationMonths })} />
            <CalcRow
              label={t('perMonth')}
              value={formatVnd(Math.round(primary.purchasePriceVnd / primary.depreciationMonths))}
            />
            <CalcRow
              label={t('runHours')}
              value={t('hours', { n: primary.expectedHoursPerMonth })}
            />
          </div>
          <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-dashed border-border-strong pt-3">
            <span className="text-sm text-text-strong">{t('rate')}</span>
            <span className="font-mono text-lg font-semibold tabular-nums text-primary">
              {t('perHour', { rate: formatRate(primary.costPerHour) })}
            </span>
          </div>
          <p className="mt-3 font-mono text-xs leading-relaxed text-text-muted">{t('calcNote')}</p>
        </InfoCard>
      ) : (
        <InfoCard title={t('calcTitle', { name: '' })}>
          <p className="mt-2 font-mono text-xs leading-relaxed text-text-muted">{t('noPrimary')}</p>
        </InfoCard>
      )}
    </div>
  );
}

// ── Tab 3 · Chi phí phụ ─────────────────────────────────────────────────────────────────────────

function AuxPanel({
  auxCosts,
  summary,
}: {
  auxCosts: CostingBundle['auxCosts'];
  summary: CostingBundle['summary'];
}) {
  const t = useTranslations('materials.aux');

  if (auxCosts.length === 0) {
    return <EmptyPanel>{t('empty')}</EmptyPanel>;
  }

  const { perOrder, perMonth } = splitAuxCosts(auxCosts);

  return (
    <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr] lg:items-start">
      <div className="flex flex-col gap-3">
        <AuxTable title={t('perOrderTitle')} note={t('perOrderNote')} rows={perOrder} />
        <AuxTable title={t('perMonthTitle')} note={t('perMonthNote')} rows={perMonth} />
      </div>

      <InfoCard title={t('allocTitle')}>
        <div className="mt-3 flex flex-col gap-2">
          <CalcRow label={t('allocPerOrder')} value={formatVnd(sumAmountVnd(perOrder))} />
          <CalcRow label={t('allocMonthly')} value={formatVnd(sumAmountVnd(perMonth))} />
          <CalcRow label={t('allocOrders')} value={t('orders', { count: summary.realOrders30d })} />
        </div>
        <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-dashed border-border-strong pt-3">
          <span className="text-sm text-text-strong">{t('allocResult')}</span>
          <span className="font-mono text-lg font-semibold tabular-nums text-primary">
            {formatVnd(summary.auxPerOrderVnd)}
          </span>
        </div>
        <p className="mt-3 font-mono text-xs leading-relaxed text-text-muted">{t('allocNote')}</p>
      </InfoCard>
    </div>
  );
}

function AuxTable({
  title,
  note,
  rows,
}: {
  title: string;
  note: string;
  rows: CostingBundle['auxCosts'];
}) {
  const t = useTranslations('materials.aux');
  return (
    <div className="overflow-hidden rounded-xl border border-border-subtle bg-surface-card">
      <div className="flex items-center justify-between gap-2 border-b border-border-subtle bg-surface-sunken px-3 py-2">
        <span className="text-sm font-semibold text-text-strong">{title}</span>
        <span className="font-mono text-xs text-text-muted">{note}</span>
      </div>
      {rows.length === 0 ? (
        <p className="px-3 py-4 text-sm text-text-muted">{t('sectionEmpty')}</p>
      ) : (
        <ul>
          {rows.map((a) => (
            <li
              key={a.id}
              className="flex items-center justify-between gap-3 border-b border-border-subtle px-3 py-2 last:border-0"
            >
              <span className="text-sm text-text-strong">{a.label}</span>
              <span className="font-mono text-sm tabular-nums text-text-strong">
                {formatVnd(a.amountVnd)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Tab 4 · Hao hụt ─────────────────────────────────────────────────────────────────────────────

function WastePanel({ summary }: { summary: CostingBundle['summary'] }) {
  const t = useTranslations('materials.waste');

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.6fr] lg:items-start">
      <InfoCard title={t('factorTitle')}>
        <p className="mt-2 text-4xl font-semibold tabular-nums text-primary">
          {t('factorValue', { pct: formatVnRating(wastePercent(summary.wasteFactor)) })}
        </p>
        <p className="mt-1 font-mono text-xs text-text-muted">{t('factorNote')}</p>
        <p className="mt-4 border-t border-dashed border-border-strong pt-3 font-mono text-xs leading-relaxed text-text-muted">
          {t('explain')}
        </p>
      </InfoCard>

      <div className="rounded-xl border border-border-subtle bg-surface-card px-5 py-8 text-center">
        <p className="mx-auto max-w-md text-sm text-text-muted">{t('logDeferred')}</p>
      </div>
    </div>
  );
}
