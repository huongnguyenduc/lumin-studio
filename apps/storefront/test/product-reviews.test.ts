import { describe, it, expect } from 'vitest';
import { parseReviewsPage, toReviewView } from '../src/lib/product-view';
import type { components } from '@lumin/api-client';

type ApiReview = components['schemas']['Review'];

/** A fully-populated API review; individual tests override single fields. */
function apiReview(overrides: Partial<ApiReview> = {}): ApiReview {
  return {
    id: 'r1111111-1111-1111-1111-111111111111',
    rating: 5,
    body: 'Khắc tên đẹp, màu lên y hình.',
    images: ['https://cdn.example/rev-1.webp'],
    reply: null,
    createdAt: '2026-06-25T02:00:00.000Z',
    ...overrides,
  };
}

describe('toReviewView', () => {
  it('projects the API review onto the view (identity is never carried — no author field)', () => {
    expect(toReviewView(apiReview())).toEqual({
      id: 'r1111111-1111-1111-1111-111111111111',
      rating: 5,
      body: 'Khắc tên đẹp, màu lên y hình.',
      images: ['https://cdn.example/rev-1.webp'],
      reply: null,
      createdAt: '2026-06-25T02:00:00.000Z',
    });
  });

  it('keeps an empty body (a star-only review) as "", never dropped', () => {
    expect(toReviewView(apiReview({ body: '' })).body).toBe('');
  });

  it('drops empty-string image URLs and de-duplicates (broken/doubled photo never reaches <img>)', () => {
    expect(
      toReviewView(apiReview({ images: ['', 'a.webp', 'a.webp', '', 'b.webp'] })).images,
    ).toEqual(['a.webp', 'b.webp']);
    expect(toReviewView(apiReview({ images: [] })).images).toEqual([]);
  });

  it('passes a present shop reply through (body + at only)', () => {
    const reply = { body: 'Cảm ơn bạn nhiều nhé!', at: '2026-06-26T03:00:00.000Z' };
    expect(toReviewView(apiReview({ reply })).reply).toEqual(reply);
  });

  it('collapses a null OR absent reply to null (unambiguous for the `reply != null` guard)', () => {
    expect(toReviewView(apiReview({ reply: null })).reply).toBeNull();
    // The wire may omit `reply` entirely (optional field) — that must also become null, not undefined.
    const withoutReply = apiReview();
    delete (withoutReply as { reply?: unknown }).reply;
    expect(toReviewView(withoutReply).reply).toBeNull();
  });

  it('passes the rating through unchanged (no clamping here — the wire is 1–5)', () => {
    expect(toReviewView(apiReview({ rating: 3 })).rating).toBe(3);
  });
});

describe('parseReviewsPage', () => {
  it('accepts a valid 1-based page', () => {
    expect(parseReviewsPage('3')).toBe(3);
    expect(parseReviewsPage('1')).toBe(1);
  });

  it('collapses non-positive / non-numeric / missing values to 1 (never a page the endpoint 400s on)', () => {
    expect(parseReviewsPage('0')).toBe(1);
    expect(parseReviewsPage('-2')).toBe(1);
    expect(parseReviewsPage('abc')).toBe(1);
    expect(parseReviewsPage('')).toBe(1);
    expect(parseReviewsPage(undefined)).toBe(1);
  });

  it('takes the first value of a repeated param (single browser field semantics)', () => {
    expect(parseReviewsPage(['2', '9'])).toBe(2);
    expect(parseReviewsPage([])).toBe(1);
  });

  it('truncates a fractional string via parseInt (e.g. "2.5" → 2), matching parseCatalogParams', () => {
    expect(parseReviewsPage('2.5')).toBe(2);
  });
});
