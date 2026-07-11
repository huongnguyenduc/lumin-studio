import { fetchSettings } from '@/lib/settings-fetch';
import { SettingsView } from '@/components/settings-view';

/**
 * Admin settings route (Cài đặt › Thanh toán & ship, P3-i). Async server component: fetches the
 * settings singleton (GET /admin/settings) forwarding the session cookie, and hands it to the client
 * SettingsView (which owns the STK / shipping-rules / refund-policy writes). A fetch failure is caught
 * by (app)/error.tsx (retry); loading is ./loading.tsx (skeleton). `no-store` keeps it live after a save.
 */
export default async function SettingsPage() {
  const settings = await fetchSettings();
  return <SettingsView settings={settings} />;
}
