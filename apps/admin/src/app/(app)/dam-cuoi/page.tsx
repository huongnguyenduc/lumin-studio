import { fetchWeddings } from '@/lib/weddings-fetch';
import { WeddingsView } from '@/components/weddings-view';

/**
 * Admin "Đám cưới" route (couple management for the wedding-invitation side —
 * create/rename/set-password/delete couples + review their subdomain requests).
 * Owner-only. Data lives in wedding-api (a separate service/DB), reached
 * server-side via the master bearer; a staff caller or an unconfigured bridge
 * collapses to a state the client view renders, not a thrown error. `no-store`
 * keeps it live after a write (router.refresh re-reads this).
 */
export const dynamic = 'force-dynamic';

export default async function WeddingsPage() {
  const data = await fetchWeddings();
  return <WeddingsView data={data} />;
}
