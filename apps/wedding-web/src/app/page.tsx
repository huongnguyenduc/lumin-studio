import { headers } from 'next/headers';
import { getActiveEvent, getSettings, getWishes } from '@/lib/api';
import { asEventData, asSiteSettings } from '@/lib/site-settings';
import { optimizeEvent, optimizeSettings } from '@/lib/img';
import { InvitationCard } from '@/components/invitation/invitation-card';

// Anonymous card ("Xem thiệp mẫu" from Admin, or a shared bare link): generic
// salutation, RSVP hidden (§9 recommended behavior), wishes still work.
export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const host = (await headers()).get('host') ?? undefined;
  const [wishes, settings, event] = await Promise.all([
    getWishes(),
    getSettings(),
    getActiveEvent(host),
  ]);
  const eventData = asEventData(event?.data ?? {});
  return (
    <InvitationCard
      guest={null}
      wishes={wishes.items}
      settings={optimizeSettings(asSiteSettings(settings))}
      event={eventData}
      eventImages={optimizeEvent(eventData)}
    />
  );
}
