import { getActiveEvent, getSettings, getWishes } from '@/lib/api';
import { asEventData, asSiteSettings } from '@/lib/site-settings';
import { InvitationCard } from '@/components/invitation/invitation-card';

// Anonymous card ("Xem thiệp mẫu" from Admin, or a shared bare link): generic
// salutation, RSVP hidden (§9 recommended behavior), wishes still work.
export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const [wishes, settings, event] = await Promise.all([
    getWishes(),
    getSettings(),
    getActiveEvent(),
  ]);
  return (
    <InvitationCard
      guest={null}
      wishes={wishes.items}
      settings={asSiteSettings(settings)}
      event={asEventData(event?.data ?? {})}
    />
  );
}
