import type { Metadata } from 'next';
import { AdminDashboard } from '@/components/admin/dashboard';

// Private host dashboard (HANDOFF §3) — desktop-first, admin bg, never indexed.
export const metadata: Metadata = { robots: { index: false, follow: false } };

// Each wedding runs on its own subdomain with WEDDING_EVENT_SLUG set per
// deployment (same env that picks the active event for the public page). Read it
// server-side and hand it to the dashboard so the admin lands on THIS
// subdomain's event — not always the first — and shows that wedding's guest
// list. Read at request time (env may be injected per pod), so keep dynamic.
export const dynamic = 'force-dynamic';

export default function AdminPage() {
  const activeSlug = process.env.WEDDING_EVENT_SLUG ?? null;
  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'rgb(245,241,236)',
        color: 'rgb(120,105,93)',
        padding: '36px 32px 64px',
        boxSizing: 'border-box',
        // Every admin component hardcodes small inline px font-sizes (11-13px,
        // desktop-first) — a single zoom bump reads as "everything a bit bigger"
        // without touching dozens of files (same trick as .invite-scale).
        zoom: 1.15,
      }}
    >
      <AdminDashboard activeSlug={activeSlug} />
    </div>
  );
}
