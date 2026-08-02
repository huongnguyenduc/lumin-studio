import { fetchStaff, fetchEncodeTokens } from '@/lib/settings-fetch';
import { StaffView } from '@/components/staff-view';

/**
 * Staff & roles route (Cài đặt › Nhân viên, /cai-dat/nhan-vien, P3-q). Async server component: fetches
 * the team roster (GET /admin/staff) + the NFC Shortcuts token list (GET /admin/encode-tokens) forwarding
 * the session cookie, and hands both to the client StaffView (roster + invite dialog + display-only RBAC
 * matrix + token management). Owner-only: a staff caller gets a 403, which fetchStaff/fetchEncodeTokens
 * turn into a `forbidden` marker so StaffView renders the "không đủ quyền" state rather than the generic
 * error boundary. `no-store` keeps both lists live after a write; loading is ./loading.tsx.
 */
export default async function StaffPage() {
  const [staff, tokens] = await Promise.all([fetchStaff(), fetchEncodeTokens()]);
  return <StaffView data={staff} tokens={tokens} />;
}
