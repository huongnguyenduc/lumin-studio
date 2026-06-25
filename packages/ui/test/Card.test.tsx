import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Card } from '../src/Card';

// HOUSE-STYLE REFERENCE for @lumin/ui tests: assert role/accessible-name, variant→class mapping,
// behaviour, className override (tailwind-merge), and ref forwarding. We assert SEMANTIC token classes
// (bg-surface-card, shadow-pop) — not computed pixels (visual-fidelity is verified later against
// designs/*.dc.html in the app-shell PR).
describe('Card', () => {
  it('renders its children inside a rounded surface', () => {
    render(<Card>Đèn gốm nhỏ</Card>);
    expect(screen.getByText('Đèn gốm nhỏ')).toBeInTheDocument();
  });

  it('defaults to the md (quiet) elevation', () => {
    const { container } = render(<Card>x</Card>);
    const el = container.firstElementChild!;
    expect(el).toHaveClass('bg-surface-card', 'rounded-lg', 'shadow-md', 'border-border-subtle');
    expect(el).not.toHaveClass('shadow-pop');
  });

  it('maps the pop elevation to the signature offset shadow and cocoa outline', () => {
    const { container } = render(<Card elevation="pop">x</Card>);
    const el = container.firstElementChild!;
    expect(el).toHaveClass('shadow-pop', 'border-2', 'border-border-strong');
    expect(el).not.toHaveClass('shadow-md');
  });

  it('is a plain non-focusable surface by default (no role / tabindex / pointer)', () => {
    const { container } = render(<Card>x</Card>);
    const el = container.firstElementChild!;
    expect(el).not.toHaveAttribute('role');
    expect(el).not.toHaveAttribute('tabindex');
    expect(el).not.toHaveClass('cursor-pointer');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('becomes a focusable button with a hover lift when interactive', () => {
    render(<Card interactive>x</Card>);
    const el = screen.getByRole('button');
    expect(el).toHaveAttribute('tabindex', '0');
    expect(el).toHaveClass(
      'cursor-pointer',
      'hover:-translate-x-px',
      'motion-reduce:transform-none',
    );
  });

  it('fires onClick when an interactive card is activated', async () => {
    const onClick = vi.fn();
    render(
      <Card interactive onClick={onClick}>
        x
      </Card>,
    );
    await userEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('lets a caller className override the default background (tailwind-merge)', () => {
    const { container } = render(<Card className="bg-surface-sunken">x</Card>);
    const el = container.firstElementChild!;
    expect(el).toHaveClass('bg-surface-sunken');
    expect(el).not.toHaveClass('bg-surface-card');
  });

  it('forwards its ref to the underlying div element', () => {
    const ref = { current: null as HTMLDivElement | null };
    render(<Card ref={ref}>x</Card>);
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });
});
