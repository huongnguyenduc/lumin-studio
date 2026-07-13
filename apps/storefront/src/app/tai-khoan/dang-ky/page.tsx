import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { RegisterForm } from '@/components/register-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('account.register');
  // Private auth page — keep it out of search indexes (storefront rule §SEO).
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

// Server shell — the form is interactive (a Server Action creates the account + mints the session), so
// the work lives in the <RegisterForm> client component. `next` is read here (server) and passed down so
// a customer who registers from the pet-tag welcome (P3-t t-3) returns to /t/{shortId} after signing up.
export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return <RegisterForm next={next} />;
}
