// Client data layer for /admin — same-origin /api/* (next.config rewrites).
// Every call throws ApiError on non-2xx; 401 bubbles up so the dashboard can
// flip back to the login screen.

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let code = 'HTTP_' + res.status;
    try {
      const data = (await res.json()) as { error?: { code?: string } };
      if (data.error?.code) code = data.error.code;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, code);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export type AdminGuest = {
  id: string;
  label: string;
  group: string;
  note: string | null;
  openedAt: string | null;
  rsvp: 'yes' | 'no' | null;
  rsvpAt: string | null;
  createdAt: string;
  wishCount: number;
  firstWish: string | null;
};

export type AdminWish = {
  id: string;
  guestId: string | null;
  name: string;
  text: string;
  color: string | null;
  createdAt: string;
};

export type AdminStats = {
  guests: number;
  opened: number;
  rsvpYes: number;
  rsvpNo: number;
  wishes: number;
};

export type Settings = Record<string, unknown>;

export type AdminEvent = {
  slug: string;
  name: string;
  sortOrder: number;
  subdomain: string | null;
  requestedSubdomain: string | null;
  weddingSlug: string;
  data: Record<string, unknown>;
};

export type Me = { scope: string; master: boolean };

// The wedding admin is COUPLE-ONLY: a couple logs in on its own subdomain and
// manages just its own wedding. Couple management (create/rename/password/
// delete/subdomain-review) lives in the lumin admin, not here.
export const adminApi = {
  // host: the page's own hostname — the API resolves it to the couple's wedding.
  login: (password: string, host?: string) =>
    call<Me>('POST', '/api/admin/login', { password, host }),
  logout: () => call<void>('POST', '/api/admin/logout'),

  changePassword: (current: string, next: string) =>
    call<void>('POST', '/api/admin/password', { current, new: next }),

  events: () => call<{ items: AdminEvent[] }>('GET', '/api/admin/events'),
  createEvent: (name: string) => call<AdminEvent>('POST', '/api/admin/events', { name }),
  // subdomain: label only (e.g. "damcuoisg") — the API owns the ".luminstudio.vn"
  // suffix. A couple's change lands in requestedSubdomain, pending master review
  // (done in the lumin admin).
  patchEvent: (
    slug: string,
    patch: { name?: string; subdomain?: string; data?: Record<string, unknown> },
  ) => call<AdminEvent>('PATCH', `/api/admin/events/${encodeURIComponent(slug)}`, patch),

  guests: (event: string) =>
    call<{ items: AdminGuest[] }>('GET', `/api/admin/guests?event=${encodeURIComponent(event)}`),
  createGuest: (g: { label: string; group?: string; note?: string; eventSlug: string }) =>
    call<AdminGuest>('POST', '/api/admin/guests', g),
  patchGuest: (id: string, patch: { label?: string; group?: string; note?: string }) =>
    call<void>('PATCH', `/api/admin/guests/${encodeURIComponent(id)}`, patch),
  deleteGuest: (id: string) => call<void>('DELETE', `/api/admin/guests/${encodeURIComponent(id)}`),
  bulkDeleteGuests: (ids: string[]) =>
    call<{ deleted: number }>('POST', '/api/admin/guests/bulk-delete', { ids }),

  groups: (event: string) =>
    call<{ items: { name: string; sortOrder: number }[] }>(
      'GET',
      `/api/admin/groups?event=${encodeURIComponent(event)}`,
    ),
  createGroup: (name: string, eventSlug: string) =>
    call<void>('POST', '/api/admin/groups', { name, eventSlug }),
  renameGroup: (event: string, from: string, to: string) =>
    call<void>(
      'PATCH',
      `/api/admin/groups/${encodeURIComponent(event)}/${encodeURIComponent(from)}`,
      { name: to },
    ),
  deleteGroup: (event: string, name: string) =>
    call<void>(
      'DELETE',
      `/api/admin/groups/${encodeURIComponent(event)}/${encodeURIComponent(name)}`,
    ),

  // No wedding arg: a couple session's wall is inferred from the session scope.
  wishes: (limit = 500) =>
    call<{ items: AdminWish[]; total: number }>('GET', `/api/admin/wishes?limit=${limit}`),
  deleteWish: (id: string) => call<void>('DELETE', `/api/admin/wishes/${encodeURIComponent(id)}`),
  bulkDeleteWishes: (ids: string[]) =>
    call<{ deleted: number }>('POST', '/api/admin/wishes/bulk-delete', { ids }),

  // "overview", not "stats" — generic ad-blockers (EasyPrivacy-style filter lists)
  // block URLs containing "stats" as presumed analytics.
  stats: (event: string) =>
    call<AdminStats>('GET', `/api/admin/overview?event=${encodeURIComponent(event)}`),
  settings: () => call<Settings>('GET', '/api/admin/settings'),
  patchSettings: (patch: Settings) => call<Settings>('PATCH', '/api/admin/settings', patch),

  // Presign + direct browser POST to Garage; resolves to the public finalUrl.
  upload: async (kind: string, file: File): Promise<string> => {
    const signed = await call<{
      uploadUrl: string;
      fields: Record<string, string>;
      finalUrl: string;
    }>('POST', '/api/admin/uploads/presign', { kind, mime: file.type, size: file.size });
    const form = new FormData();
    for (const [k, v] of Object.entries(signed.fields)) form.append(k, v);
    form.append('file', file);
    const res = await fetch(signed.uploadUrl, { method: 'POST', body: form });
    if (!res.ok) throw new ApiError(res.status, 'UPLOAD_FAILED');
    return signed.finalUrl;
  },
};
