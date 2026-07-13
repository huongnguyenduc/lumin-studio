import { useEffect, useState } from 'react';
import { Button, Input } from '@lumin/ui';
import { formatVnd } from '@lumin/core';
import { t, type MessageKey } from '../i18n';
import {
  getProduct,
  listProducts,
  listShippableProvinces,
  type Product,
  type ProductCard,
} from '../lib/catalog';
import { createInboxOrder, quoteOrder, type QuoteResult } from '../lib/orders';
import {
  addressErrors,
  buildOrderItem,
  customerErrors,
  emptySelection,
  flatColors,
  hasErrors,
  normalizePhone,
  partColors,
  selectionComplete,
  type AddressErrors,
  type AddressFields,
  type CustomerErrors,
  type CustomerFields,
  type Selection,
} from '../lib/order-form';

const selectClass =
  'h-11 w-full rounded-md border border-border-default bg-surface-card px-3 text-base text-text-body ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2';

// The create-order screen (the "Tạo đơn" tab). Bootstraps the catalog + shippable provinces, then
// hands off to the form. One order line for now (multi-item "Thêm món" is a follow-up).
export function CreateOrder() {
  const [boot, setBoot] = useState<
    | { status: 'loading' }
    | { status: 'error' }
    | { status: 'ready'; products: ProductCard[]; provinces: string[] }
  >({ status: 'loading' });

  function load() {
    setBoot({ status: 'loading' });
    Promise.all([listProducts(), listShippableProvinces()])
      .then(([products, provinces]) => setBoot({ status: 'ready', products, provinces }))
      .catch(() => setBoot({ status: 'error' }));
  }
  useEffect(load, []);

  if (boot.status === 'loading') {
    return (
      <div
        className="flex flex-1 items-center justify-center p-6 text-sm text-text-muted"
        role="status"
      >
        {t('createOrder.product.loading')}
      </div>
    );
  }
  if (boot.status === 'error') {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm text-text-muted" role="alert">
          {t('createOrder.product.error')}
        </p>
        <Button variant="outline" size="sm" className="min-h-11" onClick={load}>
          {t('createOrder.retry')}
        </Button>
      </div>
    );
  }
  return <OrderForm products={boot.products} provinces={boot.provinces} />;
}

function OrderForm({ products, provinces }: { products: ProductCard[]; provinces: string[] }) {
  const [slug, setSlug] = useState('');
  const [product, setProduct] = useState<Product | null>(null);
  const [detail, setDetail] = useState<'idle' | 'loading' | 'error'>('idle');
  const [selection, setSelection] = useState<Selection>(emptySelection);

  const [customer, setCustomer] = useState<CustomerFields>({ name: '', phone: '', email: '' });
  const [address, setAddress] = useState<AddressFields>({ province: '', ward: '', street: '' });
  const [note, setNote] = useState('');
  const [custErr, setCustErr] = useState<CustomerErrors>({});
  const [addrErr, setAddrErr] = useState<AddressErrors>({});

  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [submit, setSubmit] = useState<
    | { status: 'idle' }
    | { status: 'submitting' }
    | { status: 'error'; code: 'unavailable' | 'no_shipping_rule' | 'forbidden' | 'error' }
    | { status: 'success'; code: string }
  >({ status: 'idle' });

  // Fetch detail when the picked product changes; reset the variant selection.
  useEffect(() => {
    if (slug === '') {
      setProduct(null);
      setDetail('idle');
      return;
    }
    let live = true;
    setDetail('loading');
    setProduct(null);
    setSelection(emptySelection());
    getProduct(slug)
      .then((p) => {
        if (live) {
          setProduct(p);
          setDetail('idle');
        }
      })
      .catch(() => live && setDetail('error'));
    return () => {
      live = false;
    };
  }, [slug]);

  // Live server total (ZERO client math): re-quote whenever the built line or province changes.
  useEffect(() => {
    if (!product || !selectionComplete(product, selection)) {
      setQuote(null);
      return;
    }
    let live = true;
    setQuoting(true);
    quoteOrder([buildOrderItem(product, selection)], address.province.trim() || undefined).then(
      (r) => {
        if (live) {
          setQuote(r);
          setQuoting(false);
        }
      },
    );
    return () => {
      live = false;
    };
  }, [product, selection, address.province]);

  async function onSubmit() {
    if (!product) return;
    const cErr = customerErrors(customer);
    const aErr = addressErrors(address);
    setCustErr(cErr);
    setAddrErr(aErr);
    if (hasErrors(cErr) || hasErrors(aErr) || !selectionComplete(product, selection)) return;

    setSubmit({ status: 'submitting' });
    const res = await createInboxOrder({
      customer: {
        name: customer.name.trim(),
        phone: normalizePhone(customer.phone),
        ...(customer.email.trim() ? { email: customer.email.trim() } : {}),
      },
      shippingAddress: {
        province: address.province,
        ward: address.ward.trim(),
        street: address.street.trim(),
      },
      items: [buildOrderItem(product, selection)],
      ...(note.trim() ? { note: note.trim() } : {}),
    });
    setSubmit(
      res.ok ? { status: 'success', code: res.order.code } : { status: 'error', code: res.code },
    );
  }

  function reset() {
    setSlug('');
    setProduct(null);
    setSelection(emptySelection());
    setCustomer({ name: '', phone: '', email: '' });
    setAddress({ province: '', ward: '', street: '' });
    setNote('');
    setCustErr({});
    setAddrErr({});
    setQuote(null);
    setSubmit({ status: 'idle' });
  }

  if (submit.status === 'success') {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="font-display text-lg font-semibold text-text-strong">
          {t('createOrder.success.title', { code: submit.code })}
        </p>
        <Button className="min-h-11" onClick={reset}>
          {t('createOrder.success.again')}
        </Button>
      </div>
    );
  }

  const submitting = submit.status === 'submitting';

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
      <label className="flex flex-col gap-1.5">
        <span className="font-display text-sm font-medium text-text-strong">
          {t('createOrder.product.label')}
        </span>
        <select className={selectClass} value={slug} onChange={(e) => setSlug(e.target.value)}>
          <option value="">{t('createOrder.product.placeholder')}</option>
          {products.map((p) => (
            <option key={p.id} value={p.slug}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      {detail === 'loading' && (
        <p className="text-sm text-text-muted">{t('createOrder.detail.loading')}</p>
      )}
      {detail === 'error' && (
        <p className="text-sm text-danger" role="alert">
          {t('createOrder.detail.error')}
        </p>
      )}
      {product && <VariantFields product={product} selection={selection} onChange={setSelection} />}

      <fieldset className="flex flex-col gap-3 border-t border-border-subtle pt-3">
        <legend className="font-display text-sm font-semibold text-text-strong">
          {t('createOrder.customer.section')}
        </legend>
        <Input
          label={t('createOrder.customer.name')}
          value={customer.name}
          onChange={(e) => setCustomer({ ...customer, name: e.target.value })}
          error={custErr.name ? t('createOrder.customer.name.error') : undefined}
        />
        <Input
          type="tel"
          label={t('createOrder.customer.phone')}
          placeholder="0901 234 567"
          value={customer.phone}
          onChange={(e) => setCustomer({ ...customer, phone: e.target.value })}
          error={custErr.phone ? t('createOrder.customer.phone.error') : undefined}
        />
        <Input
          type="email"
          label={t('createOrder.customer.email')}
          value={customer.email}
          onChange={(e) => setCustomer({ ...customer, email: e.target.value })}
          error={custErr.email ? t('createOrder.customer.email.error') : undefined}
        />
      </fieldset>

      <fieldset className="flex flex-col gap-3 border-t border-border-subtle pt-3">
        <legend className="font-display text-sm font-semibold text-text-strong">
          {t('createOrder.address.section')}
        </legend>
        <label className="flex flex-col gap-1.5">
          <span className="font-display text-sm font-medium text-text-strong">
            {t('createOrder.address.province')}
          </span>
          <select
            className={selectClass}
            value={address.province}
            onChange={(e) => setAddress({ ...address, province: e.target.value })}
            aria-invalid={addrErr.province || undefined}
          >
            <option value="">{t('createOrder.address.province.placeholder')}</option>
            {provinces.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          {addrErr.province && (
            <span className="text-sm text-danger" role="alert">
              {t('createOrder.address.required')}
            </span>
          )}
        </label>
        <Input
          label={t('createOrder.address.ward')}
          value={address.ward}
          onChange={(e) => setAddress({ ...address, ward: e.target.value })}
          error={addrErr.ward ? t('createOrder.address.required') : undefined}
        />
        <Input
          label={t('createOrder.address.street')}
          value={address.street}
          onChange={(e) => setAddress({ ...address, street: e.target.value })}
          error={addrErr.street ? t('createOrder.address.required') : undefined}
        />
      </fieldset>

      <label className="flex flex-col gap-1.5">
        <span className="font-display text-sm font-medium text-text-strong">
          {t('createOrder.note.label')}
        </span>
        <textarea
          className={selectClass + ' h-auto py-2'}
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>

      <TotalLine quote={quote} quoting={quoting} />

      {submit.status === 'error' && (
        <p className="text-sm text-danger" role="alert">
          {t(submitErrorKey(submit.code))}
        </p>
      )}

      <Button className="min-h-11 w-full" disabled={submitting} onClick={onSubmit}>
        {submitting ? t('createOrder.submitting') : t('createOrder.submit')}
      </Button>
      <p className="text-center font-mono text-xs text-text-subtle">{t('createOrder.channel')}</p>
    </div>
  );
}

// The variant picker: one <select> per part's colours (or the flat colour), one per enumerated
// choice-option, a checkbox per toggle-option, and quantity. Text/engraving options are deferred.
function VariantFields({
  product,
  selection,
  onChange,
}: {
  product: Product;
  selection: Selection;
  onChange: (s: Selection) => void;
}) {
  const parts = [...product.parts].sort((a, b) => a.displayOrder - b.displayOrder);
  const flat = flatColors(product);

  return (
    <div className="flex flex-col gap-3">
      {parts.map((part) => (
        <label key={part.id} className="flex flex-col gap-1.5">
          <span className="font-display text-sm font-medium text-text-strong">{part.name}</span>
          <select
            className={selectClass}
            value={selection.partColorByPart[part.id] ?? ''}
            onChange={(e) =>
              onChange({
                ...selection,
                partColorByPart: { ...selection.partColorByPart, [part.id]: e.target.value },
              })
            }
          >
            <option value="">{t('createOrder.color.placeholder')}</option>
            {partColors(product, part.id).map((c) => (
              <option key={c.id} value={c.id} disabled={!c.available}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      ))}

      {parts.length === 0 && flat.length > 0 && (
        <label className="flex flex-col gap-1.5">
          <span className="font-display text-sm font-medium text-text-strong">
            {t('createOrder.color.label')}
          </span>
          <select
            className={selectClass}
            value={selection.colorId ?? ''}
            onChange={(e) => onChange({ ...selection, colorId: e.target.value || null })}
          >
            <option value="">{t('createOrder.color.placeholder')}</option>
            {flat.map((c) => (
              <option key={c.id} value={c.id} disabled={!c.available}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {product.options.map((o) => {
        if (o.type !== 'choice') return null; // text options deferred
        if (o.choices.length > 0) {
          return (
            <label key={o.id} className="flex flex-col gap-1.5">
              <span className="font-display text-sm font-medium text-text-strong">{o.label}</span>
              <select
                className={selectClass}
                value={selection.choiceByOption[o.id] ?? ''}
                onChange={(e) =>
                  onChange({
                    ...selection,
                    choiceByOption: { ...selection.choiceByOption, [o.id]: e.target.value },
                  })
                }
              >
                <option value="">{t('createOrder.choice.placeholder')}</option>
                {[...o.choices]
                  .sort((a, b) => a.displayOrder - b.displayOrder)
                  .map((ch) => (
                    <option key={ch.id} value={ch.id}>
                      {ch.label}
                    </option>
                  ))}
              </select>
            </label>
          );
        }
        const on = selection.toggleOptionIds.includes(o.id);
        return (
          <label key={o.id} className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={on}
              onChange={(e) =>
                onChange({
                  ...selection,
                  toggleOptionIds: e.target.checked
                    ? [...selection.toggleOptionIds, o.id]
                    : selection.toggleOptionIds.filter((id) => id !== o.id),
                })
              }
            />
            <span className="text-sm text-text-body">{o.label}</span>
          </label>
        );
      })}

      <label className="flex flex-col gap-1.5">
        <span className="font-display text-sm font-medium text-text-strong">
          {t('createOrder.quantity.label')}
        </span>
        <input
          type="number"
          min={1}
          className={selectClass}
          value={selection.quantity}
          onChange={(e) =>
            onChange({
              ...selection,
              quantity: Math.max(1, Math.floor(Number(e.target.value) || 1)),
            })
          }
        />
      </label>
    </div>
  );
}

function TotalLine({ quote, quoting }: { quote: QuoteResult | null; quoting: boolean }) {
  if (quoting) return <p className="text-sm text-text-muted">{t('createOrder.total.computing')}</p>;
  if (!quote) return <p className="text-sm text-text-subtle">{t('createOrder.total.hint')}</p>;
  if (!quote.ok) {
    return (
      <p className="text-sm text-danger" role="alert">
        {t(
          quote.code === 'no_shipping_rule'
            ? 'createOrder.error.noShippingRule'
            : 'createOrder.error.unavailable',
        )}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border-subtle bg-surface-sunken p-3">
      <Row label={t('createOrder.total.subtotal')} value={formatVnd(quote.subtotal)} />
      {quote.shippingFee !== undefined && (
        <Row label={t('createOrder.total.shipping')} value={formatVnd(quote.shippingFee)} />
      )}
      {quote.total !== undefined && (
        <Row label={t('createOrder.total.total')} value={formatVnd(quote.total)} strong />
      )}
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div
      className={
        'flex justify-between text-sm ' +
        (strong ? 'font-semibold text-text-strong' : 'text-text-muted')
      }
    >
      <span>{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}

function submitErrorKey(
  code: 'unavailable' | 'no_shipping_rule' | 'forbidden' | 'error',
): MessageKey {
  switch (code) {
    case 'unavailable':
      return 'createOrder.error.unavailable';
    case 'no_shipping_rule':
      return 'createOrder.error.noShippingRule';
    case 'forbidden':
      return 'createOrder.error.forbidden';
    default:
      return 'createOrder.error.network';
  }
}
