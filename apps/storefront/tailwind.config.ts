import type { Config } from 'tailwindcss';
import { luminPreset } from '@lumin/tokens';

// The design-system tokens (colors / spacing / radius / shadow / fontSize) come from the shared
// @lumin/tokens preset — the SAME source the primitives in @lumin/ui were authored against, so
// `bg-primary`, `shadow-pop`, `rounded-pill`, … resolve identically here. `content` MUST scan the
// @lumin/ui source or the primitives' utility classes get tree-shaken away (silent no-op).
const config: Config = {
  presets: [luminPreset as unknown as NonNullable<Config['presets']>[number]],
  content: ['./src/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
  theme: {
    // Map the design-system font roles to the self-hosted next/font CSS variables (REPLACE, not
    // extend, so these win over the preset's literal family strings). The vars are set on <html> by
    // next/font in layout.tsx. Hanken Grotesque is the canonical body font (Next 15 font manifest).
    fontFamily: {
      display: [
        'var(--font-bricolage)',
        'Bricolage Grotesque',
        'Arial Black',
        'system-ui',
        'sans-serif',
      ],
      body: ['var(--font-hanken)', 'Hanken Grotesk', 'system-ui', '-apple-system', 'sans-serif'],
      mono: ['var(--font-space-mono)', 'Space Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      sans: ['var(--font-hanken)', 'system-ui', 'sans-serif'],
    },
  },
  plugins: [],
};

export default config;
