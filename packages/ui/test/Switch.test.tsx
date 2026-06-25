import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Switch } from '../src/Switch';

// HOUSE-STYLE: assert role/accessible-name, state→class mapping, toggle behaviour, disabled guard,
// className override (tailwind-merge), and ref forwarding. Controlled — state derives from `checked`.
// We assert SEMANTIC token classes (bg-accent-teal, bg-surface-sunken), not computed pixels.
describe('Switch', () => {
  it('renders a switch whose label is its accessible name', () => {
    render(<Switch checked={false} label="Nhận thông báo Zalo" />);
    expect(screen.getByRole('switch', { name: 'Nhận thông báo Zalo' })).toBeInTheDocument();
  });

  it('reflects the checked prop via aria-checked', () => {
    const { rerender } = render(<Switch checked={false} label="x" />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    rerender(<Switch checked label="x" />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });

  it('maps the ON state to the teal track', () => {
    render(<Switch checked label="x" />);
    expect(screen.getByRole('switch')).toHaveClass('bg-accent-teal');
  });

  it('maps the OFF state to the sunken track, not teal', () => {
    render(<Switch checked={false} label="x" />);
    const sw = screen.getByRole('switch');
    expect(sw).toHaveClass('bg-surface-sunken');
    expect(sw).not.toHaveClass('bg-accent-teal');
  });

  it('calls onCheckedChange with the negated value when clicked', async () => {
    const onCheckedChange = vi.fn();
    render(<Switch checked={false} onCheckedChange={onCheckedChange} label="x" />);
    await userEvent.click(screen.getByRole('switch'));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('does not toggle when disabled', async () => {
    const onCheckedChange = vi.fn();
    render(<Switch checked={false} disabled onCheckedChange={onCheckedChange} label="x" />);
    await userEvent.click(screen.getByRole('switch'));
    expect(onCheckedChange).not.toHaveBeenCalled();
    expect(screen.getByRole('switch')).toBeDisabled();
  });

  it('lets a caller className override the default track background (tailwind-merge)', () => {
    render(<Switch checked={false} className="bg-surface-card" label="x" />);
    const sw = screen.getByRole('switch');
    expect(sw).toHaveClass('bg-surface-card');
    expect(sw).not.toHaveClass('bg-surface-sunken');
  });

  it('forwards its ref to the underlying button element', () => {
    const ref = { current: null as HTMLButtonElement | null };
    render(<Switch checked={false} ref={ref} label="x" />);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });
});
