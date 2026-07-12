import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { formatVnd, formatVnDate } from '@lumin/core';
import { Card } from '@lumin/ui';
import { fetchAdminCustomer } from '@/lib/customers-fetch';
import { OrderStatusBadge } from '@/components/order-status-badge';

/**
 * Admin customer-detail route (Khách hàng → hồ sơ, /khach-hang/{id}, P3-p). Async server component: reads
 * the id, fetches the full profile (GET /admin/customers/{id}) forwarding the session cookie, and renders
 * contact + saved addresses + order history + summed spend. No client interactivity (read-only this slice
 * — the internal note needs a column + write, deferred), so it stays a server component. A 404 renders the
 * friendly not-found here; any other fetch failure falls to (app)/error.tsx. Money is rendered by @lumin/
 * core formatVnd (always-must #2); the order status badge maps the enum to its i18n label (always-must #3).
 */
export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [customer, t] = await Promise.all([fetchAdminCustomer(id), getTranslations('customers')]);

  if (!customer) {
    return (
      <div className="flex flex-col gap-6">
        <BackLink label={t('backToList')} />
        <Card elevation="md" className="px-5 py-16 text-center">
          <p className="text-text-muted">{t('notFound')}</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <BackLink label={t('backToList')} />

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-text-strong">{customer.name}</h1>
          <p className="mt-1 font-mono text-xs text-text-muted">
            {t('since', { date: formatVnDate(customer.createdAt) })}
          </p>
        </div>
        <div className="text-right">
          <p className="font-display text-xl font-semibold text-text-strong">
            {formatVnd(customer.totalSpent)}
          </p>
          <p className="font-mono text-xs text-text-muted">
            {t('orderCount', { count: customer.orders.length })}
          </p>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-[1fr_1.4fr]">
        <Card elevation="md" className="flex flex-col gap-4 p-5">
          <h2 className="font-display text-lg font-semibold text-text-strong">{t('contact')}</h2>
          <dl className="flex flex-col gap-3">
            <Field label={t('phoneLabel')} value={customer.phone} />
            {customer.email && <Field label={t('emailLabel')} value={customer.email} />}
            {customer.socialHandle && (
              <Field label={t('socialLabel')} value={customer.socialHandle} />
            )}
          </dl>
          <div>
            <h3 className="font-display text-sm font-semibold text-text-strong">
              {t('addresses')}
            </h3>
            {customer.addresses.length === 0 ? (
              <p className="mt-2 text-sm text-text-muted">{t('noAddress')}</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-2">
                {customer.addresses.map((a, i) => (
                  <li
                    key={i}
                    className="rounded-lg border border-border-subtle px-3 py-2 font-mono text-xs text-text-body"
                  >
                    {a.street}, {a.ward}, {a.province}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        <Card elevation="md" className="flex flex-col gap-4 p-5">
          <h2 className="font-display text-lg font-semibold text-text-strong">
            {t('orderHistory')}
          </h2>
          {customer.orders.length === 0 ? (
            <p className="text-sm text-text-muted">{t('noOrders')}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border-subtle">
              {customer.orders.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="flex flex-col gap-0.5">
                    <span className="font-mono text-sm font-semibold text-text-strong">
                      {o.code}
                    </span>
                    <span className="font-mono text-xs text-text-muted">
                      {formatVnDate(o.createdAt)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-sm text-text-strong">{formatVnd(o.total)}</span>
                    <OrderStatusBadge status={o.status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function BackLink({ label }: { label: string }) {
  return (
    <Link
      href="/khach-hang"
      className="rounded text-sm font-semibold text-text-muted hover:text-text-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky"
    >
      {label}
    </Link>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className="font-mono text-sm text-text-body">{value}</dd>
    </div>
  );
}
