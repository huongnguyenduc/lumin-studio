import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { AdminDashboard } from '@/components/admin/dashboard';

// Private host dashboard (HANDOFF §3) — desktop-first, admin bg, never indexed.
export const metadata: Metadata = { robots: { index: false, follow: false } };

// A couple can have several "đám" (events), each on its own subdomain. The
// admin must land on THIS request's subdomain, not always the first — same
// resolution the public page uses (getActiveEvent: Host header first). Pass
// the raw Host down so the dashboard can match it against event.subdomain
// once it has the couple's event list; keep dynamic since Host varies per request.
export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const host = (await headers()).get('host') ?? null;
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
      <AdminDashboard activeHost={host} />
    </div>
  );
}
