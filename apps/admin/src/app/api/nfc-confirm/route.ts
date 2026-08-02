import { coreApiBaseUrl } from '@/lib/session';

// Public callback target for the "NFC Helper" iOS app (nfchelper://write?url=...&callback=...) — see
// encode-tag-sheet.tsx. NFC Helper can only GET-redirect to a plain URL after writing a tag, it cannot
// attach an Authorization header, so this route exists purely to turn that GET into the scoped-token
// POST /admin/print-jobs/{id}/encode core-api already exposes (authEncodeOrRequired, ADR-043-adjacent).
// No cookie/session here on purpose — this must work from Safari with nobody logged in to admin.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function page(title: string, body: string): Response {
  return new Response(
    `<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body style="font:16px/1.4 -apple-system,sans-serif;padding:2rem;text-align:center">${body}</body></html>`,
    { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } },
  );
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const jobId = url.searchParams.get('jobId');
  const token = url.searchParams.get('token');
  const chipUid = url.searchParams.get('tagid');
  if (!jobId || !token || !chipUid) {
    return page('Thiếu thông tin', '<p>Link không hợp lệ — thiếu jobId/token/tagid.</p>');
  }

  const res = await fetch(`${coreApiBaseUrl()}/admin/print-jobs/${jobId}/encode`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ chipUid }),
  });

  if (res.ok) {
    return page('Đã ghi chip', '<p>🎉 Đã ghi chip NFC thành công. Bạn có thể đóng tab này.</p>');
  }
  return page(
    'Chưa lưu được',
    `<p>Ghi chip nhưng chưa lưu được vào hệ thống (mã lỗi ${res.status}). Quay lại board và nhập UID <code>${chipUid}</code> bằng tay.</p>`,
  );
}
