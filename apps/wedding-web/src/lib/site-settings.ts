// Typed view over the settings JSONB for the invitation page (HANDOFF §3.5).
// mapUrl/mapsUrl live on EventData instead — venue is per-event.
export type SiteSettings = {
  heroUrl?: string;
  gallery?: string[];
  musicUrl?: string;
  siteTitle?: string;
  siteDesc?: string;
  ogUrl?: string;
  iconUrl?: string;
};

// Venue/timeline/ceremony fields for one event (fixed shape — Letter renders
// exactly one venue block + 2 timeline stops, Events renders exactly 2
// ceremony tickets). Empty/missing fields fall back to the vi.ts copy.
export type EventData = {
  date?: string;
  weekday?: string;
  lunarDate?: string;
  time?: string;
  venueName?: string;
  venueHall?: string;
  venueAddress?: string;
  mapUrl?: string;
  mapsUrl?: string;
  timelineWelcomeTime?: string;
  timelineWelcome?: string;
  timelinePartyTime?: string;
  timelineParty?: string;
  vuQuyTime?: string;
  vuQuyPlace?: string;
  vuQuyAddress?: string;
  thanhHonTime?: string;
  thanhHonPlace?: string;
  thanhHonAddress?: string;
  ceremonyDate?: string;
  ceremonyLunarDate?: string;
};

const eventDataKeys: (keyof EventData)[] = [
  'date',
  'weekday',
  'lunarDate',
  'time',
  'venueName',
  'venueHall',
  'venueAddress',
  'mapUrl',
  'mapsUrl',
  'timelineWelcomeTime',
  'timelineWelcome',
  'timelinePartyTime',
  'timelineParty',
  'vuQuyTime',
  'vuQuyPlace',
  'vuQuyAddress',
  'thanhHonTime',
  'thanhHonPlace',
  'thanhHonAddress',
  'ceremonyDate',
  'ceremonyLunarDate',
];

export function asEventData(raw: Record<string, unknown>): EventData {
  const out: EventData = {};
  for (const k of eventDataKeys) {
    const v = raw[k];
    if (typeof v === 'string' && v !== '') out[k] = v;
  }
  return out;
}

export function asSiteSettings(raw: Record<string, unknown>): SiteSettings {
  const s = (k: string) =>
    typeof raw[k] === 'string' && raw[k] !== '' ? (raw[k] as string) : undefined;
  const gallery = Array.isArray(raw.gallery)
    ? (raw.gallery as unknown[]).filter((x): x is string => typeof x === 'string')
    : undefined;
  return {
    heroUrl: s('heroUrl'),
    gallery: gallery && gallery.length ? gallery : undefined,
    musicUrl: s('musicUrl'),
    siteTitle: s('siteTitle'),
    siteDesc: s('siteDesc'),
    ogUrl: s('ogUrl'),
    iconUrl: s('iconUrl'),
  };
}
