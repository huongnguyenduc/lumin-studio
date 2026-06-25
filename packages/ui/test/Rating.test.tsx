import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Rating } from '../src/Rating';

// HOUSE-STYLE REFERENCE (see Button.test.tsx): assert role/accessible-name, value→fill mapping via
// semantic token classes (text-accent-sun vs text-border-default), behaviour (onRate), className
// override (tailwind-merge), and ref forwarding. Counts are grouped by @lumin/core (1234 → "1.234").
describe('Rating', () => {
  it('renders five star bases as a labelled image group', () => {
    const { container } = render(<Rating value={3} label="đánh giá" />);
    const group = screen.getByRole('img', { name: 'đánh giá' });
    expect(group).toBeInTheDocument();
    // One empty base "★" per star.
    expect(container.querySelectorAll('.text-border-default')).toHaveLength(5);
  });

  it('drives the filled overlay width from the value (full + half)', () => {
    const { container } = render(<Rating value={3.5} label="đánh giá" />);
    const fills = Array.from(container.querySelectorAll<HTMLElement>('.text-accent-sun')).map(
      (el) => el.style.width,
    );
    expect(fills).toEqual(['100%', '100%', '100%', '50%', '0%']);
  });

  it('renders the count after the stars with vi-VN grouping', () => {
    render(<Rating value={4} count={1234} label="đánh giá" />);
    expect(screen.getByText('(1.234)')).toBeInTheDocument();
  });

  it('omits the count node when count is not provided', () => {
    const { container } = render(<Rating value={4} label="đánh giá" />);
    expect(container.textContent).not.toContain('(');
  });

  it('renders interactive stars as buttons that call onRate with the 1-based index', async () => {
    const onRate = vi.fn();
    render(
      <Rating
        value={2}
        interactive
        onRate={onRate}
        label="chọn sao"
        starLabel={(n) => `${n} sao`}
      />,
    );
    const group = screen.getByRole('group', { name: 'chọn sao' });
    const buttons = within(group).getAllByRole('button');
    expect(buttons).toHaveLength(5);
    await userEvent.click(screen.getByRole('button', { name: '4 sao' }));
    expect(onRate).toHaveBeenCalledExactlyOnceWith(4);
  });

  it('renders no buttons when not interactive', () => {
    render(<Rating value={3} label="đánh giá" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('lets a caller className override merge onto the group', () => {
    const { container } = render(<Rating value={3} label="đánh giá" className="gap-6" />);
    const group = container.querySelector('[role="img"]');
    expect(group).toHaveClass('gap-6');
    expect(group).not.toHaveClass('gap-2');
  });

  it('forwards its ref to the underlying div element', () => {
    const ref = { current: null as HTMLDivElement | null };
    render(<Rating value={3} ref={ref} label="đánh giá" />);
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });
});
