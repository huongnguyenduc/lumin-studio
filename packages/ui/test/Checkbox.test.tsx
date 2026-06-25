import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Checkbox } from '../src/Checkbox';

// HOUSE-STYLE REFERENCE for @lumin/ui tests (see Button.test.tsx): assert role/accessible-name, the
// checked-state class mapping, behaviour (toggle fires onChange + flips checked), disabled, className
// override (tailwind-merge), and ref forwarding. We assert SEMANTIC token classes (peer-checked:bg-
// primary, rounded-xs) — not computed pixels (visual fidelity is verified later against designs/*.dc.html).
describe('Checkbox', () => {
  it('renders a native checkbox whose label gives it an accessible name', () => {
    render(<Checkbox label="Đồng ý điều khoản" />);
    const box = screen.getByRole('checkbox', { name: 'Đồng ý điều khoản' });
    expect(box).toBeInTheDocument();
    expect(box).toHaveAttribute('type', 'checkbox');
    // label text + box associate via the wrapping <label>
    expect(screen.getByLabelText('Đồng ý điều khoản')).toBe(box);
  });

  it('styles the box as a square rounded checkbox that fills on check', () => {
    render(<Checkbox label="x" />);
    const visualBox = screen.getByLabelText('x').nextElementSibling as HTMLElement;
    expect(visualBox).toHaveClass('h-5', 'w-5', 'rounded-xs', 'border-border-strong');
    expect(visualBox).toHaveClass('peer-checked:bg-primary', 'peer-checked:border-primary');
  });

  it('gives the control a ≥44px hit target on the default size', () => {
    render(<Checkbox label="x" />);
    const wrapper = screen.getByText('x').closest('label') as HTMLElement;
    expect(wrapper).toHaveClass('min-h-11');
  });

  it('toggles checked and fires onChange when clicked', async () => {
    const onChange = vi.fn();
    render(<Checkbox label="Nhận thông báo" onChange={onChange} />);
    const box = screen.getByRole('checkbox') as HTMLInputElement;
    expect(box.checked).toBe(false);
    await userEvent.click(box);
    expect(box.checked).toBe(true);
    expect(onChange).toHaveBeenCalledOnce();
  });

  it('honours defaultChecked (uncontrolled)', () => {
    render(<Checkbox label="x" defaultChecked />);
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
  });

  it('honours a controlled checked prop', () => {
    render(<Checkbox label="x" checked readOnly />);
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
  });

  it('does not fire onChange when disabled', async () => {
    const onChange = vi.fn();
    render(<Checkbox label="x" disabled onChange={onChange} />);
    const box = screen.getByRole('checkbox');
    expect(box).toBeDisabled();
    await userEvent.click(box);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('lets a caller className override the label wrapper (tailwind-merge)', () => {
    render(<Checkbox label="x" className="text-text-muted" />);
    const wrapper = screen.getByText('x').closest('label') as HTMLElement;
    expect(wrapper).toHaveClass('text-text-muted');
    expect(wrapper).not.toHaveClass('text-text-body');
  });

  it('forwards its ref to the underlying input element', () => {
    const ref = { current: null as HTMLInputElement | null };
    render(<Checkbox ref={ref} label="x" />);
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
    expect(ref.current?.type).toBe('checkbox');
  });
});
