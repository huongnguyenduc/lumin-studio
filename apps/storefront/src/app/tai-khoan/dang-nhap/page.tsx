import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { LoginForm } from '@/components/login-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('account.login');
  // Private auth page — keep it out of search indexes (storefront rule §SEO).
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

// Server shell — the form is interactive (a Server Action mints the session), so the work lives in the
// <LoginForm> client component. `next` is read here (server) and passed down so LoginForm needn't call
// useSearchParams (which would force a Suspense boundary); it drives the post-login return (P3-t t-3: the
// pet-tag welcome links here with ?next=/t/{shortId}), guarded against open redirects inside LoginForm.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return <LoginForm next={next} />;
}
