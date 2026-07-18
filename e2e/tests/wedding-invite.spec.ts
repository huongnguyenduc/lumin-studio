import { test, expect } from '@playwright/test';

// Smoke thiệp cưới: mở /i/{slug} → RSVP → gửi lời chúc. Chạy ở cả 2 viewport
// (393/414) — 414px thêm check tràn ngang để bắt lỗi tier-zoom Envelope.
// WARNING: RSVP + wish GHI dữ liệu — đừng trỏ vào prod (giangvahieu...).
const base = process.env.WEDDING_E2E_BASE_URL;
const slug = process.env.WEDDING_INVITE_SLUG;

test.describe('wedding invite', () => {
  test.skip(!base || !slug, 'set WEDDING_E2E_BASE_URL + WEDDING_INVITE_SLUG (slug khách đã seed)');

  test('mở thiệp → RSVP → gửi wish', async ({ page }) => {
    await page.goto(`${base}/i/${slug}`);
    await expect(page.getByText('Giang & Hiếu').first()).toBeVisible();

    // Không tràn ngang (viewport 414 bắt lỗi scale/tier-zoom của Envelope).
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, 'trang thiệp bị tràn ngang (envelope/tier-zoom?)').toBeLessThanOrEqual(1);

    // RSVP — pill chỉ render cho link khách hợp lệ; chờ POST upsert thành công.
    const rsvpDone = page.waitForResponse(
      (r) => r.url().includes('/rsvp') && r.request().method() === 'POST' && r.ok(),
    );
    // Regex chặt đầu-cuối: không khớp "Không tham dự được"; chấp nhận cả trạng
    // thái đã chọn "✓ Tham dự được" từ lần chạy trước (upsert idempotent).
    await page.getByRole('button', { name: /^(✓ )?Tham dự được$/ }).click();
    await rsvpDone;
    await expect(page.getByText('✓ Tham dự được')).toBeVisible();

    // Wish — điền tên + lời chúc, chờ POST /api/wishes ok, thấy màn cảm ơn.
    await page.getByLabel('Tên của bạn').fill('Khách E2E');
    await page.getByLabel('Viết lời chúc...').fill('Chúc hai bạn trăm năm hạnh phúc!');
    const wishDone = page.waitForResponse(
      (r) => r.url().includes('/api/wishes') && r.request().method() === 'POST' && r.ok(),
    );
    await page.getByRole('button', { name: 'Gửi lời chúc' }).click();
    await wishDone;
    // exact: câu cảm ơn RSVP cũng mở đầu bằng "Cảm ơn bạn!" (strict mode).
    await expect(page.getByText('Cảm ơn bạn!', { exact: true })).toBeVisible();
  });
});
