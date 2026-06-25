import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IconButton } from '../src/IconButton';

// HOUSE-STYLE REFERENCE: see Button.test.tsx. Assert role + accessible-name (from `label`),
// variant/size→class mapping, behaviour (onClick / disabled), className override (tailwind-merge),
// and ref forwarding. Semantic token classes only — visual fidelity is verified later in the app PR.
describe('IconButton', () => {
  it('takes its accessible name from the label prop (icon child is decorative)', () => {
    render(
      <IconButton label="Thêm vào yêu thích">
        <span aria-hidden>★</span>
      </IconButton>,
    );
    const btn = screen.getByRole('button', { name: 'Thêm vào yêu thích' });
    expect(btn).toHaveAttribute('aria-label', 'Thêm vào yêu thích');
  });

  it('defaults to the soft variant, md size, type=button, and a circular shape', () => {
    render(<IconButton label="x">★</IconButton>);
    const btn = screen.getByRole('button');
    expect(btn).toHaveClass('bg-surface-sunken', 'rounded-full', 'h-11', 'w-11');
    expect(btn).toHaveAttribute('type', 'button');
  });

  it('maps the solid variant to the coral primary surface', () => {
    render(
      <IconButton variant="solid" label="x">
        ★
      </IconButton>,
    );
    const btn = screen.getByRole('button');
    expect(btn).toHaveClass('bg-primary', 'text-on-primary');
    expect(btn).not.toHaveClass('bg-surface-sunken');
  });

  it('maps the ghost variant to a transparent surface', () => {
    render(
      <IconButton variant="ghost" label="x">
        ★
      </IconButton>,
    );
    expect(screen.getByRole('button')).toHaveClass('bg-transparent', 'text-text-strong');
  });

  it('maps each size to an equal height/width hit target', () => {
    const { rerender } = render(
      <IconButton size="sm" label="x">
        ★
      </IconButton>,
    );
    expect(screen.getByRole('button')).toHaveClass('h-9', 'w-9');
    rerender(
      <IconButton size="lg" label="x">
        ★
      </IconButton>,
    );
    expect(screen.getByRole('button')).toHaveClass('h-12', 'w-12');
  });

  it('fires onClick when enabled but not when disabled', async () => {
    const onClick = vi.fn();
    const { rerender } = render(
      <IconButton label="x" onClick={onClick}>
        ★
      </IconButton>,
    );
    await userEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledOnce();

    rerender(
      <IconButton label="x" disabled onClick={onClick}>
        ★
      </IconButton>,
    );
    await userEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledOnce();
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('lets a caller className override the default background (tailwind-merge)', () => {
    render(
      <IconButton label="x" className="bg-accent-teal">
        ★
      </IconButton>,
    );
    const btn = screen.getByRole('button');
    expect(btn).toHaveClass('bg-accent-teal');
    expect(btn).not.toHaveClass('bg-surface-sunken');
  });

  it('forwards its ref to the underlying button element', () => {
    const ref = { current: null as HTMLButtonElement | null };
    render(
      <IconButton label="x" ref={ref}>
        ★
      </IconButton>,
    );
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });
});
