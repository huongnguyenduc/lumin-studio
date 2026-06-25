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
    // Map the design-system font roles to the self-hosted Fontsource family names (REPLACE, not
    // extend, so these win over the preset's literal family strings). Plus Jakarta Sans stands in
    // for Hanken Grotesque (not shipped by Next/Fontsource) — design-system.md marks it swappable.
    fontFamily: {
      display: [
        '"Bricolage Grotesque Variable"',
        'Bricolage Grotesque',
        'Arial Black',
        'system-ui',
        'sans-serif',
      ],
      body: [
        '"Plus Jakarta Sans Variable"',
        'Plus Jakarta Sans',
        'system-ui',
        '-apple-system',
        'sans-serif',
      ],
      mono: ['"Space Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      sans: ['"Plus Jakarta Sans Variable"', 'system-ui', 'sans-serif'],
    },
  },
  plugins: [],
};

export default config;
