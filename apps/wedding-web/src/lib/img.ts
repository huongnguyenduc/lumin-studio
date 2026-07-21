// Ký URL imgproxy (ADR-055) — CHỈ CHẠY PHÍA SERVER.
//
// `node:crypto` là hàng rào: nếu file này lỡ bị import vào client component, Next sẽ
// fail build thay vì âm thầm nhét IMGPROXY_KEY vào bundle JS. Đừng bỏ import đó, và
// đừng đổi env sang NEXT_PUBLIC_* — lộ khoá ký = imgproxy thành open proxy, ai cũng
// sinh được vô hạn biến thể và giết con box ở nhà (xem infra/k8s/imgproxy.yaml).
//
// FAIL-OPEN là có chủ ý: thiếu env (chưa bootstrap, hoặc chạy dev ở máy) → trả về
// undefined, phía gọi rơi về URL gốc. Ảnh vẫn hiện, chỉ là không tối ưu. Không bao
// giờ để trang thiệp vỡ vì một service phụ chưa sẵn sàng.

import { createHmac } from 'node:crypto';

import type { EventData, EventImages, SiteSettings } from './site-settings';

/** Ảnh nguồn kèm điểm nhấn (0–100 %) chủ tiệc chọn trong admin. */
export type FocusPoint = { x?: number; y?: number };
/** Kết quả tối ưu: `src` là biến thể mặc định, `srcSet` để browser tự chọn theo DPR/khổ. */
export type Optimized = { src: string; srcSet: string };

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v !== '' ? v : undefined;
}

/**
 * Bóc key S3 ra khỏi URL công khai đã lưu trong settings.
 * Chỉ nhận URL nằm đúng dưới bucket của mình — ảnh mẫu `/invite/*.jpg` (static,
 * cùng origin) và mọi host lạ đều trả undefined để rơi về đường fail-open.
 */
function s3Key(url: string): string | undefined {
  const base = env('IMGPROXY_SOURCE_BASE_URL');
  if (!base || !url.startsWith(`${base}/`)) return undefined;
  const key = url.slice(base.length + 1);
  // Chặn traversal trước khi ghép vào s3://; key hợp lệ do uploadstore sinh là
  // `<kind>/YYYY/MM/DD/<uuid>.<ext>`, không bao giờ có `..` hay query.
  if (key === '' || key.includes('..') || key.includes('?')) return undefined;
  return key;
}

/**
 * URL này có trỏ vào bucket ảnh của mình không?
 *
 * Route `/img` PHẢI gọi hàm này trước khi redirect. Nhánh fail-open của nó trả về
 * chính `u`, nên nếu không chặn ở đây thì `/img?u=https://evil.example/...` biến
 * mọi subdomain thiệp thành endpoint chuyển hướng mang tên miền tin cậy.
 *
 * Cố tình KHÔNG phụ thuộc key/salt: một URL vẫn là "nguồn hợp lệ" kể cả khi chưa
 * bootstrap imgproxy — lúc đó fail-open về ảnh gốc là đúng, còn host lạ thì vẫn 400.
 */
export function isKnownSource(url: string): boolean {
  return s3Key(url) !== undefined;
}

function sign(path: string, keyHex: string, saltHex: string): string {
  const hmac = createHmac('sha256', Buffer.from(keyHex, 'hex'));
  hmac.update(Buffer.from(saltHex, 'hex'));
  hmac.update(path);
  return hmac.digest('base64url');
}

/**
 * Một biến thể đã ký. `fill` cắt đúng khung (dùng cho lưới/hero — có điểm nhấn),
 * `fit` giữ nguyên tỉ lệ, chỉ giới hạn bề rộng (dùng cho lightbox/bản đồ).
 */
function variant(
  url: string,
  width: number,
  opts: { height?: number; fit?: boolean; focus?: FocusPoint },
): string | undefined {
  const base = env('IMGPROXY_BASE_URL');
  const bucket = env('IMGPROXY_S3_BUCKET');
  const keyHex = env('IMGPROXY_KEY');
  const saltHex = env('IMGPROXY_SALT');
  const key = s3Key(url);
  if (!base || !bucket || !keyHex || !saltHex || !key) return undefined;

  // enlarge=0: ảnh nguồn nhỏ hơn khung thì để nguyên, không phóng to cho vỡ hạt.
  const resize = opts.fit ? `rs:fit:${width}:0:0` : `rs:fill:${width}:${opts.height ?? 0}:0`;
  const parts = [resize];
  // Điểm nhấn chỉ có tác dụng khi đang cắt (fill); với fit thì thừa.
  if (!opts.fit && opts.focus) {
    const fx = ((opts.focus.x ?? 50) / 100).toFixed(3);
    const fy = ((opts.focus.y ?? 50) / 100).toFixed(3);
    parts.push(`g:fp:${fx}:${fy}`);
  }
  parts.push('q:82');

  // Nguồn mã hoá base64url thay vì /plain/ — key có thể chứa ký tự cần escape.
  const source = Buffer.from(`s3://${bucket}/${key}`).toString('base64url');
  // Đuôi .webp = ép format ngay trong URL. Cố ý KHÔNG dùng content negotiation
  // (IMGPROXY_AUTO_WEBP) vì Cloudflare không vary theo `Accept` cho ảnh — xem
  // infra/k8s/imgproxy.yaml.
  const path = `/${parts.join('/')}/${source}.webp`;
  return `${base}/${sign(path, keyHex, saltHex)}${path}`;
}

/**
 * Sinh `src` + `srcSet` cho một ảnh. `widths` phải xếp tăng dần; `src` lấy khổ
 * giữa để trình duyệt cũ (không hiểu srcSet) vẫn không phải tải bản to nhất.
 * Trả undefined khi chưa cấu hình được — phía gọi dùng URL gốc.
 */
export function optimize(
  url: string,
  widths: number[],
  opts: { aspect?: number; fit?: boolean; focus?: FocusPoint } = {},
): Optimized | undefined {
  const entries = widths.map((w) => {
    const height = opts.aspect ? Math.round(w / opts.aspect) : undefined;
    return { w, url: variant(url, w, { height, fit: opts.fit, focus: opts.focus }) };
  });
  if (entries.some((e) => !e.url)) return undefined;
  const srcSet = entries.map((e) => `${e.url} ${e.w}w`).join(', ');
  const mid = entries[Math.min(entries.length - 1, Math.floor(entries.length / 2))];
  return { src: mid.url as string, srcSet };
}

// --- Khổ ảnh theo từng chỗ dùng ---
//
// Lưới ảnh & lightbox dùng `fit` (chỉ giới hạn bề rộng, giữ tỉ lệ) rồi để CSS
// `object-fit: cover` cắt — một bộ biến thể phục vụ được cả 3 dạng ô (94 / 198 / 313 px)
// thay vì phải sinh riêng cho từng khung. Hero thì ngược lại: khung cao gần full màn
// (~390×852), nếu chỉ giới hạn bề rộng thì vẫn tải thừa rất nhiều chiều cao ⇒ dùng `fill`
// kèm đúng tỉ lệ và điểm nhấn chủ tiệc đã chọn.
const GALLERY_THUMB_WIDTHS = [160, 320, 640];
const GALLERY_FULL_WIDTHS = [640, 1080, 1600];
const HERO_WIDTHS = [400, 800, 1200];
const HERO_ASPECT = 390 / 852;
const MAP_WIDTHS = [320, 640];
const MAP_FULL_WIDTHS = [1080, 1600];

/**
 * Khổ hợp lệ cho route `/img` (đường ký dành cho client, xem `app/img/route.ts`).
 * Đóng khung ở đây để không ai bơm được `?w=` tuỳ ý sinh vô hạn biến thể — mỗi
 * biến thể lạ là một cache MISS bắt con box decode lại từ đầu.
 */
export const PROXY_WIDTHS = [
  ...new Set([...GALLERY_THUMB_WIDTHS, ...GALLERY_FULL_WIDTHS, ...HERO_WIDTHS, ...MAP_WIDTHS]),
].sort((a, b) => a - b);

/** Điền biến thể ảnh cho settings. Gọi ở server component, sau `asSiteSettings`. */
export function optimizeSettings(s: SiteSettings): SiteSettings {
  return {
    ...s,
    hero: s.heroUrl
      ? optimize(s.heroUrl, HERO_WIDTHS, {
          aspect: HERO_ASPECT,
          // `y ?? 0` chứ KHÔNG phải mặc định 50 của `variant()`: hero mặc định neo mép
          // TRÊN (hero.tsx objectPosition, và admin FocalPicker cũng khởi tạo heroY=0).
          // Để lệch thì ảnh chưa đặt điểm nhấn sẽ cắt giữa ở đường tối ưu nhưng cắt từ
          // đỉnh ở đường fail-open — hai khung hình khác hẳn nhau.
          focus: { x: s.heroX ?? 50, y: s.heroY ?? 0 },
        })
      : undefined,
    gallery: s.gallery?.map((img) => ({
      ...img,
      thumb: optimize(img.url, GALLERY_THUMB_WIDTHS, { fit: true }),
      full: optimize(img.url, GALLERY_FULL_WIDTHS, { fit: true }),
    })),
  };
}

/** Biến thể cho ảnh bản đồ của sự kiện. Gọi ở server component, sau `asEventData`. */
export function optimizeEvent(e: EventData): EventImages {
  if (!e.mapUrl) return {};
  return {
    map: optimize(e.mapUrl, MAP_WIDTHS, { fit: true }),
    mapFull: optimize(e.mapUrl, MAP_FULL_WIDTHS, { fit: true }),
  };
}
