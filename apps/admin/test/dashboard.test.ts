import { describe, it, expect, vi, afterEach } from 'vitest';
import { toStatCards, toRecentOrders, toTodos } from '../src/lib/dashboard';
import { vi as adminCatalog } from '../src/messages/vi';
import type { components } from '@lumin/api-client';

// Mock the server-only deps so dashboard-fetch is importable + drivable in node (next/headers is
// server-context-only; @lumin/api-client's GET is the network boundary we assert around).
const getMock = vi.fn();
const cookieGetMock = vi.fn<(name: string) => { value: string } | undefined>((name) => ({
  value: `tok-${name}`,
}));
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ get: cookieGetMock })) }));
vi.mock('@lumin/api-client', () => ({ createApiClient: vi.fn(() => ({ GET: getMock })) }));

type Snapshot = components['schemas']['DashboardSnapshot'];

function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    stats: { newOrdersToday: 5, revenueToday: 2_400_000, printing: 8, reviewsWaiting: 3 },
    recentOrders: [
      {
        id: 'e3b0c442-98fc-1c14-9afb-4c8996fb9242',
        code: '#LMN-1048',
        customerName: 'Nguyễn An',
        status: 'PRINTING',
        total: 445_000,
        createdAt: '2026-07-02T03:00:00Z',
      },
    ],
    todos: { pendingConfirm: 2, paidWaitingPrint: 1 },
    ...overrides,
  };
}

describe('toStatCards', () => {
  it('maps the four cards with the right label keys, kinds, and raw values', () => {
    const cards = toStatCards(snapshot().stats);
    expect(cards).toEqual([
      { labelKey: 'newOrdersToday', value: 5, kind: 'count' },
      { labelKey: 'revenueToday', value: 2_400_000, kind: 'money' },
      { labelKey: 'printing', value: 8, kind: 'count' },
      { labelKey: 'reviewsWaiting', value: 3, kind: 'count', highlight: true },
    ]);
  });

  it('does not highlight reviewsWaiting when the queue is empty (no false alarm)', () => {
    const cards = toStatCards(
      snapshot({ stats: { newOrdersToday: 0, revenueToday: 0, printing: 0, reviewsWaiting: 0 } })
        .stats,
    );
    expect(cards.find((c) => c.labelKey === 'reviewsWaiting')?.highlight).toBe(false);
    // Zero-state still renders every card (spec §03 — render 0, never blank).
    expect(cards).toHaveLength(4);
  });
});

describe('toRecentOrders', () => {
  it('renames customerName → customer and preserves id/code/total/status', () => {
    expect(toRecentOrders(snapshot().recentOrders)).toEqual([
      {
        id: 'e3b0c442-98fc-1c14-9afb-4c8996fb9242',
        code: '#LMN-1048',
        customer: 'Nguyễn An',
        total: 445_000,
        status: 'PRINTING',
      },
    ]);
  });

  it('maps an empty list to [] (the component empty-state branch)', () => {
    expect(toRecentOrders([])).toEqual([]);
  });
});

describe('toTodos', () => {
  it('builds three rows; the reviews row reuses stats.reviewsWaiting', () => {
    expect(toTodos(snapshot())).toEqual([
      { labelKey: 'todoPendingConfirm', count: 2, href: '/don-hang' },
      { labelKey: 'todoReviews', count: 3, href: '/danh-gia' },
      { labelKey: 'todoPaidWaitingPrint', count: 1, href: '/hang-doi-in' },
    ]);
  });
});

describe('label-key ↔ i18n catalog', () => {
  it('every stat/todo labelKey the adapters emit exists under dashboard.*', () => {
    const keys = [
      ...toStatCards(snapshot().stats).map((c) => c.labelKey),
      ...toTodos(snapshot()).map((t) => t.labelKey),
    ];
    for (const key of keys) {
      expect(adminCatalog.dashboard).toHaveProperty(key);
    }
  });
});

describe('fetchDashboard', () => {
  afterEach(() => {
    getMock.mockReset();
    delete process.env.CORE_API_URL;
  });

  it('forwards the session cookie and returns the snapshot on 200', async () => {
    process.env.CORE_API_URL = 'http://core-api:8080';
    const snap = snapshot();
    getMock.mockResolvedValue({ data: snap, error: undefined, response: { status: 200 } });
    const { createApiClient } = await import('@lumin/api-client');
    const { fetchDashboard } = await import('../src/lib/dashboard-fetch');

    await expect(fetchDashboard()).resolves.toEqual(snap);
    expect(createApiClient).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: 'http://core-api:8080',
        headers: { cookie: 'lumin_session=tok-lumin_session' },
      }),
    );
    expect(getMock).toHaveBeenCalledWith('/admin/dashboard', { cache: 'no-store' });
  });

  it('sends empty headers (no cookie=) when there is no session, then relies on the 401 path', async () => {
    process.env.CORE_API_URL = 'http://core-api:8080';
    cookieGetMock.mockReturnValueOnce(undefined); // no lumin_session cookie present
    getMock.mockResolvedValue({
      data: undefined,
      error: { code: 'UNAUTHORIZED' },
      response: { status: 401 },
    });
    const { createApiClient } = await import('@lumin/api-client');
    const { fetchDashboard } = await import('../src/lib/dashboard-fetch');

    await expect(fetchDashboard()).rejects.toThrow(/401/);
    // The false branch of `session ? {...} : {}` — no forged/blank `cookie: lumin_session=` header.
    expect(createApiClient).toHaveBeenCalledWith(expect.objectContaining({ headers: {} }));
  });

  it('throws on a non-2xx response so the error boundary catches it', async () => {
    process.env.CORE_API_URL = 'http://core-api:8080';
    getMock.mockResolvedValue({
      data: undefined,
      error: { code: 'UNAUTHORIZED' },
      response: { status: 401 },
    });
    const { fetchDashboard } = await import('../src/lib/dashboard-fetch');
    await expect(fetchDashboard()).rejects.toThrow(/401/);
  });

  it('throws a clear error when CORE_API_URL is unset', async () => {
    const { fetchDashboard } = await import('../src/lib/dashboard-fetch');
    await expect(fetchDashboard()).rejects.toThrow(/CORE_API_URL/);
  });
});
