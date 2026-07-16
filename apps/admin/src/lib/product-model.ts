/**
 * Collapse an asset-job list to the latest job per type. Each model upload enqueues both a
 * `model_ingest` and a `sprite_render` job, and old attempts (including resolved failures) are never
 * pruned server-side — so the raw `GET .../asset-jobs` list piles up superseded rows (e.g. a stale
 * `failed` sprite_render sitting next to the newer `ready` one from a re-upload). The endpoint returns
 * jobs newest-first, so the first row seen per type is the current one: keep those, drop the rest,
 * preserving order. Generic over the one field it reads so it stays trivially unit-testable.
 */
export function latestJobsByType<T extends { jobType: string }>(jobs: T[]): T[] {
  return jobs.filter((j, i) => jobs.findIndex((k) => k.jobType === j.jobType) === i);
}
