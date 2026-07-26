export type IdentityProfile = { name: string; rsvp: 'yes' | 'no' | null };

export type IdentityResult = {
  identityId?: string;
  token?: string;
  isAdmin?: boolean;
  matchConfidence?: 'token' | 'fingerprint' | 'new';
  profile?: IdentityProfile | null;
};

export type IdentitySource = 'shared' | 'personalized';

const TOKEN_KEY = 'wedding_gid_v1';

export function storedToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

function saveToken(token: string) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // The HttpOnly first-party cookie remains the primary fallback.
  }
}

function signals() {
  return {
    userAgent: navigator.userAgent,
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
    devicePixelRatio: String(window.devicePixelRatio || 1),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? '',
    language: navigator.language,
    platform: navigator.platform,
    touchPoints: navigator.maxTouchPoints ?? 0,
  };
}

export async function resolveIdentity(input: {
  eventSlug: string;
  source: IdentitySource;
  guestId?: string;
}): Promise<IdentityResult> {
  const res = await fetch('/api/identity/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: storedToken(),
      host: location.hostname,
      eventSlug: input.eventSlug,
      guestId: input.guestId ?? '',
      source: input.source,
      consent: true,
      signals: signals(),
    }),
  });
  if (!res.ok) throw new Error(`identity ${res.status}`);
  const result = (await res.json()) as IdentityResult;
  if (result.token) saveToken(result.token);
  return result;
}

export async function saveSharedRSVP(input: {
  eventSlug: string;
  name: string;
  /** null = chỉ lưu tên, server giữ nguyên lựa chọn RSVP đã có. */
  rsvp: 'yes' | 'no' | null;
}) {
  const res = await fetch('/api/identity/shared-rsvp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: storedToken(),
      host: location.hostname,
      eventSlug: input.eventSlug,
      name: input.name,
      rsvp: input.rsvp ?? '',
    }),
  });
  if (!res.ok) throw new Error(`shared RSVP ${res.status}`);
}

export async function claimCurrentIdentity(token: string) {
  const res = await fetch(`/api/identity/claim/${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identityToken: storedToken(), host: location.hostname }),
  });
  if (!res.ok) throw new Error(`identity claim ${res.status}`);
}
