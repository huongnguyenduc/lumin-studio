import { coreApiBaseUrl } from '@/lib/session';

// Public callback target for the "NFC Helper" iOS app (nfchelper://write?url=...&callback=...) — see
// encode-tag-sheet.tsx. NFC Helper can only GET-redirect to a plain URL after writing a tag, it cannot
// attach an Authorization header, so this route exists purely to turn that GET into the scoped-token
// POST /admin/print-jobs/{id}/encode core-api already exposes (authEncodeOrRequired, ADR-043-adjacent).
// No cookie/session here on purpose — this must work from Safari with nobody logged in to admin.
//
// jobId/token are PATH segments, not query params: NFC Helper appends `?tagid=...` to the callback
// verbatim, blind to whether it already has a `?` — a query-string callback produces a malformed
// second `?` that Next silently folds into the previous param's value instead of splitting a new one
// (observed live: tagid vanished, token got `?tagid=...` appended to its value). Path segments sidestep
// that entirely, since the app only ever appends its own leading `?`.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function page(title: string, body: string): Response {
  return new Response(
    `<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body style="font:16px/1.4 -apple-system,sans-serif;padding:2rem;text-align:center">${body}</body></html>`,
    { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } },
  );
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ jobId: string; token: string }> },
): Promise<Response> {
  const { jobId, token } = await params;
  const chipUid = new URL(request.url).searchParams.get('tagid');
  if (!jobId || !token || !chipUid) {
    return page('Thiếu thông tin', '<p>Link không hợp lệ — thiếu jobId/token/tagid.</p>');
  }

  const res = await fetch(`${coreApiBaseUrl()}/admin/print-jobs/${jobId}/encode`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ chipUid }),
  });

  if (res.ok) {
    // Send staff straight back to the print-queue board to see the card land in PACKING — same-origin
    // redirect, so it rides whatever admin session cookie is already in this browser (or bounces to
    // login if there isn't one, same as any other admin route).
    return Response.redirect(new URL('/hang-doi-in', request.url), 303);
  }
  return page(
    'Chưa lưu được',
    `<p>Ghi chip nhưng chưa lưu được vào hệ thống (mã lỗi ${res.status}). Quay lại board và nhập UID <code>${chipUid}</code> bằng tay.</p>`,
  );
}
