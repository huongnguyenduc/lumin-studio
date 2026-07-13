import { fetchAdminPetTags } from '@/lib/pet-tags-fetch';
import { PetTagRoster } from '@/components/pet-tag-roster';

/**
 * Pet Tag roster route (/pet-tag, P3-t t-5, spec §10). Async server component: fetches the whole tag roster
 * (GET /admin/pet-tags) forwarding the session cookie, and hands it to the client PetTagRoster (status filter
 * + list). Admin-gated (owner AND staff); `no-store` keeps the roster live. A fetch failure falls to
 * (app)/error.tsx; loading is ./loading.tsx.
 */
export default async function PetTagPage() {
  const tags = await fetchAdminPetTags();
  return <PetTagRoster tags={tags} />;
}
