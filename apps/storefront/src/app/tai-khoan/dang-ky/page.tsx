import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { RegisterForm } from '@/components/register-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('account.register');
  // Private auth page — keep it out of search indexes (storefront rule §SEO).
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

// Server shell — the form is interactive (a Server Action creates the account + mints the session), so
// the work lives in the <RegisterForm> client component.
export default function RegisterPage() {
  return <RegisterForm />;
}
