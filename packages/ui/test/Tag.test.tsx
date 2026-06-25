import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tag } from '../src/Tag';

// HOUSE-STYLE REFERENCE for @lumin/ui tests: assert role/accessible-name, variant→class mapping,
// behaviour (toggle / remove), className override (tailwind-merge), and ref forwarding. We assert
// SEMANTIC token classes (bg-primary, bg-surface-sunken) — not computed pixels (visual-fidelity is
// verified later against designs/*.dc.html in the app-shell PR).
describe('Tag', () => {
  it('renders a static span (no chip button role) when not selectable', () => {
    render(<Tag>Gốm sứ</Tag>);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('Gốm sứ').tagName).toBe('SPAN');
  });

  it('renders a toggle button exposing its label when selectable', () => {
    render(<Tag selectable>Nhựa PLA</Tag>);
    const chip = screen.getByRole('button', { name: 'Nhựa PLA' });
    expect(chip).toHaveAttribute('aria-pressed', 'false');
  });

  it('maps the unselected state to the sunken surface with a default border', () => {
    render(<Tag selectable>x</Tag>);
    const chip = screen.getByRole('button');
    expect(chip).toHaveClass('bg-surface-sunken', 'text-text-body', 'border-border-default');
    expect(chip).not.toHaveClass('bg-primary');
  });

  it('maps the selected state to the primary fill', () => {
    render(
      <Tag selectable selected>
        x
      </Tag>,
    );
    const chip = screen.getByRole('button');
    expect(chip).toHaveClass('bg-primary', 'text-on-primary');
    expect(chip).not.toHaveClass('bg-surface-sunken');
  });

  it('fires onClick so a caller can toggle aria-pressed', async () => {
    function Controlled() {
      const [on, setOn] = useState(false);
      return (
        <Tag selectable selected={on} onClick={() => setOn((v) => !v)}>
          Mạ vàng
        </Tag>
      );
    }
    render(<Controlled />);
    const chip = screen.getByRole('button', { name: 'Mạ vàng' });
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(chip);
    expect(chip).toHaveAttribute('aria-pressed', 'true');
  });

  it('fires onRemove from a × button reachable by its accessible name, without toggling the chip', async () => {
    const onRemove = vi.fn();
    const onClick = vi.fn();
    render(
      <Tag selectable onClick={onClick} onRemove={onRemove} removeLabel="Bỏ chọn gỗ óc chó">
        Gỗ óc chó
      </Tag>,
    );
    // The toggle and the × are separate (sibling) buttons — both reachable, neither nested.
    expect(screen.getByRole('button', { name: 'Gỗ óc chó', pressed: false })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Bỏ chọn gỗ óc chó' }));
    expect(onRemove).toHaveBeenCalledOnce();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('lets a caller className override the default surface (tailwind-merge)', () => {
    render(
      <Tag selectable className="bg-accent-teal">
        x
      </Tag>,
    );
    const chip = screen.getByRole('button');
    expect(chip).toHaveClass('bg-accent-teal');
    expect(chip).not.toHaveClass('bg-surface-sunken');
  });

  it('forwards its ref to the underlying element for both span and button', () => {
    const spanRef = { current: null as HTMLElement | null };
    const { unmount } = render(<Tag ref={spanRef}>x</Tag>);
    expect(spanRef.current).toBeInstanceOf(HTMLSpanElement);
    unmount();

    const btnRef = { current: null as HTMLElement | null };
    render(
      <Tag selectable ref={btnRef}>
        x
      </Tag>,
    );
    expect(btnRef.current).toBeInstanceOf(HTMLButtonElement);
  });
});
