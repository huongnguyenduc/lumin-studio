import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from '../src/Button';

// HOUSE-STYLE REFERENCE for @lumin/ui tests: assert role/accessible-name, variant→class mapping,
// behaviour (onClick / disabled), className override (tailwind-merge), and ref forwarding. We assert
// SEMANTIC token classes (bg-primary, shadow-pop) — not computed pixels (visual-fidelity is verified
// later against designs/*.dc.html in the app-shell PR).
describe('Button', () => {
  it('renders its children as an accessible button', () => {
    render(<Button>Đặt làm riêng</Button>);
    expect(screen.getByRole('button', { name: 'Đặt làm riêng' })).toBeInTheDocument();
  });

  it('defaults to the primary variant and type=button', () => {
    render(<Button>x</Button>);
    const btn = screen.getByRole('button');
    expect(btn).toHaveClass('bg-primary');
    expect(btn).toHaveAttribute('type', 'button');
  });

  it('maps the pop variant to the signature offset shadow', () => {
    render(<Button variant="pop">x</Button>);
    expect(screen.getByRole('button')).toHaveClass('shadow-pop');
  });

  it('fires onClick when enabled', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>x</Button>);
    await userEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('does not fire onClick when disabled', async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        x
      </Button>,
    );
    await userEvent.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('lets a caller className override the default background (tailwind-merge)', () => {
    render(<Button className="bg-surface-card">x</Button>);
    const btn = screen.getByRole('button');
    expect(btn).toHaveClass('bg-surface-card');
    expect(btn).not.toHaveClass('bg-primary');
  });

  it('forwards its ref to the underlying button element', () => {
    const ref = { current: null as HTMLButtonElement | null };
    render(<Button ref={ref}>x</Button>);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });
});
