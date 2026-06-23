---
description: Luật giao diện chung — a11y WCAG 2.2 AA, contrast, font tiếng Việt, i18n, sentence case, reduced-motion, state màn hình.
paths:
  - "apps/**"
  - "packages/ui/**"
---

# A11y · i18n · giao diện (mọi frontend)

> Vì sao: [`/docs/conventions.md`](../../docs/conventions.md) §A11y/§i18n · [`/design-system.md`](../../design-system.md) · [`/tokens/`](../../tokens).

- **Contrast (KHOÁ):** primary action **KHÔNG** dùng trắng-trên-`flame-500` (2.82:1 — FAIL AA). Dùng `flame-700 #C93A1A` (5.12:1) hoặc chữ `cocoa-900` trên `sun-500` (7.67:1). Khoá semantic alias để không chọn nhầm tổ hợp fail.
- **Font tiếng Việt:** subset `['vietnamese','latin']`; line-height heading ~**1.15–1.2** để không cắt dấu chồng (ế/ữ/ợ).
- **i18n:** không hard-code chuỗi UI — `next-intl` (ICU), default `vi`. Sẵn EN sau bằng cách thêm locale, không refactor.
- **Sentence case** mọi nơi (không ALL-CAPS cho câu). Giọng ấm, mộc, xưng "chúng mình / bạn". (Sentence-case không lint được — kiểm bằng test trên message catalog.)
- **Bàn phím & focus:** hit target ≥ 44px; `:focus-visible` rõ; label + lỗi gắn với field.
- **`prefers-reduced-motion`:** tắt entrance + dừng loop (áp cho viewer 3D và Cat Peek `respectReducedMotion`). Animation trang trí không bẫy focus/AT.
- Mỗi màn chính dựng đủ **empty · loading · error** — loading ưu tiên skeleton, error có nút thử lại, empty có CTA. **Tách todo riêng cho từng state** (đừng gộp vào happy-path rồi quên) — `spec.md` §03 (REC-SP-06).
- Style theo `design-system.md` + `tokens/*.css` (copy giá trị chính xác, đừng đoán hex/spacing).
