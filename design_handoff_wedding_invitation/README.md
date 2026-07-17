# Handoff: Wedding Invitation Website ("Giang & Hiếu")

**Read `HANDOFF.md` in this folder first** — it is the full functional + UI/UX spec (guest flow, admin flow, data model, API surface, design tokens, design decisions, deployment plan). This README covers how to implement it inside the **lumin-studio** monorepo/cluster with Claude Code.

## About the design files
The `.dc.html` files here are **HTML design references** (working prototypes), not production code. Recreate them in the target stack — **Next.js frontend + Go backend** — using lumin-studio's existing patterns. They are **high-fidelity**: recreate pixel-perfectly (colors, type, spacing, hairline box-shadow rings, clip-path tickets, animations are all final).

- `Wedding Invitation.dc.html` — guest-facing invitation (393px card; see HANDOFF §2)
- `Admin.dc.html` — admin dashboard incl. Site Settings + bulk delete (HANDOFF §3)
- `Wishes Section Options.dc.html` — wishes wall explorations; **option 1a "letters" is final**
- `guest-db.js` — prototype data layer; its function surface maps 1:1 to the API in HANDOFF §5
- `assets/` — fonts, photos (placeholders until real shoot), decor PNGs/SVGs
- `support.js` — prototype runtime only; ignore

## How the prototypes work (for reference-reading)
Each `.dc.html` contains an `<x-dc>` template (markup, inline styles — every color/size/spacing value is authoritative) and a `class Component` script (all behavior: filtering, sorting, RSVP logic, reveal animations, music autoplay strategy). Open them in a browser to interact; read the source to extract exact values.

## Implementation plan on lumin-studio (Claude Code)

Suggested order of work, one PR each:

1. **Scaffold** — new apps in the repo: `apps/wedding-web` (Next.js App Router) + `apps/wedding-api` (Go, same framework/layout as the existing lumin-studio API service). Reuse existing lint/build/CI conventions.
2. **DB** — new Postgres database `wedding` on the existing cluster instance; migrations from HANDOFF §4 (guests, wishes, groups, settings JSONB). Slug generation: label → lowercase, strip diacritics, kebab-case; collision → `-2`, `-3` suffix; immutable after creation.
3. **API** — endpoints from HANDOFF §5, incl. bulk-delete, settings, and presigned uploads to the existing **Garage (S3)** — new bucket `wedding-assets`, scoped key, reuse lumin-studio's upload/presign pattern.
4. **Invitation page** — SSR per guest slug (`/i/<slug>`), sections per HANDOFF §2 in order; fixed 393px composition, desktop breakpoint scales the card as a unit (~1.25 at ≥1024px, never reflow). Fonts self-hosted; music autoplay-on-gesture per §2.10; scroll reveal per §2.11 with `prefers-reduced-motion`.
5. **Admin** — route group `/admin` behind Cloudflare Access (or shared-password JWT); table with filters/sort/pagination/bulk-select, quick add, groups, wishes moderation, Site Settings panel, Excel export.
6. **Deploy** — k3s manifests alongside lumin-studio (same Ingress/Cloudflare Tunnel), subdomain host + generic host list for future custom domain; site meta (title/desc/OG/icon) from settings rendered via Next metadata.

## Suggested Claude Code kickoff prompt

> Read design_handoff_wedding_invitation/HANDOFF.md and README.md. Explore this repo's existing service structure, API patterns, Garage S3 usage, and k3s manifests first. Then implement step 1 (scaffold) as described, matching existing conventions. Ask before deviating from the spec.

Work section-by-section against HANDOFF.md; keep the prototype open side-by-side and diff visually.

## Assets & licensing
Fonts: DFVN Kaelyna Script (verify license), Playfair Display (OFL). Photos are placeholders — keep aspect ratios. `music.mp3` not included; admin-uploadable. All host-configurable media lives in Garage; built-in decor (lace, stamp, rings, logo) ships in Next `public/`.
