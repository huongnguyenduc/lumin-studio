import { test, expect } from '@playwright/test';

// Smoke luồng tiền storefront: home → sản phẩm → thêm giỏ → /thanh-toan →
// điền form → chuyển khoản (upload biên lai) → đặt đơn → màn chờ có mã đơn.
// WARNING: luồng này TẠO ĐƠN THẬT — chỉ chạy against stack local/dev,
// TUYỆT ĐỐI không trỏ E2E_BASE_URL vào prod.
const base = process.env.E2E_BASE_URL;

// 1×1 PNG làm ảnh biên lai giả cho bước upload proof (P2-c).
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

test.describe('storefront checkout', () => {
  test.skip(!base, 'set E2E_BASE_URL (stack local: core-api + garage + storefront) để chạy');

  test('home → sản phẩm → giỏ → đặt đơn → mã đơn', async ({ page }) => {
    await page.goto(base!);
    // Card đầu tiên của catalog/featured (CatalogCard link /san-pham/{slug}).
    await page.locator('a[href^="/san-pham/"]').first().click();
    await page.getByRole('button', { name: 'Thêm vào giỏ' }).first().click();

    await page.goto(`${base}/gio-hang`);
    await page.getByRole('link', { name: /Đặt hàng/ }).click();
    await expect(page).toHaveURL(/thanh-toan/);

    // Form C1 — tối thiểu: tên, SĐT, tỉnh (option đầu), phường/xã, địa chỉ.
    await page.getByLabel('Họ tên').fill('Khách E2E');
    await page.getByLabel('Số điện thoại').fill('0912345678');
    await page.getByLabel('Tỉnh / thành').selectOption({ index: 1 });
    await page.getByLabel('Phường / xã').fill('Phường E2E');
    await page.getByLabel('Địa chỉ', { exact: true }).fill('1 đường Test');
    // Nút tự enable khi quote server trả tổng tiền — click auto-wait lo việc chờ.
    await page.getByRole('button', { name: 'Tiếp tục thanh toán' }).click();

    // Bước C2: upload biên lai rồi xác nhận.
    await expect(page.getByRole('heading', { name: 'Chuyển khoản' })).toBeVisible();
    await page
      .locator('input[type="file"]')
      .setInputFiles({ name: 'bien-lai.png', mimeType: 'image/png', buffer: TINY_PNG });
    const submit = page.getByRole('button', { name: 'Xác nhận đặt đơn' });
    await expect(submit).toBeEnabled({ timeout: 20_000 });
    await submit.click();

    // C3 wait-screen: lời cảm ơn + heading "Đơn {code}".
    await expect(page.getByText('Đơn đã đặt rồi', { exact: false })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole('heading', { name: /^Đơn / })).toBeVisible();
  });
});
