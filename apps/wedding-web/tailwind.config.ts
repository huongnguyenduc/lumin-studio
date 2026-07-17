import type { Config } from 'tailwindcss';

// Wedding design system (HANDOFF §7) — a standalone palette, deliberately NOT the
// @lumin/tokens preset: the invitation is its own visual world (cream/tan/terracotta).
// Hairline "borders" are box-shadow rings (`shadow-ring`), not CSS borders — sub-pixel
// crisp, preserve this technique.
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: 'rgb(120,105,93)', // primary text, buttons, RSVP block bg
        'brown-dark': 'rgb(101,88,77)', // button hover
        tan: 'rgb(176,157,144)', // hairlines, secondary text
        'tan-light': 'rgb(186,170,159)', // muted text, placeholders
        cream: 'rgb(255,251,248)', // card/page surface
        'cream-2': 'rgb(249,241,232)', // alt surface, hover fills
        terracotta: 'rgb(203,77,28)', // guest name, signatures, accents
        'page-invite': 'rgb(236,229,222)', // outside the card (invitation)
        'page-admin': 'rgb(245,241,236)', // outside the card (admin)
        dark: 'rgb(59,47,39)', // hero gradient
        'status-yes': 'oklch(0.52 0.09 155)',
        'status-no': 'oklch(0.52 0.09 30)',
      },
      fontFamily: {
        // Self-hosted fonts land with the invitation-page slice (step 4); the CSS
        // variables are set by next/font in layout.tsx.
        script: ['var(--font-script)', 'Great Vibes', 'cursive'],
        serif: ['var(--font-serif)', 'Playfair Display', 'Georgia', 'serif'],
      },
      borderRadius: {
        pill: '25px',
      },
      boxShadow: {
        ring: '0 0 0 0.5px rgb(176,157,144)', // the signature 0.5px tan hairline ring
      },
    },
  },
  plugins: [],
};

export default config;
