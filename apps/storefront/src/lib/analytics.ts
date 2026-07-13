// Thin client-side wrapper over Umami's global tracker (spec §08/§10 events, ADR-015). The Umami script is
// injected ONLY after the visitor grants analytics consent (components/consent-banner.tsx), so `window.umami`
// is undefined until then — this call is therefore consent-gated for FREE: no consent → no global → nothing
// fires (PDPL). It is also a no-op on the server (no window). Safe to call from any client component.

type UmamiEventProps = Record<string, string | number | boolean>;

declare global {
  interface Window {
    umami?: { track: (event: string, data?: UmamiEventProps) => void };
  }
}

export function track(event: string, props?: UmamiEventProps): void {
  if (typeof window === 'undefined') return;
  window.umami?.track(event, props);
}
