import { NextResponse, type NextRequest } from 'next/server';
import { PROXY_WIDTHS, isKnownSource, optimize } from '@/lib/img';

// Cầu ký URL cho phía CLIENT (ADR-055).
//
// Trang thiệp ký ngay lúc SSR nên không cần route này. Nhưng dashboard chủ tiệc là
// client component thuần (ảnh lấy về từ admin-api sau khi mount) — mà khoá ký thì
// TUYỆT ĐỐI không được xuống browser. Nên client gọi `/img?u=…&w=…`, server ký rồi
// 302 sang imgproxy.
//
// Vì sao redirect chứ không proxy byte: proxy sẽ bắt mọi ảnh chui qua pod Next
// (thêm 1 chặng, ăn RAM, và Cloudflare cache ở host này thay vì img.luminstudio.vn).
// Redirect thì browser tự đi thẳng tới imgproxy và ăn cache biên như trang công khai.
//
// KHÔNG cần auth, nhưng ĐIỀU KIỆN CỦA VIỆC ĐÓ LÀ HAI CHỐT DƯỚI ĐÂY — đừng gỡ:
//   1. `isKnownSource(u)` — chỉ nhận URL nằm dưới đúng bucket ảnh công khai. Thiếu nó,
//      nhánh fail-open (`?? u`) redirect tới bất kỳ đâu ⇒ open redirect đội lốt tên
//      miền thiệp, lại còn được cache dài. Đây từng là lỗ thật, không phải phòng xa.
//   2. `w ∈ PROXY_WIDTHS` — chặn bơm vô số khổ để phá cache.
// Bucket biên lai nằm ngoài danh sách nguồn, và imgproxy còn chặn lần nữa bằng
// IMGPROXY_S3_ALLOWED_BUCKETS.

export const dynamic = 'force-dynamic';

export function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const u = searchParams.get('u');
  const w = Number(searchParams.get('w'));
  const fit = searchParams.get('fit') !== '0';

  if (!u || !PROXY_WIDTHS.includes(w) || !isKnownSource(u)) {
    return new NextResponse('bad request', { status: 400 });
  }

  // `isKnownSource` đã bảo đảm `u` là URL tuyệt đối dưới bucket ảnh ⇒ redirect an toàn
  // kể cả khi chưa bootstrap imgproxy (fail-open về chính ảnh gốc, giống trang thiệp).
  const out = optimize(u, [w], { fit });

  return NextResponse.redirect(out?.src ?? u, {
    status: 302,
    headers: {
      // Chỉ đóng băng khi ĐÃ tối ưu thật (key upload là UUID, biến thể bất biến).
      // Nhánh fail-open phải để TTL ngắn — nếu không, mọi preview mở ra trước lúc
      // bootstrap sẽ bị ghim vào ảnh gốc suốt một năm dù imgproxy đã sống.
      'Cache-Control': out ? 'public, max-age=31536000, immutable' : 'public, max-age=60',
    },
  });
}
