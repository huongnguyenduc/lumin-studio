import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Input } from '../src/Input';

// HOUSE-STYLE REFERENCE for @lumin/ui tests: assert label association, role/accessible-name, behaviour
// (typing/onChange), error a11y wiring (aria-invalid + role=alert + aria-describedby), className
// override (tailwind-merge), and ref forwarding. We assert SEMANTIC token classes (border-danger,
// text-danger) — not computed pixels (visual-fidelity is verified later against designs/*.dc.html).
describe('Input', () => {
  it('associates its label with the control (getByLabelText finds the input)', () => {
    render(<Input label="Họ và tên" />);
    const input = screen.getByLabelText('Họ và tên');
    expect(input).toBeInstanceOf(HTMLInputElement);
  });

  it('forwards typing through onChange', async () => {
    const onChange = vi.fn();
    render(<Input label="Email" onChange={onChange} />);
    await userEvent.type(screen.getByLabelText('Email'), 'an');
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText<HTMLInputElement>('Email').value).toBe('an');
  });

  it('renders a hint wired via aria-describedby', () => {
    render(<Input label="Số điện thoại" hint="Chúng mình chỉ dùng để báo đơn" />);
    const input = screen.getByLabelText('Số điện thoại');
    const hint = screen.getByText('Chúng mình chỉ dùng để báo đơn');
    expect(hint).toHaveClass('text-text-muted');
    expect(input.getAttribute('aria-describedby')).toBe(hint.id);
    expect(input).not.toHaveAttribute('aria-invalid');
  });

  it('sets aria-invalid and announces the error via role=alert', () => {
    render(<Input label="Email" error="Email chưa hợp lệ" />);
    const input = screen.getByLabelText('Email');
    const alert = screen.getByRole('alert');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(alert).toHaveTextContent('Email chưa hợp lệ');
    expect(alert).toHaveClass('text-danger');
    expect(input.getAttribute('aria-describedby')).toBe(alert.id);
  });

  it('prefers the error over the hint and paints a danger border', () => {
    render(
      <Input label="Email" hint="Không bắt buộc" error="Email chưa hợp lệ" data-testid="ctl" />,
    );
    expect(screen.queryByText('Không bắt buộc')).not.toBeInTheDocument();
    const row = screen.getByTestId('ctl').parentElement as HTMLElement;
    expect(row).toHaveClass('border-danger');
    expect(row).not.toHaveClass('border-border-default');
  });

  it('does not fire onChange when disabled', async () => {
    const onChange = vi.fn();
    render(<Input label="Email" disabled onChange={onChange} />);
    const input = screen.getByLabelText('Email');
    expect(input).toBeDisabled();
    await userEvent.type(input, 'x');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('lets a caller className override the input default (tailwind-merge)', () => {
    render(<Input label="Email" className="text-danger" />);
    const input = screen.getByLabelText('Email');
    expect(input).toHaveClass('text-danger');
    expect(input).not.toHaveClass('text-text-body');
  });

  it('forwards its ref to the underlying input element', () => {
    const ref = { current: null as HTMLInputElement | null };
    render(<Input label="Email" ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
  });
});
