import { getInvite, getWishes } from '@/lib/api';
import { InvitationCard } from '@/components/invitation/invitation-card';

// SSR per guest slug (HANDOFF §6): the salutation renders server-side (no
// flicker) and the invite fetch fires the write-once open tracking. no-store —
// every open must hit the API, and the wall should be current.
export const dynamic = 'force-dynamic';

export default async function InvitePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [guest, wishes] = await Promise.all([getInvite(slug), getWishes()]);
  return <InvitationCard guest={guest} wishes={wishes.items} />;
}
