import { defineConfig } from '@playwright/test';

// Smoke E2E — opt-in thủ công (KHÔNG nằm trong pnpm verify/CI): cần stack sống
// và luồng checkout GHI dữ liệu thật. Xem README.md cạnh file này.
// 2 viewport điện thoại: 393px (baseline) + 414px (điện thoại lớn — bắt lỗi
// tier-zoom/tràn ngang của Envelope thiệp cưới).
export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  retries: 0,
  reporter: 'list',
  // reducedMotion: các section thiệp cưới reveal theo scroll (opacity 0 tới khi
  // IntersectionObserver bắn) — reduce cho nội dung hiện ngay, test khỏi phụ
  // thuộc timing animation (site tôn trọng prefers-reduced-motion theo convention).
  use: { contextOptions: { reducedMotion: 'reduce' } },
  projects: [
    { name: 'phone-393', use: { viewport: { width: 393, height: 852 } } },
    { name: 'phone-414', use: { viewport: { width: 414, height: 896 } } },
  ],
});
