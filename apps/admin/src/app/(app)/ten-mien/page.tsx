import { fetchDomains, fetchDomainTargets } from '@/lib/domains-fetch';
import { DomainsView } from '@/components/domains-view';

/**
 * Admin domains route (Tên miền — quản lý subdomain khách trên *.luminstudio.vn). Async server
 * component: fetches the provisioned-domains list + the target picker (GET /admin/domains,
 * GET /admin/domains/targets), forwarding the session cookie. Both are k8s-backed at core-api —
 * a 503 (no in-cluster access) or 403 (staff) collapses to a status the client DomainsView
 * renders, not a thrown error. `no-store` keeps it live after a create/delete.
 */
export default async function DomainsPage() {
  const [domains, targets] = await Promise.all([fetchDomains(), fetchDomainTargets()]);
  return <DomainsView domains={domains} targets={targets} />;
}
