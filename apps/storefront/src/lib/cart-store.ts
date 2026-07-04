'use client';

import { useSyncExternalStore } from 'react';
import {
  addItem,
  cartCount,
  removeItem,
  sanitizeCart,
  setItemQuantity,
  type CartItem,
} from './cart';

// A tiny localStorage-backed external store for the cart, read via useSyncExternalStore so every
// mounting component (the cart page, the add-to-cart button) sees ONE source of truth and stays in
// sync — including across browser tabs (the `storage` event). All the actual cart logic lives in the
// pure reducers (lib/cart.ts); this module is only the persistence + subscription shell around them.
//
// Persistence is the P1-k "persist reload" requirement. It is client-only (localStorage) — there is no
// server-side cart in Phase 1 (no order until Phase-2 checkout), so getServerSnapshot returns empty and
// the page hydrates from localStorage on the client.

const STORAGE_KEY = 'lumin:cart:v1';
/** Stable empty reference so getSnapshot/getServerSnapshot never hand React a fresh [] (which would
 *  look like a change every render and loop). */
const EMPTY: CartItem[] = [];

// Cache the parsed value keyed by the raw string: getSnapshot MUST return a referentially-stable value
// while the underlying string is unchanged, or useSyncExternalStore re-renders forever.
let cache: { raw: string | null; parsed: CartItem[] } = { raw: null, parsed: EMPTY };
const listeners = new Set<() => void>();

function read(): CartItem[] {
  if (typeof window === 'undefined') return EMPTY;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === cache.raw) return cache.parsed;
  let parsed: CartItem[];
  try {
    parsed = raw ? sanitizeCart(JSON.parse(raw)) : EMPTY;
  } catch {
    // Corrupt JSON in localStorage must never crash the cart — treat it as empty.
    parsed = EMPTY;
  }
  cache = { raw, parsed };
  return parsed;
}

function write(next: CartItem[]): void {
  if (typeof window === 'undefined') return;
  const raw = JSON.stringify(next);
  window.localStorage.setItem(STORAGE_KEY, raw);
  // Seed the cache with the value we just wrote so the immediate getSnapshot returns THIS array
  // (same reference), then notify subscribers in this tab (the `storage` event only fires in OTHERS).
  cache = { raw, parsed: next };
  for (const l of listeners) l();
}

function onStorage(event: StorageEvent): void {
  // Another tab mutated (or cleared) the cart. Invalidate the cache so the next read re-parses, then
  // wake subscribers. `key === null` is a localStorage.clear().
  if (event.key !== STORAGE_KEY && event.key !== null) return;
  cache = { raw: null, parsed: EMPTY };
  for (const l of listeners) l();
}

// Attach the cross-tab listener once at module load (this is a 'use client' module; on the client it
// evaluates in the browser where window exists — the guard covers the SSR pass).
if (typeof window !== 'undefined') {
  window.addEventListener('storage', onStorage);
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): CartItem[] {
  return read();
}

function getServerSnapshot(): CartItem[] {
  return EMPTY;
}

export type UseCart = {
  items: CartItem[];
  count: number;
  add: (item: CartItem) => void;
  setQuantity: (key: string, qty: number) => void;
  remove: (key: string) => void;
};

/**
 * Subscribe to the cart. `items` is the live, sanitised cart; the mutators write through the pure
 * reducers and persist. Reading the current items inside each mutator (read()) rather than closing over
 * `items` keeps concurrent writes correct (two rapid taps compose on the latest persisted state).
 */
export function useCart(): UseCart {
  const items = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return {
    items,
    count: cartCount(items),
    add: (item) => write(addItem(read(), item)),
    setQuantity: (key, qty) => write(setItemQuantity(read(), key, qty)),
    remove: (key) => write(removeItem(read(), key)),
  };
}
