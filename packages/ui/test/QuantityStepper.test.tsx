import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QuantityStepper } from '../src/QuantityStepper';

// HOUSE-STYLE: assert role/accessible-name (aria-labels come from props), variant→class mapping,
// behaviour (onChange with clamped value), disabled bounds, className override (tailwind-merge), and
// ref forwarding. SEMANTIC token classes only — not computed pixels (visual fidelity verified later).
const labels = { decrementLabel: 'Bớt một', incrementLabel: 'Thêm một' };

describe('QuantityStepper', () => {
  it('renders the controlled value with the prop-supplied aria-labels as accessible names', () => {
    render(<QuantityStepper value={3} onChange={() => {}} {...labels} />);
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bớt một' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Thêm một' })).toBeInTheDocument();
  });

  it('uses the round surface-sunken token class on its buttons', () => {
    render(<QuantityStepper value={3} onChange={() => {}} {...labels} />);
    const dec = screen.getByRole('button', { name: 'Bớt một' });
    expect(dec).toHaveClass('rounded-full');
    expect(dec).toHaveClass('bg-surface-sunken');
  });

  it('calls onChange(value + 1) when + is pressed', async () => {
    const onChange = vi.fn();
    render(<QuantityStepper value={3} onChange={onChange} {...labels} />);
    await userEvent.click(screen.getByRole('button', { name: 'Thêm một' }));
    expect(onChange).toHaveBeenCalledWith(4);
  });

  it('calls onChange(value - 1) when − is pressed', async () => {
    const onChange = vi.fn();
    render(<QuantityStepper value={3} onChange={onChange} {...labels} />);
    await userEvent.click(screen.getByRole('button', { name: 'Bớt một' }));
    expect(onChange).toHaveBeenCalledWith(2);
  });

  it('clamps at min: − is disabled and does not fire at the floor', async () => {
    const onChange = vi.fn();
    render(<QuantityStepper value={1} min={1} onChange={onChange} {...labels} />);
    const dec = screen.getByRole('button', { name: 'Bớt một' });
    expect(dec).toBeDisabled();
    await userEvent.click(dec);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('clamps at max: + is disabled and does not fire at the ceiling', async () => {
    const onChange = vi.fn();
    render(<QuantityStepper value={99} max={99} onChange={onChange} {...labels} />);
    const inc = screen.getByRole('button', { name: 'Thêm một' });
    expect(inc).toBeDisabled();
    await userEvent.click(inc);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('disables both buttons when disabled', () => {
    render(<QuantityStepper value={3} disabled onChange={() => {}} {...labels} />);
    expect(screen.getByRole('button', { name: 'Bớt một' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Thêm một' })).toBeDisabled();
  });

  it('lets a caller className override the group layout (tailwind-merge) and forwards its ref', () => {
    const ref = { current: null as HTMLDivElement | null };
    const { container } = render(
      <QuantityStepper ref={ref} value={3} onChange={() => {}} className="gap-4" {...labels} />,
    );
    const group = container.firstElementChild as HTMLElement;
    expect(group).toHaveClass('gap-4');
    expect(group).not.toHaveClass('gap-2');
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });
});
