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
        'accent-flame-soft': color.accentFlameSoft,
        'accent-teal-soft': color.accentTealSoft,
        'accent-sky-soft': color.accentSkySoft,
        'accent-sun-soft': color.accentSunSoft,
        'accent-sky-strong': color.accentSkyStrong,
        danger: color.danger,
        'danger-soft': color.dangerSoft,
        'on-danger': color.onDanger,
        'text-strong': color.textStrong,
        'text-body': color.textBody,
        'text-muted': color.textMuted,
        'text-subtle': color.textSubtle,
        'text-link': color.textLink,
        // foreground-on-X family (use as `text-on-dark`): cream text on cocoa/dark surfaces, mirrors
        // `on-primary`/`on-danger`. Named `on-dark` (not `text-on-dark`) so the class is `text-on-dark`.
        'on-dark': color.textOnDark,
        'surface-page': color.surfacePage,
        'surface-card': color.surfaceCard,
        'surface-cream': color.surfaceCream,
        'surface-sunken': color.surfaceSunken,
        'surface-brand': color.surfaceBrand,
        'border-subtle': color.borderSubtle,
        'border-default': color.borderDefault,
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
