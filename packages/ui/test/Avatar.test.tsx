import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Avatar } from '../src/Avatar';

// HOUSE-STYLE REFERENCE for @lumin/ui tests: assert role/accessible-name, variant→class mapping,
// the primary behaviour (src → img vs initials fallback), className override (tailwind-merge), and
// ref forwarding. We assert SEMANTIC token classes (bg-surface-sunken, ring-surface-cream) — not
// computed pixels (visual-fidelity is verified later against designs/*.dc.html in the app-shell PR).
describe('Avatar', () => {
  it('renders the photo as an img whose accessible name is the person name', () => {
    render(<Avatar name="Bích Ngọc" src="https://cdn.lumin/avatar.jpg" />);
    const img = screen.getByRole('img', { name: 'Bích Ngọc' });
    expect(img).toHaveAttribute('src', 'https://cdn.lumin/avatar.jpg');
    expect(img).toHaveClass('object-cover');
  });

  it('falls back to two-letter initials when there is no src', () => {
    render(<Avatar name="Bích Ngọc" />);
    expect(screen.getByText('BN')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('uses a single initial for a one-word name', () => {
    render(<Avatar name="lumin" />);
    expect(screen.getByText('L')).toBeInTheDocument();
  });

  it('wears the cream halo on a sunken surface by default', () => {
    const { container } = render(<Avatar name="An" />);
    const root = container.firstChild as HTMLElement;
    expect(root).toHaveClass('ring-surface-cream', 'bg-surface-sunken', 'rounded-full');
  });

  it('maps the lg size to its dimension classes', () => {
    const { container } = render(<Avatar name="An" size="lg" />);
    expect(container.firstChild).toHaveClass('h-14', 'w-14', 'text-lg');
  });

  it('defaults to the md size', () => {
    const { container } = render(<Avatar name="An" />);
    expect(container.firstChild).toHaveClass('h-11', 'w-11', 'text-base');
  });

  it('lets a caller className override the default background (tailwind-merge)', () => {
    const { container } = render(<Avatar name="An" className="bg-accent-teal" />);
    const root = container.firstChild as HTMLElement;
    expect(root).toHaveClass('bg-accent-teal');
    expect(root).not.toHaveClass('bg-surface-sunken');
  });

  it('forwards its ref to the underlying div element', () => {
    const ref = { current: null as HTMLDivElement | null };
    render(<Avatar name="An" ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });
});
