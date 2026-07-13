import type { components } from '@lumin/api-client';
import { api } from './client';

export type ReplyTemplate = components['schemas']['ReplyTemplate'];

export type TemplatesResult = { ok: true; templates: ReplyTemplate[] } | { ok: false };

// GET /admin/reply-templates (ADR-043 Bearer, owner+staff) — the shop's shared reply templates, read-only
// in the panel (CRUD stays in Admin, P3-i). We only render + copy them; failure is a plain retry (there's no
// "not found" — an empty shop just returns []). Variables like {tên}/{mã đơn}/{STK} stay literal for staff.
export async function listReplyTemplates(): Promise<TemplatesResult> {
  try {
    const { data } = await api.GET('/admin/reply-templates');
    if (data) return { ok: true, templates: data };
    return { ok: false };
  } catch {
    return { ok: false };
  }
}
