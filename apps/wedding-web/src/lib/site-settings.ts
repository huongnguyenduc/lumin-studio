// Typed view over the settings JSONB for the invitation page (HANDOFF §3.5).
export type SiteSettings = {
  heroUrl?: string;
  mapUrl?: string;
  mapsUrl?: string;
  gallery?: string[];
  musicUrl?: string;
  siteTitle?: string;
  siteDesc?: string;
  ogUrl?: string;
  iconUrl?: string;
};

export function asSiteSettings(raw: Record<string, unknown>): SiteSettings {
  const s = (k: string) =>
    typeof raw[k] === 'string' && raw[k] !== '' ? (raw[k] as string) : undefined;
  const gallery = Array.isArray(raw.gallery)
    ? (raw.gallery as unknown[]).filter((x): x is string => typeof x === 'string')
    : undefined;
  return {
    heroUrl: s('heroUrl'),
    mapUrl: s('mapUrl'),
    mapsUrl: s('mapsUrl'),
    gallery: gallery && gallery.length ? gallery : undefined,
    musicUrl: s('musicUrl'),
    siteTitle: s('siteTitle'),
    siteDesc: s('siteDesc'),
    ogUrl: s('ogUrl'),
    iconUrl: s('iconUrl'),
  };
}
