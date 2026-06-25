// Tailwind-config-shaped preset built from the typed theme. Apps will do
// `presets: [luminPreset]` (cast to Tailwind's Config['presets'][number]). Kept dependency-free
// (no tailwindcss import) so the tokens package stays light until an app consumes it.
import { color, fontFamily, fontSize, radius, shadow, space } from './theme';

export const luminPreset = {
  theme: {
    extend: {
      colors: {
        primary: color.primary,
        'primary-hover': color.primaryHover,
        'primary-press': color.primaryPress,
        'on-primary': color.onPrimary,
        'accent-flame': color.accentFlame,
        'accent-teal': color.accentTeal,
        'accent-sky': color.accentSky,
        'accent-sun': color.accentSun,
        'text-strong': color.textStrong,
        'text-body': color.textBody,
        'text-muted': color.textMuted,
        'text-link': color.textLink,
        'surface-page': color.surfacePage,
        'surface-card': color.surfaceCard,
        'surface-cream': color.surfaceCream,
        'surface-brand': color.surfaceBrand,
        'border-subtle': color.borderSubtle,
        'border-strong': color.borderStrong,
      },
      spacing: space,
      borderRadius: radius,
      boxShadow: shadow,
      fontFamily: {
        display: fontFamily.display,
        body: fontFamily.body,
        mono: fontFamily.mono,
      },
      fontSize,
    },
  },
} as const;

export type LuminPreset = typeof luminPreset;
