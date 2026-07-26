// Client data layer for /admin — same-origin /api/* (next.config rewrites).
// Every call throws ApiError on non-2xx; 401 bubbles up so the dashboard can
// flip back to the login screen.

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    /** Nguyên văn message của server — hiện cho người dùng để báo lại dev. */
    public detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
  }
}

/**
 * Chuỗi kỹ thuật ngắn gọn cho toast lỗi: mã + nguyên văn server (hoặc message
 * của Error thường). Đủ để người dùng chụp màn hình gửi dev.
 */
export function errDetail(err: unknown): string {
  if (err instanceof ApiError) {
    return `${err.status} ${err.code}${err.detail ? ` — ${err.detail}` : ''}`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let code = 'HTTP_' + res.status;
    let detail: string | undefined;
    try {
      const data = (await res.json()) as { error?: { code?: string; message?: string } };
      if (data.error?.code) code = data.error.code;
      detail = data.error?.message;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, code, detail);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// Server caps every presigned policy at 10MB (uploadstore.MaxUploadSize).
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * Ảnh quá nặng → re-encode sang WebP q90 (thu nhỏ dần nếu vẫn quá cap) trước khi
 * upload, im lặng: người dùng không phải tự resize. Ảnh vừa cap giữ nguyên bit-đối-bit.
 * Chỉ áp cho JPEG/PNG/WebP — icon (.ico/.png) và nhạc giữ nguyên định dạng.
 * ponytail: canvas + OffscreenCanvas, không thêm thư viện nén ảnh.
 */
async function shrinkImage(file: File): Promise<File> {
  if (file.size <= MAX_UPLOAD_BYTES) return file;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return file;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file; // ảnh hỏng / trình duyệt không đọc được → để server từ chối như cũ
  }
  try {
    for (let scale = 1; scale >= 0.25; scale /= 2) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) return file;
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/webp', 0.9),
      );
      if (!blob) return file;
      if (blob.size <= MAX_UPLOAD_BYTES) {
        return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.webp', {
          type: 'image/webp',
        });
      }
    }
    return file;
  } finally {
    bitmap.close();
  }
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
  openCount: number;
  openDevices: string[];
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

export type SharedGuest = {
  id: string;
  browserFamily: string;
  deviceFamily: string;
  matchConfidence: 'token' | 'fingerprint' | 'new';
  firstSeenAt: string;
  lastSeenAt: string;
  name: string | null;
  rsvp: 'yes' | 'no' | null;
  rsvpAt: string | null;
  isAdmin: boolean;
  isCurrent: boolean;
  openCount: number;
  firstOpenedAt: string | null;
  lastOpenedAt: string | null;
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

// The wedding admin is COUPLE-ONLY: a couple logs in on its own subdomain and
// manages just its own wedding. Couple management (create/rename/password/
// delete/subdomain-review) lives in the lumin admin, not here.
export const adminApi = {
  // host: the page's own hostname — the API resolves it to the couple's wedding.
  // The response body (scope) is unused; a 2xx means the session cookie is set.
  login: (password: string, host?: string) =>
    call<void>('POST', '/api/admin/login', { password, host }),
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
  // Removes the event and everything under it (guests, wishes for it).
  deleteEvent: (slug: string) =>
    call<void>('DELETE', `/api/admin/events/${encodeURIComponent(slug)}`),

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
  sharedGuests: (event: string) =>
    call<{ items: SharedGuest[] }>(
      'GET',
      `/api/admin/shared-guests?event=${encodeURIComponent(event)}`,
    ),
  createIdentityClaim: () =>
    call<{ token: string; expiresAt: string }>('POST', '/api/admin/identity-claims'),
  setIdentityAdmin: (id: string, admin: boolean) =>
    call<void>('PATCH', `/api/admin/identities/${encodeURIComponent(id)}/admin`, { admin }),
  deleteIdentity: (id: string) =>
    call<void>('DELETE', `/api/admin/identities/${encodeURIComponent(id)}`),
  deleteAllIdentities: () => call<void>('DELETE', '/api/admin/identities'),
  settings: () => call<Settings>('GET', '/api/admin/settings'),
  patchSettings: (patch: Settings) => call<Settings>('PATCH', '/api/admin/settings', patch),

  // Presign + direct browser POST to Garage; resolves to the public finalUrl.
  upload: async (kind: string, original: File): Promise<string> => {
    const file = await shrinkImage(original);
    const signed = await call<{
      uploadUrl: string;
      fields: Record<string, string>;
      finalUrl: string;
    }>('POST', '/api/admin/uploads/presign', { kind, mime: file.type, size: file.size });
    const form = new FormData();
    for (const [k, v] of Object.entries(signed.fields)) form.append(k, v);
    form.append('file', file);
    const res = await fetch(signed.uploadUrl, { method: 'POST', body: form });
    if (!res.ok) {
      // Garage trả XML <Error><Message>…</Message></Error> — lấy Message cho dễ báo lỗi.
      const body = await res.text().catch(() => '');
      const msg = /<Message>([^<]*)<\/Message>/.exec(body)?.[1] ?? body.slice(0, 200);
      throw new ApiError(res.status, 'UPLOAD_FAILED', msg || undefined);
    }
    return signed.finalUrl;
  },
};
