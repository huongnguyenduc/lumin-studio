# Lumin Studio — Design System (token + component) cho Claude Code

Nguồn chân lý về **giao diện**. Giá trị máy-đọc nằm trong `tokens/*.css` (copy nguyên vào theme
của codebase, đừng đoán). Dưới đây là bản tóm tắt + ý đồ sử dụng.

## Brand một dòng
Đèn & đồ in 3D theo đơn — ấm, tái chế, không đại trà. Vui vẻ & con người, nhưng ngăn nắp & tin cậy.

---

## Màu (`tokens/colors.css`)

**Brand core**
| Token | Hex | Dùng |
|---|---|---|
| `--cream-200` (buttercream) | `#FFE9A4` | Nền hero, mảng cream signature (logo) |
| `--cream-50` (page) | `#FFFBEF` | Nền trang gần-trắng |
| `--cocoa-900` (cocoa/ink) | `#492F10` | Chữ đậm, surface tối, **outline signature** |

**Accent**
| Vai trò | Token 500 | Hex |
|---|---|---|
| **Primary / "pop"** (coral) | `--flame-500` | `#FF6B4A` (hover `#F04E29`, press `#C93A1A`) |
| Success / fresh (teal) | `--teal-500` | `#16B5A0` |
| Info / link (sky) | `--sky-500` | `#4C8DFF` |
| Highlight / warning (sun) | `--sun-500` | `#FFC233` |
| Danger | `--danger-500` | `#F0492B` |

**Alias ngữ nghĩa — DÙNG CÁI NÀY trong component, không dùng hex thô:**
`--text-strong` `--text-body` `--text-muted` `--text-on-dark` `--text-link` ·
`--surface-page` `--surface-card(#FFF)` `--surface-cream` `--surface-brand(cocoa)` ·
`--border-subtle(#EFE6CC)` `--border-strong(cocoa)` ·
`--primary` (=coral) `--primary-hover` `--primary-press` `--on-primary(#FFF)` · `--focus-ring(sky)`.

> **Primary action = coral (flame), KHÔNG phải cocoa.** Cocoa là secondary/outline/ink.
> Không gradient làm nền trang — gradient chỉ xuất hiện bên trong placeholder "glow" của sản phẩm.

---

## Type (`tokens/typography.css`)

| Vai trò | Font | Dùng |
|---|---|---|
| Display (`--font-display`) | **Bricolage Grotesque** 600–800 | Heading & button. Tracking `-0.02em`, line-height 1.0–1.1 ở size lớn |
| Body/UI (`--font-body`) | **Hanken Grotesque** 400–800 | Toàn bộ body & UI |
| Spec/mono (`--font-mono`) | **Space Mono** 400/700 | Kích thước, SKU, mã, label nhỏ |

Scale: `--text-xs 12` → `sm 14` → `base 16` → `lg 18` → `xl 20` → `2xl 24` → `3xl 30` →
`4xl 38` → `5xl 48` → `6xl 64` → `7xl 84`px.
Line-height: tight 1.05 · snug 1.2 · normal 1.5 · relaxed 1.7. Tracking: tight `-0.02em` · wide `0.04em` · wider `0.12em`.

> Đây là Google Fonts thay thế (chưa có font brand gốc). Nếu có file licensed thì swap.

---

## Spacing (`tokens/spacing.css`) — lưới 4px
`--space-1 4` · `2 8` · `3 12` · `4 16` · `5 20` · `6 24` · `8 32` · `10 40` · `12 48` ·
`16 64` · `20 80` · `24 96` · `32 128`px.
Layout: `--container-max 1200px` (nội dung 1160–1320px), `--gutter 24px` (28px trên wide).

## Radius (`tokens/radius.css`) — bo tròn rộng rãi
`--radius-xs 6` · `sm 10` · `md 16` · `lg 24` (card) · `xl 32` · `2xl 44` · `pill 999px` (button/tag/badge) ·
`--radius-blob 48% 52% 55% 45% / 52% 48% 52% 48%` (hình blob hữu cơ cho hero/avatar).

## Shadow / elevation (`tokens/shadow.css`) — bóng ấm tông cocoa, không xám
- Ambient: `--shadow-sm/md/lg/xl` (rgba cocoa).
- **Signature `--shadow-pop: 4px 4px 0 cocoa`** (đặc, không blur) cho CTA & feature card.
  Hover → `translate(-1px,-1px)` bóng lớn hơn; press → `translate(2px,2px)` lún vào bóng.
- `--shadow-pop-flame` (bóng coral), `--shadow-inset` (pressed), `--ring-focus` (sky 3px).

## Borders — 2 register
Hairline `--border-subtle (#EFE6CC)` trên card yên tĩnh · **outline cocoa 2–3px** trên element "chunky"
(pop button, feature card, order-tracking card) — đây là **chữ ký thị giác**.

## Texture
`.lumin-dotgrid` — dot-grid cocoa trên cream, đặt sau placeholder sản phẩm & vùng vui chơi.
Sticky header: cream 85% + backdrop-blur 10px. Scrim modal/drawer: cocoa 40–45%. Không glassmorphism khác.

---

## Iconography
- Inline **SVG line icon**, một màu (`currentColor`), stroke **2.1–2.2px**, round cap/join, size 17–24px.
- Không filled set, không icon font. Cần thư viện đầy đủ → dùng **Lucide** (same 2px rounded), tint `currentColor`.
- Emoji chỉ dùng làm accent biểu cảm (👋 🎉), không làm icon chức năng. **✦ sparkle** là glyph "spark" của brand.

---

## Component (namespace `DesignSystem_c90f11`)

Dựng lại các primitive này trong codebase. Props tóm tắt:

| Component | Mô tả & props chính |
|---|---|
| **Button** | `primary`=coral · `secondary`=cocoa · `outline` · **`pop`**=gold + bóng offset cocoa (CTA hero). `size` sm/md/lg |
| **IconButton** | Tròn, chỉ icon. `variant` soft/solid/ghost · `size` · luôn có `label` (a11y) |
| **Badge** | Pill trạng thái/merch — "New", "In stock". `tone` coral/teal/… · `solid` |
| **Tag** | Chip filter/material. `selectable` + `selected` · `onRemove` (chip filter đang chọn) |
| **Avatar** | Tròn, halo cream. `name` (initials) · `src` · `size` |
| **Card** | Surface bo tròn. `elevation` md (quiet) / **pop** (outlined + offset shadow) · `interactive` |
| **Input** | Field bo tròn. `label` · `hint` · `error` · leading icon |
| **Switch** | Toggle pill; track teal khi on, knob lò xo. `checked` · `onChange` |
| **Checkbox** | Vuông bo tròn, multi-select/consent. `checked` · `label` |
| **QuantityStepper** | −/+ tròn, clamp min/max. `value` · `min` · `max` · `onChange` |
| **Rating** | Sao sun-gold, half-star. `value` · `count` · `interactive` + `onRate` |
| **PriceTag** | Giá font display, optional compare-at. VND mặc định (`₫`); `currency="$"` cho USD |
| **ProductCard** | Tile merchandising — compose Badge + Rating + PriceTag + IconButton(fav) + Button(add) |

### Cách load (trong môi trường thiết kế HTML)
Mỗi `.dc.html` nạp bundle 1 lần trong `<helmet>` rồi mount component qua
`<x-import component-from-global-scope="DesignSystem_c90f11.Button" ...>`. Trong **codebase thật**,
KHÔNG dùng bundle này — hãy **dựng lại** các component tương đương bằng thư viện của bạn, map đúng
token & props ở trên.

> Token CSS gốc: `tokens/colors.css · typography.css · spacing.css · radius.css · shadow.css · base.css · components.css`.
> `base.css` chứa reset + `.lumin-dotgrid`; `components.css` chứa state hover/press.
