import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PriceTag } from '../src/PriceTag';

// HOUSE-STYLE REFERENCE: assert SEMANTIC token classes (font-display, line-through, text-text-muted)
// and the @lumin/core-formatted output — not computed pixels. The default VND formatting MUST come
// from core's formatVnd (no Intl in @lumin/ui), so we assert its exact `390.000₫` output.
describe('PriceTag', () => {
  it('renders the amount via the default core VND formatter', () => {
    render(<PriceTag amount={390000} data-testid="price" />);
    const tag = screen.getByTestId('price');
    expect(tag).toHaveTextContent('390.000₫');
    expect(tag).toHaveClass('font-display', 'font-bold', 'text-text-strong');
  });

  it('renders compareAt struck through when it is greater than amount', () => {
    render(<PriceTag amount={390000} compareAt={520000} data-testid="price" />);
    const tag = screen.getByTestId('price');
    expect(tag).toHaveTextContent('390.000₫');
    expect(tag).toHaveTextContent('520.000₫');
    const struck = tag.querySelector('.line-through');
    expect(struck).not.toBeNull();
    expect(struck).toHaveClass('line-through', 'text-text-muted', 'font-normal', 'text-sm');
    expect(struck).toHaveTextContent('520.000₫');
  });

  it('omits compareAt when it is not greater than amount', () => {
    const { rerender } = render(
      <PriceTag amount={390000} compareAt={390000} data-testid="price" />,
    );
    expect(screen.getByTestId('price').querySelector('.line-through')).toBeNull();

    rerender(<PriceTag amount={390000} compareAt={120000} data-testid="price" />);
    const tag = screen.getByTestId('price');
    expect(tag.querySelector('.line-through')).toBeNull();
    expect(tag).not.toHaveTextContent('120.000₫');
  });

  it('uses a caller-supplied formatValue for both prices (non-VND currencies)', () => {
    const usd = (n: number) => `$${n}`;
    render(<PriceTag amount={29} compareAt={49} formatValue={usd} data-testid="price" />);
    const tag = screen.getByTestId('price');
    expect(tag).toHaveTextContent('$29');
    expect(tag.querySelector('.line-through')).toHaveTextContent('$49');
  });

  it('lets a caller className override / extend through cn() last', () => {
    render(<PriceTag amount={1000} className="text-danger" data-testid="price" />);
    const tag = screen.getByTestId('price');
    expect(tag).toHaveClass('text-danger', 'font-display');
  });

  it('forwards its ref to the underlying span element', () => {
    const ref = { current: null as HTMLSpanElement | null };
    render(<PriceTag amount={1000} ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLSpanElement);
  });
});
