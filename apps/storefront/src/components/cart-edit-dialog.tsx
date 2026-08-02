'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, QuantityStepper } from '@lumin/ui';
import { buildCartItem, MAX_QUANTITY, type CartItem } from '@/lib/cart';
import { useCart } from '@/lib/cart-store';
import { fetchProductForEdit } from '@/lib/product-fetch';
import type { ProductDetailView } from '@/lib/product-view';
import {
  ConfiguratorFields,
  configuratorSeedFromCartItem,
  useConfiguratorState,
} from './product-configurator';

/**
 * "Sửa" a cart line in place (PR D) — the cart previously only let a shopper change quantity; changing
 * colour/parts/options/engrave meant deleting the line and re-configuring from scratch on the PDP. A
 * CartItem carries only ids + frozen display labels (no product data — the cart page has none), so this
 * fetches the product fresh (fetchProductForEdit) and seeds the SAME configurator state machine the PDP
 * uses (product-configurator.tsx) from the line's current selection. Native <dialog> (showModal) for
 * Esc/backdrop-close + focus-trap for free, mirroring the admin TransitionDialog pattern.
 */
export function CartEditDialog({ item, onClose }: { item: CartItem; onClose: () => void }) {
  const t = useTranslations('cart');
  const ref = useRef<HTMLDialogElement>(null);
  const { remove } = useCart();
  const [fetchState, setFetchState] = useState<
    | { status: 'loading' }
    | { status: 'ok'; product: ProductDetailView }
    | { status: 'error' }
    | { status: 'not_found' }
  >({ status: 'loading' });
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setFetchState({ status: 'loading' });
    void fetchProductForEdit(item.slug).then((res) => {
      if (cancelled) return;
      setFetchState(res.ok ? { status: 'ok', product: res.product } : { status: res.code });
    });
    return () => {
      cancelled = true;
    };
  }, [item.slug, retryNonce]);

  const titleId = 'cart-edit-dialog-title';
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      className="w-[min(34rem,calc(100vw-2rem))] rounded-lg border-2 border-border-strong bg-surface-card p-0 text-text-body shadow-lg backdrop:bg-black/40"
    >
      <div className="flex flex-col gap-4 p-6">
        <h2 id={titleId} className="font-display text-xl font-semibold text-text-strong">
          {t('editDialogTitle', { name: item.name })}
        </h2>

        {fetchState.status === 'loading' ? (
          <p role="status" className="text-sm text-text-muted">
            {t('editLoading')}
          </p>
        ) : fetchState.status === 'not_found' ? (
          <>
            <p role="alert" className="text-sm text-danger">
              {t('editNotFound')}
            </p>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={onClose}>
                {t('editCancel')}
              </Button>
              <Button
                variant="pop"
                onClick={() => {
                  remove(item.key);
                  onClose();
                }}
              >
                {t('removeLabel', { name: item.name })}
              </Button>
            </div>
          </>
        ) : fetchState.status === 'error' ? (
          <>
            <p role="alert" className="text-sm text-danger">
              {t('editError')}
            </p>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={onClose}>
                {t('editCancel')}
              </Button>
              <Button variant="pop" onClick={() => setRetryNonce((n) => n + 1)}>
                {t('editRetry')}
              </Button>
            </div>
          </>
        ) : (
          <CartEditForm
            product={fetchState.product}
            item={item}
            onDone={onClose}
            onCancel={onClose}
          />
        )}
      </div>
    </dialog>
  );
}

/** Separate component so useConfiguratorState (a hook) only mounts once the product has loaded — hooks
 *  can't be called conditionally in the parent. */
function CartEditForm({
  product,
  item,
  onDone,
  onCancel,
}: {
  product: ProductDetailView;
  item: CartItem;
  onDone: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations('cart');
  const { replace } = useCart();
  const cfg = useConfiguratorState(product, configuratorSeedFromCartItem(item));
  const [quantity, setQuantity] = useState(item.quantity);

  const onSave = () => {
    if (!cfg.canAdd) return;
    const newItem: CartItem = {
      ...buildCartItem(product, {
        colorId: cfg.hasParts ? null : cfg.selectedColorId,
        choiceIds: cfg.selectedChoiceIds,
        engraveTexts: cfg.engraveTexts,
        partColorByPart: cfg.partColorByPart,
        choiceByOption: cfg.choiceByOption,
      }),
      quantity,
    };
    replace(item.key, newItem);
    onDone();
  };

  return (
    <>
      <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
        <ConfiguratorFields product={product} state={cfg} idPrefix={`edit-${item.key}`} />
        <div className="flex items-center justify-between gap-3">
          <span className="font-display text-sm font-semibold text-text-strong">
            {t('editQuantityLabel')}
          </span>
          <QuantityStepper
            value={quantity}
            onChange={setQuantity}
            min={1}
            max={MAX_QUANTITY}
            decrementLabel={t('decrementLabel')}
            incrementLabel={t('incrementLabel')}
          />
        </div>
      </div>
      <div className="mt-1 flex justify-end gap-3">
        <Button variant="outline" onClick={onCancel}>
          {t('editCancel')}
        </Button>
        <Button variant="pop" disabled={!cfg.canAdd} onClick={onSave}>
          {t('editSave')}
        </Button>
      </div>
    </>
  );
}
