import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProductCard } from '../src/ProductCard';

// HOUSE-STYLE REFERENCE for @lumin/ui tests: assert role/accessible-name, composed-leaf output,
// behaviour (onClick / toggle), className override (tailwind-merge), and ref forwarding. ProductCard
// COMPOSES leaves, so we assert their visible/accessible result (PriceTag's formatted VND, the add
// Button's label, the fav IconButton reachable by its aria-label) — never computed pixels.
const base = {
  title: 'Đèn gốm nhỏ',
  price: 390000,
  favLabel: 'Yêu thích',
  addLabel: 'Thêm vào giỏ',
} as const;

describe('ProductCard', () => {
  it('renders the title and the price formatted via PriceTag (@lumin/core VND)', () => {
    render(<ProductCard {...base} />);
    expect(screen.getByText('Đèn gốm nhỏ')).toBeInTheDocument();
    expect(screen.getByText('390.000₫')).toBeInTheDocument();
  });

  it('shows the add-to-cart Button with addLabel and fires onAdd when clicked', async () => {
    const onAdd = vi.fn();
    render(<ProductCard {...base} onAdd={onAdd} />);
    const add = screen.getByRole('button', { name: 'Thêm vào giỏ' });
    await userEvent.click(add);
    expect(onAdd).toHaveBeenCalledOnce();
  });

  it('exposes the fav IconButton by favLabel, reflects faved, and fires onToggleFav', async () => {
    const onToggleFav = vi.fn();
    render(<ProductCard {...base} faved onToggleFav={onToggleFav} />);
    const fav = screen.getByRole('button', { name: 'Yêu thích' });
    expect(fav).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(fav);
    expect(onToggleFav).toHaveBeenCalledOnce();
  });

  it('renders the badge label only when a badge is provided', () => {
    const { rerender } = render(<ProductCard {...base} />);
    expect(screen.queryByText('Mới')).not.toBeInTheDocument();
    rerender(<ProductCard {...base} badge={{ label: 'Mới', tone: 'teal' }} />);
    expect(screen.getByText('Mới')).toBeInTheDocument();
  });

  it('renders the Rating with its group label only when a rating is provided', () => {
    const { rerender } = render(<ProductCard {...base} />);
    expect(screen.queryByRole('img', { name: 'đánh giá' })).not.toBeInTheDocument();
    rerender(<ProductCard {...base} rating={4.5} reviewCount={1234} ratingLabel="đánh giá" />);
    expect(screen.getByRole('img', { name: 'đánh giá' })).toBeInTheDocument();
    // Review count is grouped by @lumin/core (no Intl in @lumin/ui).
    expect(screen.getByText('(1.234)')).toBeInTheDocument();
  });

  it('struck compare-at price renders through PriceTag when higher than price', () => {
    render(<ProductCard {...base} compareAt={520000} />);
    expect(screen.getByText('520.000₫')).toBeInTheDocument();
  });

  it('lets a caller className override merge onto the Card root (tailwind-merge)', () => {
    const { container } = render(<ProductCard {...base} className="p-8" />);
    const root = container.firstElementChild!;
    expect(root).toHaveClass('p-8');
    expect(root).not.toHaveClass('p-3');
    // Still the signature pop Card surface.
    expect(root).toHaveClass('shadow-pop');
  });

  it('forwards its ref to the Card root element', () => {
    const ref = { current: null as HTMLDivElement | null };
    render(<ProductCard {...base} ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });
});
