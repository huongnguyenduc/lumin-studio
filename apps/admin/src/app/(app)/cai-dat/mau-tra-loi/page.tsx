import { fetchReplyTemplates } from '@/lib/settings-fetch';
import { ReplyTemplatesView } from '@/components/reply-templates-view';

/**
 * Reply-template library route (Cài đặt › Mẫu trả lời, P3-i). Async server component: fetches the
 * templates (GET /admin/reply-templates) forwarding the session cookie, and hands them to the client
 * ReplyTemplatesView (which owns the CRUD). A fetch failure is caught by (app)/error.tsx (retry);
 * loading is ./loading.tsx (skeleton). `no-store` keeps the list live after a create/update/delete.
 */
export default async function ReplyTemplatesPage() {
  const templates = await fetchReplyTemplates();
  return <ReplyTemplatesView templates={templates} />;
}
