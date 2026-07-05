import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { LoginForm } from '@/components/login-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('account.login');
  // Private auth page — keep it out of search indexes (storefront rule §SEO).
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

// Server shell — the form is interactive (a Server Action mints the session), so the work lives in the
// <LoginForm> client component.
export default function LoginPage() {
  return <LoginForm />;
}
