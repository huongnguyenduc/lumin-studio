# e2e — smoke Playwright (opt-in thủ công)

Smoke 2 luồng tiền: **storefront checkout** (tạo đơn thật) và **wedding RSVP + wish**
(ghi dữ liệu thật). Vì thế e2e **không nằm trong `pnpm verify`/CI** — chạy tay,
against stack local.

> ⚠️ **ĐỪNG trỏ vào prod** (`www.luminstudio.vn` / `giangvahieu.luminstudio.vn`):
> test sẽ tạo đơn hàng và lời chúc thật.

## Chạy

```sh
pnpm install
pnpm --filter e2e exec playwright install chromium

# Storefront (cần core-api + Postgres + Garage + storefront dev — xem
# docs/operations.md và services/core-api; storefront cần CORE_API_URL):
E2E_BASE_URL=http://localhost:3000 pnpm --filter e2e test

# Wedding (cần wedding-api + Postgres đã migrate/seed 1 guest + wedding-web dev
# với WEDDING_API_URL — xem services/wedding-api/README.md §Run locally):
WEDDING_E2E_BASE_URL=http://localhost:3002 WEDDING_INVITE_SLUG=<slug-khách> \
  pnpm --filter e2e test
```

Không set env → test **skip** (an toàn khi chạy nhầm). Mỗi test chạy ở 2 project
viewport `phone-393` (393×852) và `phone-414` (414×896); viewport 414 có thêm
check tràn ngang cho trang thiệp (bắt lỗi tier-zoom Envelope).

Checkout storefront cần Garage cho bước upload biên lai (submit bị disable tới khi
upload xong) — stack thiếu Garage thì test fail ở bước đó, đúng như ngoài đời.
