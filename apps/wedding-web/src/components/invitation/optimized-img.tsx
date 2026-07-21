'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import type { ImgVariants } from '@/lib/site-settings';

// Ảnh có ĐƯỜNG LÙI LÚC CHẠY (ADR-055).
//
// `lib/img.ts` chỉ fail-open được với trường hợp "chưa cấu hình" — nó không biết
// imgproxy sống hay chết. Còn rất nhiều cách hỏng chỉ lộ ra khi trình duyệt đã tải:
// 403 (KEY/SALT lệch vì patch Secret mà quên `rollout restart wedding-web`), 404
// (bucket/path-style sai), hoặc pod chưa lên. Không bắt những ca đó thì hero + cả
// lưới ảnh + bản đồ hiện ẢNH VỠ — tệ hơn hẳn so với việc phát ảnh gốc chưa tối ưu.
//
// Nên: lỗi lần đầu ⇒ bỏ srcSet, quay về đúng URL gốc. Lỗi tiếp ⇒ nhường cho `onFail`
// (chỗ gọi tự quyết định, ví dụ admin hiện nhãn "không tải được ảnh").
export function OptimizedImg({
  img,
  fallback,
  sizes,
  alt,
  hidden,
  lazy,
  draggable,
  style,
  onFail,
}: {
  img?: ImgVariants;
  /** URL gốc — luôn phải có, đây chính là đường lùi. */
  fallback: string;
  sizes?: string;
  alt: string;
  /** Ảnh trang trí: đặt `aria-hidden` (alt vẫn phải là chuỗi rỗng). */
  hidden?: boolean;
  lazy?: boolean;
  draggable?: boolean;
  style?: CSSProperties;
  onFail?: () => void;
}) {
  const [degraded, setDegraded] = useState(false);
  // Đổi ảnh (chủ tiệc upload lại, hoặc lightbox sang tấm khác) thì thử lại bản tối ưu.
  useEffect(() => setDegraded(false), [img?.src, fallback]);

  const useOptimized = Boolean(img) && !degraded;
  return (
    <img
      src={useOptimized ? img!.src : fallback}
      srcSet={useOptimized ? img!.srcSet : undefined}
      sizes={useOptimized ? sizes : undefined}
      alt={alt}
      aria-hidden={hidden || undefined}
      loading={lazy ? 'lazy' : undefined}
      decoding="async"
      draggable={draggable}
      onError={() => (useOptimized ? setDegraded(true) : onFail?.())}
      style={style}
    />
  );
}
