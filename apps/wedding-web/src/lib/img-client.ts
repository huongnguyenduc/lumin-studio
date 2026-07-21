// Phía CLIENT của bộ tối ưu ảnh (ADR-055).
//
// Không ký ở đây — khoá ký là bí mật server. Chỉ dựng link tới route `/img`, nơi
// server ký rồi 302 sang imgproxy (xem `app/img/route.ts`). Cố tình KHÔNG import
// `lib/img.ts`: file đó kéo theo `node:crypto` và sẽ vỡ build nếu lọt vào bundle.

/**
 * Đổi URL ảnh gốc thành link đã qua cầu ký, ở khổ `width`.
 *
 * Chỉ đụng vào URL tuyệt đối — ảnh mẫu đi kèm app (`/invite/*.jpg`) là static cùng
 * origin, đẩy qua imgproxy chỉ tổ thêm một vòng redirect rồi lại fail-open. Server
 * vẫn kiểm tra lại bucket và whitelist khổ, nên hàm này không phải tầng bảo vệ.
 */
export function proxied(url: string, width: number): string {
  if (!/^https?:\/\//i.test(url)) return url;
  return `/img?u=${encodeURIComponent(url)}&w=${width}`;
}
