import { vi, type MessageKey } from './vi';

// t(key, vars?) — flat-catalog lookup with {placeholder} interpolation. vi-only (default locale); a
// missing key returns the key itself (visible in dev, never a crash). No ICU/plurals yet — add when a
// string actually needs them (YAGNI). Keeps UI copy out of components (conventions §i18n).
export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  const raw: string = vi[key] ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (_match, name: string) =>
    name in vars ? String(vars[name]) : `{${name}}`,
  );
}

export type { MessageKey };
