import { fetchSettings, fetchShopContact } from '@/lib/settings-fetch';
import { SettingsView } from '@/components/settings-view';

/**
 * Admin settings route (Cài đặt › Thanh toán & ship, P3-i). Async server component: fetches the
 * settings singleton (GET /admin/settings) + the shop's public contact channels (GET /shop/contact, PR
 * F — same public read /lien-he uses) forwarding the session cookie, and hands both to the client
 * SettingsView (which owns the STK / shipping-rules / refund-policy / contact-channel writes). A fetch
 * failure is caught by (app)/error.tsx (retry); loading is ./loading.tsx (skeleton). `no-store` keeps it
 * live after a save.
 */
export default async function SettingsPage() {
  const [settings, shopContact] = await Promise.all([fetchSettings(), fetchShopContact()]);
  return <SettingsView settings={settings} shopContact={shopContact} />;
}
