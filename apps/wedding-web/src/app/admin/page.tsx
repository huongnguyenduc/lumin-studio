import type { Metadata } from 'next';
import { AdminDashboard } from '@/components/admin/dashboard';

// Private host dashboard (HANDOFF §3) — desktop-first, admin bg, never indexed.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function AdminPage() {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'rgb(245,241,236)',
        color: 'rgb(120,105,93)',
        padding: '36px 32px 64px',
        boxSizing: 'border-box',
      }}
    >
      <AdminDashboard />
    </div>
  );
}
