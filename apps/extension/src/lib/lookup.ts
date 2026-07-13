import type { components } from '@lumin/api-client';
import type { OrderStatus } from '@lumin/core';
import { api } from './client';

type Order = components['schemas']['Order'];

export type LookupResult = { ok: true; order: Order } | { ok: false; code: 'not_found' | 'error' };

// GET /admin/orders/by-code/{code} (ADR-043 Bearer) — resolve a pasted human code to the full internal
// Order. The canonical code carries a leading "#" (parseOrderCode); we drop it for the path segment so no
// "%23" ever rides in the URL — the server re-adds it (normalizeAdminOrderCode). A 404 is a real
// "no such order" (staff mistyped / it's another shop's code); anything else is a transient fault.
export async function fetchOrderByCode(code: string): Promise<LookupResult> {
  try {
    const { data, error, response } = await api.GET('/admin/orders/by-code/{code}', {
      params: { path: { code: code.replace(/^#/, '') } },
    });
    if (data) return { ok: true, order: data };
    if (response.status === 404) return { ok: false, code: 'not_found' };
    void error;
    return { ok: false, code: 'error' };
  } catch {
    return { ok: false, code: 'error' };
  }
}

export type TransitionResult =
  | { ok: true; order: Order }
  | { ok: false; code: 'forbidden' | 'conflict' | 'validation' | 'error' };

// POST /orders/{id}/transitions — the server appends statusHistory and re-checks RBAC + the state machine;
// the extension only sends the no-file transitions it offers (→PAID/PRINTING/COMPLETED, or →CANCELLED with a
// reason). A 403 is an owner-only edge a staff tried; 409 is a stale order (moved under us); 400/422 is a
// rejected field (e.g. a missing reason). Ship/refund (qcPhotoUrl/refundProofUrl) are never sent from here.
export async function transitionOrder(
  id: string,
  body: { to: OrderStatus; reason?: string },
): Promise<TransitionResult> {
  try {
    const { data, error, response } = await api.POST('/orders/{id}/transitions', {
      params: { path: { id } },
      body,
    });
    if (data) return { ok: true, order: data };
    void error;
    if (response.status === 403) return { ok: false, code: 'forbidden' };
    if (response.status === 409) return { ok: false, code: 'conflict' };
    if (response.status === 400 || response.status === 422) {
      return { ok: false, code: 'validation' };
    }
    return { ok: false, code: 'error' };
  } catch {
    return { ok: false, code: 'error' };
  }
}
