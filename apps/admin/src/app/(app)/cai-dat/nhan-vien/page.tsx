import { fetchStaff } from '@/lib/settings-fetch';
import { StaffView } from '@/components/staff-view';

/**
 * Staff & roles route (Cài đặt › Nhân viên, /cai-dat/nhan-vien, P3-q). Async server component: fetches
 * the team roster (GET /admin/staff) forwarding the session cookie, and hands it to the client StaffView
 * (roster + invite dialog + display-only RBAC matrix). Owner-only: a staff caller gets a 403, which
 * fetchStaff turns into a `forbidden` marker so StaffView renders the "không đủ quyền" state rather than
 * the generic error boundary. `no-store` keeps the roster live after an invite; loading is ./loading.tsx.
 */
export default async function StaffPage() {
  const data = await fetchStaff();
  return <StaffView data={data} />;
}
