# Wedding Invitation Website — Developer Handoff

**Project:** "Giang & Hiếu" wedding invitation site (Vietnamese-language, mobile-first)
**Prototype:** `Wedding Invitation.dc.html` (guest-facing), `Admin.dc.html` (host dashboard), `guest-db.js` (mock data layer)
**Target stack:** Next.js (frontend) + Go (backend API), deployed on the existing home k3s cluster alongside `lumin-studio`, behind Cloudflare Tunnel. Served on a subdomain, with support for attaching a custom domain later.

---

## 1. Product overview

A single-page wedding invitation that each guest opens via a **personalized link**. The couple manages guests, tracks opens/RSVPs, and moderates wishes from an admin dashboard.

Two surfaces:

1. **Invitation page** (`/` with `?g=<guestId>`, or path-style `/i/<guestId>` in production) — public, mobile-first, fixed 393px card centered on desktop.
2. **Admin dashboard** — private (auth required), desktop-first, max-width 1120px.

### Core loop
1. Host adds guests in Admin (each gets a unique id + "salutation label" shown on the card).
2. Host copies the guest's personal link and sends it via Zalo/Messenger/SMS.
3. Guest opens link → open is tracked (`openedAt`, first open only) → sees their name on the invitation.
4. Guest RSVPs (yes/no) and optionally submits a wish (name + text + card color).
5. Host monitors stats, filters/sorts guests, deletes inappropriate wishes, exports Excel.

---

## 2. Guest flow (invitation page)

Section order, top to bottom. All content is Vietnamese. The page is one continuous scroll — no navigation.

### 2.1 Hero (`Hero`, 852px tall)
- Full-bleed couple photo (`assets/hero.jpg`), circular logo mark + two rotated ellipse borders (one solid, one dashed) top-center.
- Bottom gradient overlay (transparent → `rgb(59,47,39)`), script text "save the date".
- **Music toggle button** (32px circle, bottom-right): speaker icon when off, pause bars when on, with a diagonal slash overlay when muted. States cross-fade (0.6s opacity).
- **Scroll hint** ("Cuộn xuống để mở thiệp" + chevron, bobbing 2.2s loop): shown only on first visit (`localStorage: hg_hint_seen`); fades out (0.9s) on first scroll and never returns. `?hint` query param forces it (for testing).

### 2.2 Envelope transition (`Envelope`, 350px, overlaps hero by −178px)
Decorative "opening envelope": a triangular flap (clip-path polygon, uses `assets/flap.jpg`), two rotated lace panels (`assets/lace.png`, one mirrored), and a wax stamp (`assets/stamp.png`, 73px) centered. Pure decoration, no interaction.

### 2.3 Letter (`Letter`)
The main invitation text, framed by vertical lace strips (6px repeating `lace-v.png`, doubled on both edges) and closed by two horizontal lace strips at the bottom.

Content stack (centered):
- "TRÂN TRỌNG KÍNH MỜI" (600, 14px uppercase)
- **Guest name** — script font, 22px, terracotta `rgb(203,77,28)`, capitalized. Resolved from the guest record; falls back to "Quý Khách/Cô/Chú/Anh/Chị/Bạn" for anonymous visits.
- "ĐẾN THAM DỰ TIỆC VU QUY"
- Couple names in script 42px with overlapping rings image between (66px, negative margins −14/−23).
- Time row: `17:30 | Thứ bảy | 12.09.2026` (18px, 600, separated by 1px×34px dividers) + lunar date in italic 12px.
- Venue: "THE MIRA CENTRAL PARK / SẢNH TẦNG 5" + address (italic, 12px, 227px wide).
- Static map image inside a 313×196 rounded card, then a pill CTA **"Mở trong Google Maps"** (external link).
- **Timeline**: script heading, vertical hairline connecting two entries (17:30 Đón khách / 19:00 Nhập tiệc), each with a 54px circular icon.

### 2.4 Events (`Events`, 589px)
Background photo (`together.jpg`) with a 24% brown tint overlay. Two **ticket-shaped cards** (144.5×304, octagonal clip-path with a double border achieved via 3 stacked clip-path layers: cream → tan inset 4.5px → cream inset 5.2px):
- **Lễ Vu Quy** — 8:00, 20.09.2026, Tư gia Nhà Gái (Đồng Nai)
- **Lễ Thành Hôn** — 10:30, 20.09.2026, Tư gia Nhà Trai (TP.HCM)

Each has the double-happiness glyph (24px), rows separated by 0.5px hairlines. Letterspaced script word "together" at the bottom.

### 2.5 Gallery (`Gallery`)
- Heading "Giang & Hiếu" (script 44px) + "ĐÀ LẠT 2026" kicker.
- 12 photos in a 3-column dense grid (rows 118px, gap 16px) with intentional spans: two 2×2 features, two 1×2 talls, rest 1×1. Order: g02(2×2), g03, g04, g05(1×2), g06(2×2), g07, g08(1×2), g12(1×2), g01, g09, g10, g11.
- **Lightbox** on tap: dark scrim `rgba(32,26,21,0.94)`, image max 86vw × 72vh, counter "n / 12", prev/next circular buttons, close ✕, keyboard support (Esc / ← / →), wraps around. Clicking scrim closes; clicking image doesn't.

### 2.6 RSVP (`RSVP`, brown block `rgb(120,105,93)`)
- Script heading "Xác nhận tham gia", two short paragraphs (12px cream) incl. RSVP deadline 05/09/2026.
- Two pill buttons: **"Tham dự được"** / **"Không tham dự được"**. Selected state: filled cream with ✓ and brown text; unselected: outlined. Selection is mutually exclusive and **can be changed** any time (idempotent update, not one-shot).
- After choosing, a thank-you line appears (copy differs by yes/no).
- If the visitor arrived via a guest link, RSVP writes to that guest record (`rsvp`, `rsvpAt`). Anonymous visitors can still toggle locally but nothing persists server-side (decide: hide RSVP for anonymous, or keep as-is).

### 2.7 Wish form (`Wish form`)
A decorative paper card (`wish-paper.png`, 310×475) containing:
- Intro line, **name input** (prefilled with guest label when known), **message textarea** (108px), both transparent with 0.5px hairline rings, 25px/14px radius.
- **Card color picker**: 4 swatches, 18px circles — Trắng ngà `rgb(255,251,248)`, Kem `rgb(249,241,232)`, Hồng phấn `rgb(248,235,230)`, Xanh ô liu `rgb(238,239,230)`. Selected swatch gets a terracotta double-ring.
- "GỬI LỜI CHÚC" pill button. Empty text = no-op. On success the form is replaced by a thank-you state ("Cảm ơn bạn!" in script + subtitle).
- **Live preview**: while typing (before send), a preview card renders below the paper exactly as it will appear on the wall, with the chosen background color, "vừa xong" timestamp.

### 2.8 Wishes wall (`Wishes wall`) — **final style: "letters" (option 1a)**
- Heading "Lời chúc gửi trao" + kicker "TỪ NHỮNG NGƯỜI THƯƠNG YÊU".
- Vertical stack of letter cards: chosen background color, 8px radius, 0.5px tan ring + soft shadow, italic quoted text (12px/1.7), script signature (18px terracotta), relative timestamp right-aligned.
- Shows 4 initially; **"Xem thêm lời chúc"** pill loads +6 per click.
- Newest first. Relative time formatting: <1h "vừa xong", <24h "N giờ trước", <7d "N ngày trước", else `d.m.yyyy`.
- (The prototype also contains `marquee` and `cards` variants behind a `wishesStyle` prop — **do not implement**; letters is final.)

### 2.9 Footer
"Thank You" in script 48px + small logo mark. End of page.

### 2.10 Background music
- `assets/music.mp3` (looping). Autoplay is attempted on **first scroll** (counts as… it usually still fails); on rejection, a one-time `pointerdown` listener retries — i.e. music starts on first tap after scrolling.
- Volume fades in to 0.85 over 2.4s; toggling off fades to 0 over 0.7s then pauses.
- The toggle button reflects state (see 2.1). Never autoplay on load without gesture — this pattern is deliberate.

### 2.11 Scroll-reveal animation
Every `[data-reveal]` element starts `opacity:0; translateY(26px)` and transitions in (opacity 1.1s ease-out, transform 1.25s cubic-bezier(0.22,0.61,0.36,1)) when 12% visible (IntersectionObserver, rootMargin `0 0 -6%`), with optional per-element stagger `data-reveal-delay` (60–200ms used). One-shot (unobserve after reveal). Implement as a small hook/component in Next.js; respect `prefers-reduced-motion` (skip animation, show immediately) — an improvement over the prototype.

---

## 3. Admin flow

Single dashboard page. In production, protect with auth (see §6). Header: logo mark (tinted via CSS mask), couple name in script, "QUẢN LÝ THIỆP MỜI — 12.09.2026", actions: **Xuất Excel**, **Xem thiệp mẫu** (opens invitation without `?g`), **Đặt lại dữ liệu** (prototype-only; drop in production or keep as a guarded "danger zone").

### 3.1 Stats row (5 cards)
Khách mời (total) · Đã mở thiệp (openedAt set) · Tham dự (green, `oklch(0.52 0.09 155)`) · Không tham dự (red, `oklch(0.52 0.09 30)`) · Lời chúc (count).

### 3.2 Quick add panel
- Single input "Xưng hô trên thiệp" — **Enter adds and keeps focus** for rapid entry; toast shows "Đã thêm "X" · N khách trong phiên này" (2.6s).
- **Group chips** select the default group applied to new guests. Groups are user-managed: `+ Nhóm` opens an inline input (Enter creates & selects, Esc cancels); "Sửa nhóm" toggles manage mode (click chip → rename via prompt; × → delete with confirm, members move to "Khác").
- Default groups: Nhà gái, Nhà trai, Bạn cô dâu, Bạn chú rể, Đồng nghiệp, Bạn bè.
- **Bulk add**: textarea, one guest per line, optional `, GroupName` suffix (split on **last** comma); lines without a group use the selected chip. Button shows live count ("Thêm N khách").

### 3.3 Edit panel (inline, above the table)
Opens on row "Sửa": label input, group select, **private note** input ("không hiện trên thiệp"), and a live script-font preview of how the label renders on the card. Lưu / Huỷ.

### 3.4 Guest table
Columns: Khách mời (label + group·id + note) | Mở thiệp | Phản hồi | Lời chúc | Liên kết riêng.
- **Filters**: search (matches label + note), status chips with counts (Tất cả / Chưa mở / Đã mở / Tham dự / Không tham dự / Chưa phản hồi), group chips. Any filter change resets to page 1.
- **Sorting**: clickable headers Khách mời (vi locale compare) / Mở thiệp / Phản hồi (yes>no>pending); toggle asc/desc with ▲▼ indicator. Default: insertion order desc (newest first).
- **Pagination**: page sizes 10/25/50/100, ‹ › controls, "Hiển thị a–b / n khách".
- **Open status**: green dot + "Đã mở · N giờ trước" or gray dot + "Chưa mở".
- **RSVP badge**: outlined pill, green/red/neutral.
- **Notes**: inline edit (✎ click, Enter saves, Esc cancels, blur saves). If no note: small dotted "+ Ghi chú" link.
- **Duplicate warning**: when 2+ guests share (label lowercase + group), rows without a note get a terracotta pill "Trùng tên — thêm ghi chú" that opens the note editor. Duplicates are allowed — notes disambiguate.
- **Per-row actions**: Sao chép link (clipboard + green toast), Mở (new tab), Sửa, Xoá (confirm).

### 3.5 Site settings (new — not in prototype)
A "Cài đặt trang" section in Admin lets the host configure site content without a redeploy:
- **Hero background image** — replaces `hero.jpg`.
- **Gallery images** — ordered list (add / remove / drag-reorder); the invitation grid renders however many are provided (keep the span pattern for the first 12; extra images continue as 1×1 cells).
- **Map image** — replaces `map.png` (static image, keeps the fast no-embed approach).
- **Google Maps link** — URL used by the "Mở trong Google Maps" CTA.
- **Background music** — audio upload (mp3/m4a, cap ~10MB); invitation plays whatever is set, gracefully silent if none.
- **Site meta** — website title, description, OG image (upload), favicon/icon (upload). Rendered into `<head>` server-side (Next.js metadata) so link previews on Zalo/Messenger show correctly.

All uploads go to **lumin-studio's existing Garage (S3)** — see §6. Store settings as a single `settings` row/JSONB (key→value) in Postgres; the invitation page reads it at SSR time (ISR revalidate on save, or short cache TTL).

Upload flow reuses the lumin-studio pattern: Go API issues a **presigned POST/PUT** to Garage (MIME + size constraints), client uploads directly, API stores the object key. Serve via Cloudflare-cached public bucket paths with hashed keys (immutable cache).

### 3.6 Wishes panel
Grid of 3 columns, paginated (6/12/24 per page), newest first: quoted text, script signature, relative time, "Xoá lời chúc" (confirm). Moderation is delete-only — no approval queue (wishes appear publicly immediately; revisit if abuse becomes a concern).

### 3.7 Bulk selection & delete (new — not in prototype)
Guest table rows get a **leading checkbox column**: header checkbox = select all on current page (indeterminate state when partial); selecting ≥1 row shows an action bar above the table — "Đã chọn N khách · Xoá · Bỏ chọn" — delete with a single confirm dialog. Selection clears on filter/page change. Apply the same pattern to the wishes panel (checkbox per card, bulk "Xoá lời chúc").

### 3.8 Excel export
Two sheets via SheetJS (client-side is fine, or generate server-side in Go with excelize):
- **Khách mời**: Xưng hô | Nhóm | Ghi chú | Mở thiệp (Đã/Chưa mở) | Thời gian mở (vi-VN locale) | Phản hồi | Lời chúc (first wish by that guest) | Link thiệp (absolute URL).
- **Lời chúc**: Tên | Lời chúc | Thời gian.
CSV fallback with BOM (`\ufeff`) if xlsx lib unavailable.

---

## 4. Data model

Prototype uses localStorage (`guest-db.js`, key `hg_wedding_db_v1`); replace with Postgres. Suggested schema:

```sql
CREATE TABLE guests (
  id          TEXT PRIMARY KEY,          -- short slug, e.g. 'colan', 'g4f8k2a'; used in the public link
  label       TEXT NOT NULL,             -- salutation shown on the card
  "group"     TEXT NOT NULL DEFAULT 'Bạn bè',
  note        TEXT,                      -- private, admin-only
  opened_at   TIMESTAMPTZ,               -- first open only, never overwritten
  rsvp        TEXT CHECK (rsvp IN ('yes','no')),  -- NULL = pending
  rsvp_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE wishes (
  id          TEXT PRIMARY KEY,
  guest_id    TEXT REFERENCES guests(id) ON DELETE SET NULL,  -- NULL for anonymous
  name        TEXT NOT NULL DEFAULT 'Khách mời',
  text        TEXT NOT NULL,
  color       TEXT,                      -- one of the 4 preset rgb strings; NULL → default cream
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE groups (
  name        TEXT PRIMARY KEY,
  sort_order  INT
);
```

Notes:
- **Guest id doubles as the invite token.** **Slug format: derived from the guest label** — lowercase, Vietnamese diacritics stripped, non-alphanumerics → `-` (e.g. "Cô Lan & Chú Minh" → `co-lan-chu-minh`). On collision, append an incrementing suffix: `co-lan-chu-minh-2`, `-3`… Slug is generated once at creation and **never changes on rename** (links already sent must keep working). Trade-off accepted: links are guessable; risk for a wedding is negligible.
- Add a `settings` table/JSONB row for site configuration (hero image, gallery list, map image, maps URL, music, title/description/OG image/icon) — values are Garage object keys or plain strings.
- `opened_at` is write-once (set only if NULL) — matches prototype `markOpened`.
- RSVP is upsert, last-write-wins, always stamps `rsvp_at`.
- Deleting a group reassigns members to "Khác"; renaming cascades.

## 5. API surface (Go)

Public (rate-limit these):
```
GET  /api/invite/:guestId          → { id, label, rsvp }        (also fires opened_at write-once; 404 → render anonymous card)
POST /api/invite/:guestId/rsvp     { rsvp: "yes"|"no" }
POST /api/wishes                   { guestId?, name, text, color }   → created wish
GET  /api/wishes?limit&offset      → public wall (id, name, text, color, createdAt)
```
Admin (auth required):
```
GET/POST/PATCH/DELETE /api/admin/guests[...]
GET/DELETE            /api/admin/wishes[...]
GET/POST/PATCH/DELETE /api/admin/groups[...]
GET                   /api/admin/stats
GET                   /api/admin/export.xlsx      (optional server-side export)
POST                  /api/admin/guests/bulk-delete   { ids: [...] }
POST                  /api/admin/wishes/bulk-delete   { ids: [...] }
GET/PATCH             /api/admin/settings
POST                  /api/admin/uploads/presign      { kind: hero|gallery|map|music|og|icon, mime, size } → presigned Garage POST
```
Validation: wish text required, cap length (~500 chars), color must be one of the 4 presets. Wall updates: simple polling (30–60s) or refetch-on-focus is plenty; SSE is overkill here.

## 6. Auth & deployment

- **Deployment:** k3s on the home PC, same cluster as lumin-studio. One Next.js deployment (invitation SSR/ISR + admin routes) + one small Go API deployment + reuse the existing Postgres (separate database, e.g. `wedding`). Ingress via the existing Cloudflare Tunnel → subdomain, e.g. `giangvahieu.<your-domain>`. Custom-domain support: keep host handling generic (Ingress host list + Cloudflare custom hostname / additional tunnel route) so a purchased domain can be pointed later with no code change.
- **Admin auth:** simplest robust option given the infra: **Cloudflare Access** in front of `/admin` (the lumin-studio stack already uses CF edge). Alternatively a single shared password → JWT cookie in the Go API. No user management needed — 1–2 operators.
- **Assets live in lumin-studio's Garage (S3)** — a dedicated bucket (e.g. `wedding-assets`) with its own scoped S3 key, public-read via Caddy/Cloudflare-cached paths, hashed object keys → immutable cache. Built-in decor assets (lace, stamp, fonts, icons) stay in Next `public/`; host-configurable media (hero, gallery, map, music, OG image, icon) come from Garage via settings.
- The invitation page should be **SSR per guest id** (label injected server-side) so the name renders without flicker, with the rest static.

## 7. Design system

### Palette
| Token | Value | Use |
|---|---|---|
| ink/brown | `rgb(120,105,93)` | primary text, buttons, RSVP block bg |
| brown-dark | `rgb(101,88,77)` | button hover |
| tan | `rgb(176,157,144)` | hairlines (0.5px rings), secondary text |
| tan-light | `rgb(186,170,159)` | muted text, placeholders |
| cream-bg | `rgb(255,251,248)` | card/page surface |
| cream-2 | `rgb(249,241,232)` | alt surface, hover fills |
| terracotta | `rgb(203,77,28)` | guest name, signatures, accents |
| page-bg | `rgb(236,229,222)` (invite) / `rgb(245,241,236)` (admin) | outside the card |
| dark | `rgb(59,47,39)` | hero gradient |
| status green/red | `oklch(0.52 0.09 155)` / `oklch(0.52 0.09 30)` | admin RSVP states |

### Type
- **DFVN Kaelyna Script** (`assets/DFVN-KaelynaScript.otf`, licensed Vietnamese script) — display/names; fallback Great Vibes (Google).
- **Playfair Display** variable (self-hosted TTF, wght 100–900 + italic) — everything else. Weights used: 400, 500, 600.
- Recurring styles: uppercase labels 10–14px with 0.14–0.3em tracking; italic 12px/1.55–1.7 body; script sizes 18–48px.

### Shape language
- Pills: `border-radius: 22–25px` for all buttons/chips; cards 8–10px.
- **Borders are box-shadow rings** (`0 0 0 0.5px <tan>`), not CSS borders — keeps hairlines sub-pixel crisp. Preserve this technique.
- Buttons: filled brown (hover brown-dark) or outlined ring (hover cream-2 fill). 12px uppercase, 0.06–0.08em tracking.

### Key design decisions (rationale)
1. **Fixed-width card, two sizes** — the invitation is designed as a physical object (letter in an envelope), not a fluid web page. Base width **393px**; add one desktop breakpoint (≥ ~1024px) where the whole card scales up modestly — recommended `transform: scale(1.25)` on the card wrapper (≈491px visual) with transform-origin top center, or a CSS-var–driven proportional size bump. Never fluid-reflow: all internal absolute positions (envelope, lace, stamp) depend on the 393px composition, so scale the composition as a unit rather than re-laying it out.
2. **Envelope metaphor** — hero photo = envelope front; scrolling "opens" it (flap + lace + wax stamp transition into the letter). The scroll hint exists because the hero looks complete and first-time users didn't scroll.
3. **Music tied to scroll+gesture**, never on load — browser policy + politeness; fade-in avoids the jump scare.
4. **Personalized salutation as free text** (not first/last name fields) — Vietnamese salutations are relational ("Cô Lan & Chú Minh", "Gia đình Bác Ba"); one label field is the correct model.
5. **RSVP is two explicit pills, changeable** — guests change their minds; no confirmation friction.
6. **Wish card colors** are 4 curated presets from the palette — keeps the wall cohesive; never a free color picker.
7. **Open tracking is first-open-only** — it answers "did the link reach them", not analytics.
8. **Duplicate labels allowed + nudge** — real guest lists have duplicate salutations; private notes disambiguate instead of forcing unique names.
9. **Quick-add optimized for Enter-repeat** — hosts paste from a mental list of dozens; session counter gives progress feedback.

## 8. Assets inventory (`assets/`)

Fonts: `DFVN-KaelynaScript.otf`, `PlayfairDisplay-VariableFont_wght.ttf` + italic.
Photos: `hero.jpg`, `together.jpg`, `g01`–`g12.jpg` (gallery), `flap.jpg`.
Decor: `lace.png`, `lace-h.png`, `lace-v.png`, `stamp.png`, `wish-paper.png`, `rings.png`, `map.png`, `icon-camera.png`, `icon-toast.png`, `speaker.png`, `logo-mark.svg`, `double-happiness.svg`, `arch-inner.svg`, `arch-outer.svg` (currently unused).
Audio: `assets/music.mp3` expected but **not yet provided** — the player degrades gracefully (HEAD check) if absent.

⚠️ Verify licensing for DFVN Kaelyna Script and the chosen music track before public deploy. Gallery/hero photos are placeholders until the real Đà Lạt shoot is delivered — keep the same aspect ratios.

## 9. Open items
- Music track: uploadable via Site settings (§3.5); obtain a licensed track.
- Map stays a static image + Google Maps deep-link (both admin-configurable) — intentional, keep.
- Anonymous RSVP behavior (see §2.6) — recommend hiding RSVP buttons when no valid guest slug.
- Prototype "Đặt lại dữ liệu" and seeded demo data must not ship.
- Desktop scale factor (1.25 suggested) — confirm visually before locking.
