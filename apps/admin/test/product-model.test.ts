import { describe, it, expect } from 'vitest';
import { latestJobsByType } from '../src/lib/product-model';

// Only jobType/id/status matter to the collapse; build minimal rows (newest-first, as the API returns).
const job = (id: string, jobType: 'model_ingest' | 'sprite_render', status: string) => ({
  id,
  jobType,
  status,
});

describe('latestJobsByType', () => {
  it('keeps only the newest job per type, dropping superseded attempts', () => {
    const out = latestJobsByType([
      job('s2', 'sprite_render', 'ready'), // newest sprite — the successful re-render
      job('m2', 'model_ingest', 'ready'),
      job('s1', 'sprite_render', 'failed'), // superseded failure — must be hidden
      job('m1', 'model_ingest', 'ready'),
    ]);
    expect(out.map((j) => j.id)).toEqual(['s2', 'm2']);
  });

  it('keeps a latest failure so a current failure still surfaces', () => {
    const out = latestJobsByType([
      job('s1', 'sprite_render', 'failed'),
      job('m1', 'model_ingest', 'ready'),
    ]);
    expect(out.map((j) => [j.jobType, j.status])).toEqual([
      ['sprite_render', 'failed'],
      ['model_ingest', 'ready'],
    ]);
  });

  it('returns [] for no jobs', () => {
    expect(latestJobsByType([])).toEqual([]);
  });
});
