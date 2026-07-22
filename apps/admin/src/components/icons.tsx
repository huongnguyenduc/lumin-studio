import type { ReactNode, SVGProps } from 'react';
import { cn } from '@lumin/ui';

// Inline single-colour line icons (design-system.md §Iconography): currentColor, ~2px stroke, round
// caps/joins. Decorative only — every icon sits next to a real text/aria label, so they are
// aria-hidden and never the accessible name.
function Svg({ className, children, ...props }: SVGProps<SVGSVGElement> & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={cn('h-[1.25em] w-[1.25em]', className)}
      {...props}
    >
      {children}
    </svg>
  );
}

type IconProps = SVGProps<SVGSVGElement>;

export function GaugeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 13a4 4 0 0 1 7-2.6" />
      <path d="m12 13 4-3" />
      <path d="M3 12a9 9 0 1 1 18 0" />
    </Svg>
  );
}

// Six-dot drag handle (design ⠿) — the affordance to reorder a list row. Decorative; the handle button
// carries the real aria-label.
export function GripIcon(props: IconProps) {
  return (
    <Svg fill="currentColor" stroke="none" {...props}>
      <circle cx="9" cy="6" r="1.4" />
      <circle cx="15" cy="6" r="1.4" />
      <circle cx="9" cy="12" r="1.4" />
      <circle cx="15" cy="12" r="1.4" />
      <circle cx="9" cy="18" r="1.4" />
      <circle cx="15" cy="18" r="1.4" />
    </Svg>
  );
}

export function OrdersIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
      <path d="M3 6h18" />
      <path d="M16 10a4 4 0 0 1-8 0" />
    </Svg>
  );
}

// Icons shared with other apps live in @lumin/ui — re-exported here so call sites keep one import.
export { PrinterIcon, GridIcon, ArrowRightIcon } from '@lumin/ui';

export function BoxIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m21 8-9-5-9 5v8l9 5 9-5Z" />
      <path d="m3 8 9 5 9-5" />
      <path d="M12 13v8" />
    </Svg>
  );
}

export function StarIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m12 3 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.2l5.9-.9Z" />
    </Svg>
  );
}

export function CoilIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 3v3" />
      <path d="m18.4 6.5-2 2" />
    </Svg>
  );
}

export function UsersIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.9" />
      <path d="M16 3.1a4 4 0 0 1 0 7.8" />
    </Svg>
  );
}

export function SettingsIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2 2 2 0 1 1-4 0 1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9 2 2 0 1 1 0-4 1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5 2 2 0 1 1 4 0 1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1 2 2 0 1 1 0 4 1.7 1.7 0 0 0-1.5 1Z" />
    </Svg>
  );
}

export function TagIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82Z" />
      <path d="M7 7h.01" />
    </Svg>
  );
}

export function GlobeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z" />
    </Svg>
  );
}

// Two overlapping rings — weddings/couples.
export function RingsIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="9" cy="14" r="6" />
      <circle cx="15" cy="14" r="6" />
      <path d="M9 4.5 7.5 7h3L9 4.5Z" />
      <path d="M15 4.5 13.5 7h3L15 4.5Z" />
    </Svg>
  );
}
