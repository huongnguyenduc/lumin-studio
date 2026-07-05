import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Button } from '@lumin/ui';
import { fetchCustomerOrders, getCustomerProfile } from '@/lib/customer-session';
import { logoutCustomer } from '@/lib/customer-auth';
import { OrderHistoryList } from '@/components/order-history-list';
import { CtaLink } from '@/components/cta-link';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('account');
  // Private, per-customer page with no canonical content — keep it out of search indexes
  // (storefront rule §SEO: chặn index account/checkout/lookup).
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

/**
 * Account hub (/tai-khoan, P1-s). Reads the customer's own orders server-side (session cookie forwarded
 * to core-api) and renders the history with the reused P1-o timeline. No session (or an expired one) →
 * a login prompt in place (not a redirect — avoids a bounce loop and keeps /tai-khoan a stable URL).
 * Renders the full state set (unauthenticated · error · empty · list) per the storefront rule.
 */
export default async function AccountPage() {
  const t = await getTranslations('account');
  const result = await fetchCustomerOrders();

  if (result.status === 'unauthenticated') {
    return (
      <section className="mx-auto w-full max-w-[560px] px-4 py-10 text-center md:px-6">
        <h1 className="font-display text-2xl font-bold text-text-strong md:text-3xl">
          {t('loggedOutTitle')}
        </h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-text-muted">{t('loggedOutBody')}</p>
        <div className="mt-6 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <CtaLink href="/tai-khoan/dang-nhap">{t('loginCta')}</CtaLink>
          <CtaLink href="/tai-khoan/dang-ky" variant="outline">
            {t('registerCta')}
          </CtaLink>
        </div>
      </section>
    );
  }

  const profile = await getCustomerProfile();

  return (
    <section className="mx-auto w-full max-w-[640px] px-4 py-6 md:px-6 md:py-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-text-strong md:text-3xl">
            {profile ? t('greeting', { name: profile.name }) : t('heading')}
          </h1>
          {profile ? (
            <p className="mt-1 font-mono text-sm text-text-muted">{profile.email}</p>
          ) : null}
        </div>
        {/* Logout is a plain form → Server Action (clears the session + redirects home). Zero client JS. */}
        <form action={logoutCustomer}>
          <Button type="submit" variant="outline">
            {t('logout')}
          </Button>
        </form>
      </div>

      <h2 className="mt-8 font-display text-lg font-bold text-text-strong">{t('ordersHeading')}</h2>
      <div className="mt-4">
        {result.status === 'error' ? (
          <div role="alert" className="flex flex-col items-center gap-3 px-4 py-10 text-center">
            <h3 className="font-display text-base font-bold text-text-strong">{t('errorTitle')}</h3>
            <p className="max-w-sm text-sm text-text-muted">{t('errorBody')}</p>
            {/* Re-fetch by re-navigating to this route (Server Component has no client retry handler). */}
            <CtaLink href="/tai-khoan" variant="outline">
              {t('retry')}
            </CtaLink>
          </div>
        ) : (
          <OrderHistoryList orders={result.orders} />
        )}
      </div>
    </section>
  );
}
