// Typed view over the settings JSONB for the invitation page (HANDOFF §3.5).
// mapUrl/mapsUrl live on EventData instead — venue is per-event.
// Biến thể ảnh đã tối ưu (ADR-055). Điền ở SERVER bởi `optimizeSettings`/`optimizeEvent`
// trong `lib/img.ts`; luôn optional vì khi imgproxy chưa bootstrap thì fail-open về URL gốc.
export type ImgVariants = { src: string; srcSet: string };
export type GalleryImage = {
  url: string;
  x?: number;
  y?: number;
  /** Khổ nhỏ cho ô lưới. */
  thumb?: ImgVariants;
  /** Khổ lớn cho lightbox. */
  full?: ImgVariants;
};
export type SiteSettings = {
  heroUrl?: string;
  heroX?: number;
  heroY?: number;
  hero?: ImgVariants;
  gallery?: GalleryImage[];
  musicUrl?: string;
  musicVolume?: number;
  siteTitle?: string;
  siteDesc?: string;
  ogUrl?: string;
  iconUrl?: string;
  storyLine1?: string;
  storyLine2?: string;
  storyCaption1?: string;
  storyCaption2?: string;
  storyCaption3?: string;
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

/**
 * Biến thể của ảnh bản đồ. CỐ Ý để ngoài `EventData`: mọi field của EventData đều là
 * string và `letter.tsx` render chúng thẳng qua helper `v()` — nhét object vào đó là
 * `EventData[keyof EventData]` hết còn gán được vào ReactNode.
 */
export type EventImages = { map?: ImgVariants; mapFull?: ImgVariants };

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
    ? (raw.gallery as unknown[])
        .map((item): GalleryImage | undefined => {
          if (typeof item === 'string') return { url: item };
          if (
            item &&
            typeof item === 'object' &&
            typeof (item as { url?: unknown }).url === 'string'
          ) {
            const { url, x, y } = item as { url: string; x?: unknown; y?: unknown };
            return {
              url,
              x: typeof x === 'number' ? x : undefined,
              y: typeof y === 'number' ? y : undefined,
            };
          }
          return undefined;
        })
        .filter((x): x is GalleryImage => x !== undefined)
    : undefined;
  const n = (k: string) => (typeof raw[k] === 'number' ? (raw[k] as number) : undefined);
  return {
    heroUrl: s('heroUrl'),
    heroX: n('heroX'),
    heroY: n('heroY'),
    gallery: gallery && gallery.length ? gallery : undefined,
    musicUrl: s('musicUrl'),
    musicVolume: n('musicVolume'),
    siteTitle: s('siteTitle'),
    siteDesc: s('siteDesc'),
    ogUrl: s('ogUrl'),
    iconUrl: s('iconUrl'),
    storyLine1: s('storyLine1'),
    storyLine2: s('storyLine2'),
    storyCaption1: s('storyCaption1'),
    storyCaption2: s('storyCaption2'),
    storyCaption3: s('storyCaption3'),
  };
}
