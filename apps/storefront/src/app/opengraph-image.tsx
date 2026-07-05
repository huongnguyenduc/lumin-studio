import { ImageResponse } from 'next/og';
import { BRAND } from '@/lib/product-jsonld';
import { vi } from '@/messages/vi';

// Site-wide default Open Graph card (plan §3 P1-q / storefront rule §SEO: OG card render server-side,
// 1200×630, tag in the first HTML). Next injects the resulting <meta og:image> into every page that does
// NOT set its own — the product detail overrides it with the real product photo (openGraph.images), so
// this branded card is the home / catalog / photo-less-product fallback. Generated from the design tokens
// (tokens/colors.css), so no committed binary or design tooling is needed.

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
// alt reuses the existing meta title from the i18n catalog (an HTML attribute, natively rendered — not
// drawn by satori, so its diacritics are safe). No hard-coded copy, no new key.
export const alt = vi.meta.title;

// The drawn text is DELIBERATELY the ASCII brand wordmark only — satori's built-in font tofus Vietnamese
// diacritics (đ/ơ/ư/ế) and there is no committed font binary to pass via `fonts`. The Vietnamese tagline
// rides in og:description (layout metadata), which the social platform renders natively with a real font.
// A richer card (tagline/price drawn in) is a follow-up once a Vietnamese .ttf is bundled.
export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '96px',
        backgroundColor: '#FFFBEF', // cream-50
      }}
    >
      {/* flame accent dot */}
      <div
        style={{
          width: '32px',
          height: '32px',
          marginBottom: '32px',
          borderRadius: '9999px',
          backgroundColor: '#FF6B4A', // flame-500
        }}
      />

      {/* brand wordmark (ASCII — always renders) */}
      <div style={{ display: 'flex', fontSize: '140px', fontWeight: 800, color: '#492F10' }}>
        {BRAND}
      </div>

      {/* flame accent rule */}
      <div
        style={{
          display: 'flex',
          width: '240px',
          height: '12px',
          marginTop: '44px',
          borderRadius: '9999px',
          backgroundColor: '#C93A1A', // flame-700
        }}
      />
    </div>,
    { ...size },
  );
}
