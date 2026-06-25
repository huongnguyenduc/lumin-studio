import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge } from '../src/Badge';

// HOUSE-STYLE REFERENCE (see Button.test.tsx): assert the rendered label, tone/solid→class mapping,
// and className override (tailwind-merge). A Badge is a non-interactive <span>, so we assert SEMANTIC
// token classes (bg-accent-teal-soft, bg-primary …) — not computed pixels (visual fidelity is verified
// later against designs/*.dc.html in the app-shell PR).
describe('Badge', () => {
  it('renders its children as visible label text', () => {
    render(<Badge>Mới</Badge>);
    expect(screen.getByText('Mới')).toBeInTheDocument();
  });

  it('defaults to the neutral soft tone', () => {
    render(<Badge>Còn hàng</Badge>);
    const badge = screen.getByText('Còn hàng');
    expect(badge).toHaveClass('bg-surface-sunken', 'text-text-body');
    // base pill shape always present
    expect(badge).toHaveClass('rounded-pill', 'h-6', 'font-body');
  });

  it('maps each soft tone to its tint + cocoa text', () => {
    const { rerender } = render(<Badge tone="primary">x</Badge>);
    expect(screen.getByText('x')).toHaveClass('bg-accent-flame-soft', 'text-text-strong');

    rerender(<Badge tone="teal">x</Badge>);
    expect(screen.getByText('x')).toHaveClass('bg-accent-teal-soft', 'text-text-strong');

    rerender(<Badge tone="sky">x</Badge>);
    expect(screen.getByText('x')).toHaveClass('bg-accent-sky-soft', 'text-text-strong');

    rerender(<Badge tone="sun">x</Badge>);
    expect(screen.getByText('x')).toHaveClass('bg-accent-sun-soft', 'text-text-strong');

    rerender(<Badge tone="danger">x</Badge>);
    expect(screen.getByText('x')).toHaveClass('bg-danger-soft', 'text-text-strong');
  });

  it('maps the solid variant to a saturated fill', () => {
    const { rerender } = render(
      <Badge tone="primary" solid>
        x
      </Badge>,
    );
    const badge = screen.getByText('x');
    expect(badge).toHaveClass('bg-primary', 'text-on-primary');
    expect(badge).not.toHaveClass('bg-accent-flame-soft');

    rerender(
      <Badge tone="neutral" solid>
        x
      </Badge>,
    );
    expect(screen.getByText('x')).toHaveClass('bg-surface-brand', 'text-on-dark');

    rerender(
      <Badge tone="danger" solid>
        x
      </Badge>,
    );
    expect(screen.getByText('x')).toHaveClass('bg-danger', 'text-on-danger');
  });

  it('keeps cocoa text on a solid sun badge (documented AA pairing)', () => {
    render(
      <Badge tone="sun" solid>
        x
      </Badge>,
    );
    expect(screen.getByText('x')).toHaveClass('bg-accent-sun', 'text-text-strong');
  });

  it('uses AA-safe pairings on solid teal/sky (cocoa on teal, white on the darker sky)', () => {
    const { rerender } = render(
      <Badge tone="teal" solid>
        x
      </Badge>,
    );
    // white-on-teal-500 fails AA (2.6:1); cocoa-on-teal-500 clears it (4.8:1).
    expect(screen.getByText('x')).toHaveClass('bg-accent-teal', 'text-text-strong');

    rerender(
      <Badge tone="sky" solid>
        x
      </Badge>,
    );
    // sky-500 fails under both white and cocoa; the solid sky tone darkens to accent-sky-strong (sky-600).
    expect(screen.getByText('x')).toHaveClass('bg-accent-sky-strong', 'text-on-primary');
  });

  it('lets a caller className override the default tint (tailwind-merge)', () => {
    render(<Badge className="bg-surface-card">x</Badge>);
    const badge = screen.getByText('x');
    expect(badge).toHaveClass('bg-surface-card');
    expect(badge).not.toHaveClass('bg-surface-sunken');
  });

  it('forwards its ref to the underlying span element', () => {
    const ref = { current: null as HTMLSpanElement | null };
    render(<Badge ref={ref}>x</Badge>);
    expect(ref.current).toBeInstanceOf(HTMLSpanElement);
  });
});
