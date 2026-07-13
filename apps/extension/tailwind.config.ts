import type { Config } from 'tailwindcss';
import { luminPreset } from '@lumin/tokens';

// Same design-system preset as the web apps, so `bg-primary`, `rounded-pill`, `shadow-pop`, … resolve
// identically. `content` MUST scan the @lumin/ui source or its primitives' utility classes get
// tree-shaken (silent no-op). ponytail: fonts fall back to the preset's family strings (system-ui if
// the brand fonts aren't installed) — no next/font here; bundle woff2 for pixel-fidelity in a later polish.
const config: Config = {
  presets: [luminPreset as unknown as NonNullable<Config['presets']>[number]],
  content: ['./index.html', './src/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
};

export default config;
