import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getActiveEvent, getSettings, getWishes, HostNotFoundError } from '@/lib/api';
import { asEventData, asSiteSettings } from '@/lib/site-settings';
import { optimizeEvent, optimizeSettings } from '@/lib/img';
import { InvitationCard } from '@/components/invitation/invitation-card';

// Anonymous card ("Xem thiệp mẫu" from Admin, or a shared bare link): generic
// salutation, RSVP hidden (§9 recommended behavior), wishes still work.
export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const host = (await headers()).get('host') ?? undefined;
  // A subdomain that matches no wedding must 404, not fall back to whichever
  // wedding the API defaults to.
  let event;
  try {
    event = await getActiveEvent(host);
  } catch (err) {
    if (err instanceof HostNotFoundError) notFound();
    throw err;
  }
  const [wishes, settings] = await Promise.all([getWishes(100, host), getSettings(host)]);
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
