import type { BadgeTone } from '@lumin/ui';

// PLACEHOLDER catalog data for the Phase-0 shell — these become Core API products in Phase 1.
// `name` is product DATA (not translatable UI chrome), so it lives here rather than in the i18n
// catalog. Prices are int VND (conventions §Tiền) — formatted by PriceTag via @lumin/core, never
// baked into a string. `badgeKey` indexes a message in `badge.*`.
export interface DemoProduct {
  id: string;
  name: string;
  price: number;
  compareAt?: number;
  rating: number;
  reviewCount: number;
  badge?: { key: 'featured' | 'new' | 'lowStock'; tone: BadgeTone };
}

export const demoProducts: DemoProduct[] = [
  {
    id: 'mochi',
    name: 'Đèn ngủ Mochi',
    price: 290000,
    compareAt: 350000,
    rating: 4.8,
    reviewCount: 128,
    badge: { key: 'featured', tone: 'primary' },
  },
  {
    id: 'robo',
    name: 'Móc khoá Robo',
    price: 65000,
    rating: 4.6,
    reviewCount: 54,
    badge: { key: 'new', tone: 'teal' },
  },
  {
    id: 'origami',
    name: 'Kệ điện thoại Origami',
    price: 120000,
    rating: 4.7,
    reviewCount: 39,
  },
  {
    id: 'astronaut',
    name: 'Mô hình Phi hành gia',
    price: 210000,
    rating: 4.9,
    reviewCount: 72,
    badge: { key: 'lowStock', tone: 'sun' },
  },
];
