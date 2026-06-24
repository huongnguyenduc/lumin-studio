# AGENTS.md — Lumin Studio

> Pointer cross-tool mỏng cho mọi coding-agent (Cursor, Codex, Aider, Zed, …). Bản đầy đủ cho Claude Code là
> [`CLAUDE.md`](CLAUDE.md). Đây cố ý ngắn — không lặp lại nội dung, chỉ trỏ đường.

**Là gì:** cửa hàng thiết kế & in 3D đèn/đồ trang trí theo đơn (made-to-order). 4 bề mặt (Storefront · Admin ·
Admin Mobile · Browser Extension) chạy trên **một** bộ trạng thái đơn.

**Đọc theo thứ tự:** bắt đầu từ [`docs/README.md`](docs/README.md) — nó là router ("đang làm X → đọc Y") và chỉ thứ
tự đọc. Nguồn chân lý: `spec.md` (hành vi/dữ liệu) · `design-system.md` + `tokens/` (giao diện) · `docs/decisions.md`
(ADR — **đừng relitigate**) · `docs/conventions.md` (luật code cứng).

**Verify trước khi coi là xong (các lệnh này có TỪ Phase 0, khi đã scaffold `package.json`/`Makefile`):**
- TS/JS: `pnpm verify` (= lint + typecheck + test + format:check)
- Go: `make verify-go`
- Rust: `make verify-rs`

**Luật bắt buộc (tóm tắt — chi tiết ở `docs/conventions.md`):** tiền lưu int VND, format qua **một** formatter trong
`packages/core` (`390.000₫`); tổng tính ở server; mọi chuỗi UI qua i18n (default `vi`), không hard-code; mọi lần đổi
trạng thái đơn ghi `statusHistory {from,to,at,byUser,reason?}`; tôn trọng `prefers-reduced-motion`; sentence case.

**Tầng enforcement** (hooks, deny rules, `spec-guardian`, rules theo path) là **Claude-Code-specific**, nằm trong
[`.claude/`](.claude/) — xem [`docs/agent-harness.md`](docs/agent-harness.md). Nếu một tool khác không đọc `.claude/`,
các luật trên áp dụng qua CI verify (`pnpm verify` / `make verify-*`) **kể từ Phase 0** (khi `package.json`/`Makefile` đã
scaffold) — **trước Phase 0 chưa có CI verify đó**, chỉ có hook `.claude/` (Claude-Code-specific) + self-test
`tests/harness/`. Dù cách nào, với tool ngoài Claude Code thì các luật trên không được nhắc tự động.
