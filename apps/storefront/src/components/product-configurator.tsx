'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { formatVnd } from '@lumin/core';
import { PriceTag, cn } from '@lumin/ui';
import {
  allChoicesSelected,
  allPartsSelected,
  canAddConfiguredToCart,
  canAddToCart,
  colorsForPart,
  defaultFlatColorId,
  defaultPartColors,
  partColorsForViewer,
  isColorSelectable,
  type ColorView,
  type ProductDetailView,
} from '@/lib/product-view';
import type { CartItem } from '@/lib/cart';
import { ColorSwatches } from './color-swatches';
import { EngraveField } from './engrave-field';

// The ADR-037 configurator: colour (flat OR per-part) + enumerated choice-options + text/engrave options
// + toggle add-ons. Extracted from product-detail.tsx (PR D) so the SAME state machine + markup serve
// both the PDP and the cart edit dialog (Sửa tại chỗ) — one implementation of "what counts as a valid
// selection" (canAddConfiguredToCart etc.), never two that could drift.

export type ConfiguratorSeed = {
  colorId: string | null;
  partColorByPart?: Record<string, string>;
  choiceByOption?: Record<string, string>;
  selectedChoiceIds?: string[];
  engraveTexts?: Record<string, string>;
};

/** Build a seed from an existing CartItem — so the edit dialog opens already showing what's in the cart,
 *  not the product's defaults. Only the FIRST text option's engrave text round-trips (a CartItem stores
 *  at most one, mirroring the server's "first text option" engrave rule — see buildCartItem). */
export function configuratorSeedFromCartItem(item: CartItem): ConfiguratorSeed {
  return {
    colorId: item.colorId,
    partColorByPart: Object.fromEntries(item.partColors.map((p) => [p.partId, p.colorId])),
    choiceByOption: Object.fromEntries(item.optionChoices.map((o) => [o.optionId, o.choiceId])),
    selectedChoiceIds: item.optionIds,
    engraveTexts: item.engrave ? { [item.engrave.optionId]: item.engrave.text } : {},
  };
}

export function useConfiguratorState(product: ProductDetailView, seed?: ConfiguratorSeed) {
  const [selectedColorId, setSelectedColorId] = useState<string | null>(() =>
    seed ? seed.colorId : product.parts.length > 0 ? null : defaultFlatColorId(product.colors),
  );
  const [partColorByPart, setPartColorByPart] = useState<Record<string, string>>(
    () => seed?.partColorByPart ?? defaultPartColors(product.parts, product.colors),
  );
  const [choiceByOption, setChoiceByOption] = useState<Record<string, string>>(
    () => seed?.choiceByOption ?? {},
  );
  const [engraveTexts, setEngraveTexts] = useState<Record<string, string>>(
    () => seed?.engraveTexts ?? {},
  );
  const [selectedChoiceIds, setSelectedChoiceIds] = useState<string[]>(
    () => seed?.selectedChoiceIds ?? [],
  );
  const [engraveColorId, setEngraveColorId] = useState<string | null>(null);
  const [enginePositionByOption, setEnginePositionByOption] = useState<Record<string, number>>({});

  const viewerPartColors = useMemo(
    () => partColorsForViewer(product.parts, product.colors, partColorByPart),
    [product.parts, product.colors, partColorByPart],
  );

  const hasParts = product.parts.length > 0;
  const hasColors = product.colors.length > 0;
  const flatColorHex = hasParts
    ? undefined
    : product.colors.find((c) => c.id === selectedColorId)?.hex;
  const engraveColorHex = engraveColorId
    ? product.colors.find((c) => c.id === engraveColorId)?.hex
    : undefined;
  const anyPriceDelta = product.colors.some((c) => c.priceDelta > 0);

  const textOptions = product.options.filter((o) => o.type === 'text');
  const toggleOptions = product.options.filter(
    (o) => o.type === 'choice' && o.choices.length === 0,
  );
  const enumOptions = product.options.filter((o) => o.type === 'choice' && o.choices.length > 0);
  const engraveEntries = textOptions.map((o) => ({
    text: engraveTexts[o.id] ?? '',
    maxChars: o.maxChars,
  }));
  const viewerEngravings = textOptions.map((o) => ({
    id: o.id,
    text: engraveTexts[o.id] ?? '',
    anchor: o.engravePositions[enginePositionByOption[o.id] ?? 0],
    colorHex: engraveColorHex,
  }));

  const colorOk = hasParts
    ? allPartsSelected(product.parts, product.colors, partColorByPart)
    : canAddToCart(selectedColorId, product.colors);
  const choicesOk = allChoicesSelected(product.options, choiceByOption);
  const canAdd = canAddConfiguredToCart({
    parts: product.parts,
    colors: product.colors,
    options: product.options,
    selectedColorId,
    partColorByPart,
    choiceByOption,
    engraveEntries,
  });

  const toggleChoice = (id: string) =>
    setSelectedChoiceIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  return {
    selectedColorId,
    setSelectedColorId,
    partColorByPart,
    setPartColorByPart,
    choiceByOption,
    setChoiceByOption,
    engraveTexts,
    setEngraveTexts,
    selectedChoiceIds,
    toggleChoice,
    engraveColorId,
    setEngraveColorId,
    enginePositionByOption,
    setEnginePositionByOption,
    viewerPartColors,
    viewerEngravings,
    hasParts,
    hasColors,
    flatColorHex,
    anyPriceDelta,
    textOptions,
    toggleOptions,
    enumOptions,
    colorOk,
    choicesOk,
    canAdd,
  };
}

export type ConfiguratorState = ReturnType<typeof useConfiguratorState>;

/** The picker markup: colour(s) → enumerated choices → engrave text(s) + position + engrave colour →
 *  toggle add-ons. No media, no price header, no add-to-cart CTA — those stay with the caller (PDP has a
 *  3D viewer + specs; the cart dialog has neither). */
export function ConfiguratorFields({
  product,
  state,
  idPrefix,
}: {
  product: ProductDetailView;
  state: ConfiguratorState;
  /** DOM id prefix so the PDP and a dialog rendering the SAME product's fields never collide ids. */
  idPrefix: string;
}) {
  const t = useTranslations('productDetail');
  const tErr = useTranslations('core.errors');

  const colorLabel = (c: ColorView) =>
    isColorSelectable(c)
      ? t('selectColorLabel', { name: c.name })
      : t('colorUnavailableLabel', { name: c.name });

  const selectedNoteFor = (colors: ColorView[], selectedId: string | null) => {
    const selected = selectedId ? colors.find((c) => c.id === selectedId) : undefined;
    return selected
      ? t('colorSelectedNote', { name: selected.name, count: colors.length - 1 })
      : null;
  };

  return (
    <>
      {state.hasParts ? (
        product.parts.map((part) => {
          const partColors = colorsForPart(product.colors, part.id);
          return (
            <ColorSwatches
              key={part.id}
              heading={part.name}
              headingId={`${idPrefix}-part-${part.id}-heading`}
              colors={partColors}
              selectedId={state.partColorByPart[part.id] ?? null}
              onSelect={(id) => state.setPartColorByPart((prev) => ({ ...prev, [part.id]: id }))}
              labelFor={colorLabel}
              outOfStockNote={tErr('colorOutOfStock')}
              selectedNote={selectedNoteFor(partColors, state.partColorByPart[part.id] ?? null)}
            />
          );
        })
      ) : state.hasColors ? (
        <ColorSwatches
          heading={t('colorsLabel')}
          headingId={`${idPrefix}-colors-heading`}
          colors={product.colors}
          selectedId={state.selectedColorId}
          onSelect={state.setSelectedColorId}
          labelFor={colorLabel}
          outOfStockNote={tErr('colorOutOfStock')}
          selectedNote={selectedNoteFor(product.colors, state.selectedColorId)}
        />
      ) : null}

      {state.enumOptions.map((o) => {
        const groupName = `${idPrefix}-choice-${o.id}`;
        return (
          <fieldset key={o.id}>
            <legend className="mb-2 font-display text-sm font-semibold text-text-strong">
              {o.label}
            </legend>
            {o.description ? <p className="mb-2 text-sm text-text-muted">{o.description}</p> : null}
            <ul className="flex flex-wrap gap-2.5">
              {o.choices.map((ch) => {
                const checked = state.choiceByOption[o.id] === ch.id;
                const descId = `${groupName}-${ch.id}-desc`;
                return (
                  <li key={ch.id}>
                    <label className="cursor-pointer">
                      <input
                        type="radio"
                        name={groupName}
                        checked={checked}
                        onChange={() =>
                          state.setChoiceByOption((prev) => ({ ...prev, [o.id]: ch.id }))
                        }
                        aria-describedby={ch.description ? descId : undefined}
                        className="peer sr-only"
                      />
                      <span
                        className={cn(
                          'inline-flex min-h-11 items-center gap-1.5 rounded-sm border-2 border-border-default bg-surface-card px-5 py-2 text-[15px] font-semibold text-text-strong',
                          'transition-colors duration-150 ease-out motion-reduce:transition-none',
                          'peer-checked:border-border-strong peer-checked:bg-surface-brand peer-checked:text-on-dark',
                          'peer-focus-visible:ring-2 peer-focus-visible:ring-accent-sky peer-focus-visible:ring-offset-2',
                        )}
                      >
                        {ch.label}
                        {ch.priceDelta > 0 ? (
                          <span className="font-mono text-[11px] font-normal">
                            +{formatVnd(ch.priceDelta)}
                          </span>
                        ) : null}
                      </span>
                    </label>
                    {ch.description ? (
                      <p id={descId} className="mt-1 max-w-[220px] text-sm text-text-muted">
                        {ch.description}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </fieldset>
        );
      })}

      {state.textOptions.map((o) => (
        <div key={o.id} className="flex flex-col gap-3">
          <EngraveField
            option={o}
            value={state.engraveTexts[o.id] ?? ''}
            onChange={(next) => state.setEngraveTexts((prev) => ({ ...prev, [o.id]: next }))}
          />
          {o.engravePositions.length > 1 ? (
            <fieldset>
              <legend className="mb-2 font-display text-sm font-semibold text-text-strong">
                {t('enginePositionHeading')}
              </legend>
              <ul className="flex flex-wrap gap-2.5">
                {o.engravePositions.map((pos, i) => {
                  const groupName = `${idPrefix}-engrave-position-${o.id}`;
                  const checked = (state.enginePositionByOption[o.id] ?? 0) === i;
                  return (
                    <li key={i}>
                      <label className="cursor-pointer">
                        <input
                          type="radio"
                          name={groupName}
                          checked={checked}
                          onChange={() =>
                            state.setEnginePositionByOption((prev) => ({ ...prev, [o.id]: i }))
                          }
                          className="peer sr-only"
                        />
                        <span
                          className={cn(
                            'inline-flex min-h-11 items-center gap-1.5 rounded-sm border-2 border-border-default bg-surface-card px-5 py-2 text-[15px] font-semibold text-text-strong',
                            'transition-colors duration-150 ease-out motion-reduce:transition-none',
                            'peer-checked:border-border-strong peer-checked:bg-surface-brand peer-checked:text-on-dark',
                            'peer-focus-visible:ring-2 peer-focus-visible:ring-accent-sky peer-focus-visible:ring-offset-2',
                          )}
                        >
                          {pos.label}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          ) : null}
        </div>
      ))}

      {state.textOptions.length > 0 && state.hasColors ? (
        <ColorSwatches
          heading={t('engraveColorHeading')}
          headingId={`${idPrefix}-engrave-color-heading`}
          colors={product.colors}
          selectedId={state.engraveColorId}
          onSelect={state.setEngraveColorId}
          labelFor={colorLabel}
          outOfStockNote={tErr('colorOutOfStock')}
          selectedNote={selectedNoteFor(product.colors, state.engraveColorId)}
        />
      ) : null}

      {state.toggleOptions.length > 0 ? (
        <div role="group" aria-labelledby={`${idPrefix}-options-heading`}>
          <h2
            id={`${idPrefix}-options-heading`}
            className="mb-2 font-display text-sm font-semibold text-text-strong"
          >
            {t('optionsHeading')}
          </h2>
          <ul className="flex flex-col gap-1">
            {state.toggleOptions.map((o) => {
              const checked = state.selectedChoiceIds.includes(o.id);
              const descId = `${idPrefix}-option-${o.id}-desc`;
              return (
                <li key={o.id}>
                  <label className="flex min-h-11 cursor-pointer items-center gap-3">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => state.toggleChoice(o.id)}
                      aria-describedby={o.description ? descId : undefined}
                      className="peer sr-only"
                    />
                    <span
                      aria-hidden="true"
                      className={cn(
                        'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-xs border-2 border-border-strong bg-surface-card text-on-primary',
                        'transition-[background-color,border-color] duration-150 ease-out motion-reduce:transition-none',
                        'peer-checked:border-primary peer-checked:bg-primary peer-checked:[&_svg]:opacity-100',
                        'peer-focus-visible:ring-2 peer-focus-visible:ring-accent-sky peer-focus-visible:ring-offset-2',
                      )}
                    >
                      <svg
                        viewBox="0 0 16 16"
                        className="h-3.5 w-3.5 opacity-0"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2.5}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M3 8.5l3.5 3.5L13 4.5" />
                      </svg>
                    </span>
                    <span className="flex-1 text-text-body">{o.label}</span>
                    {o.priceDelta > 0 ? (
                      <span className="text-sm text-text-muted">
                        +<PriceTag amount={o.priceDelta} className="text-sm font-medium" />
                      </span>
                    ) : (
                      <span className="text-sm text-accent-teal">{t('optionFree')}</span>
                    )}
                  </label>
                  {o.description ? (
                    <p id={descId} className="ml-8 text-sm text-text-muted">
                      {o.description}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </>
  );
}
