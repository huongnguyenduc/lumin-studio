import { getInvite, getSettings, getWishes } from '@/lib/api';
import { asSiteSettings } from '@/lib/site-settings';
import { InvitationCard } from '@/components/invitation/invitation-card';
import { MarkOpened } from '@/components/invitation/mark-opened';

// SSR per guest slug (HANDOFF §6): the salutation renders server-side (no
// flicker); open tracking fires client-side after mount (MarkOpened) so
// link-preview bots don't fake an open. no-store — every open must hit the
// API, and the wall should be current.
export const dynamic = 'force-dynamic';

export default async function InvitePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [guest, wishes, settings] = await Promise.all([
    getInvite(slug),
    getWishes(),
    getSettings(),
  ]);
  return (
    <>
      {guest ? <MarkOpened slug={slug} /> : null}
      <InvitationCard guest={guest} wishes={wishes.items} settings={asSiteSettings(settings)} />
    </>
  );
}
