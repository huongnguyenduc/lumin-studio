import { describe, it, expect } from 'vitest';
import { latestJobsByType, defaultModelColors } from '../src/lib/product-model';

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

describe('defaultModelColors', () => {
  const color = (hex: string, available: boolean, partId: string | null = null) => ({
    hex,
    available,
    partId,
  });

  it('parts product: first AVAILABLE colour per mapped part, keyed by object name; no flat', () => {
    const out = defaultModelColors(
      [
        { id: 'p1', modelObjectName: 'Chao đèn' },
        { id: 'p2', modelObjectName: '' }, // unmapped → omitted
        { id: 'p3', modelObjectName: 'Đế' }, // only unavailable colour → omitted
      ],
      [
        color('#E8B923', false, 'p1'), // unavailable → skip
        color('#111111', true, 'p1'), // → p1's default
        color('#FFFFFF', false, 'p3'),
        color('#ABCDEF', true), // flat colour ignored on a parts product
      ],
    );
    expect(out).toEqual({ flatHex: undefined, byObject: { 'Chao đèn': '#111111' } });
  });

  it('flat product: first available product-level colour', () => {
    const out = defaultModelColors(
      [],
      [color('#E8B923', false), color('#ABCDEF', true), color('#111111', true)],
    );
    expect(out).toEqual({ flatHex: '#ABCDEF', byObject: {} });
  });

  it('no colours at all → nothing to paint', () => {
    expect(defaultModelColors([], [])).toEqual({ flatHex: undefined, byObject: {} });
  });
});
