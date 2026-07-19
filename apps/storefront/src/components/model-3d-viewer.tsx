'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { SpriteTurntable } from './sprite-turntable';

/** The sliver of model-viewer's scene-graph API f-3 uses: recolor a named material at runtime. `model` is
 *  present only after the element's `load` event; `getMaterialByName` returns null for an unknown name (the
 *  fused glb / an unmapped object). setBaseColorFactor takes a hex string OR an RGBA array (model-viewer ≥ 3). */
interface MaterialLike {
  pbrMetallicRoughness: {
    setBaseColorFactor(value: string | [number, number, number, number]): void;
  };
}

interface ModelViewerElement extends HTMLElement {
  model?: {
    materials: MaterialLike[];
    getMaterialByName(name: string): MaterialLike | null;
  };
  getBoundingBoxCenter(): { x: number; y: number; z: number };
  getDimensions(): { x: number; y: number; z: number };
}

// Minimal typing for Google's <model-viewer> custom element — we use only these attributes. The element type
// is ModelViewerElement so a typed `ref` lines up. (React 18 does not map className→class for custom elements,
// so sizing goes through inline `style`, not a class.)
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'model-viewer': React.DetailedHTMLProps<
        React.HTMLAttributes<ModelViewerElement>,
        ModelViewerElement
      > & {
        src?: string;
        alt?: string;
        'camera-controls'?: boolean;
        'interaction-prompt'?: string;
        onError?: () => void;
      };
    }
  }
}

/** True when the browser can make a WebGL context (model-viewer needs it). One-shot, client-only. */
function hasWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl') || canvas.getContext('experimental-webgl'));
  } catch {
    return false;
  }
}

/**
 * Live 3D viewer (P1-i, revised 2026-07-17 — user decision): the PDP's MAIN media tile. It auto-loads
 * Google's model-viewer web component on mount when the browser has WebGL — no "Xem 3D" click gate any
 * more (the storefront rule's click-only clause was relaxed for the detail page; cards stay sprite-first).
 * The ~1MB module is still pulled via a dynamic import so it stays out of the initial JS bundle and only
 * costs product pages that actually have a model. No auto-rotate and no interaction-prompt ⇒ no autonomous
 * motion, so prefers-reduced-motion is honoured by construction (the a11y rule's viewer-3D clause). When
 * the browser lacks WebGL, the 360° sprite sheet (ADR-049) is the fallback if the product has one — a
 * self-turning turntable, stilled under reduced-motion — else `fallback` (the parent's static cover) is
 * rendered. The component fills its parent (the parent owns the framed tile). `src` is the product's
 * `.glb` URL (the parent prefers the STRUCTURED glb so per-part recolor works, else the fused glb),
 * already gated non-empty by the parent; `partColors` maps object name → hex for per-part recolor (f-3).
 */
export function Model3dViewer({
  src,
  productName,
  spriteSheetUrl,
  partColors,
  flatColorHex,
  engraveText,
  fallback,
}: {
  src: string;
  productName: string;
  spriteSheetUrl?: string;
  partColors?: Record<string, string>;
  /** FLAT (single-piece) product recolor: the picked colour's hex, applied to EVERY material of the
   *  model (a flat product has no part→object mapping, so the whole piece is the colour — mirrors what
   *  the printer does). Undefined for a parts product (partColors drives those) or before any pick. */
  flatColorHex?: string;
  /** Live engraving preview (P1-j): the typed text, pinned as a model-viewer HOTSPOT to the front of
   *  the model's bounding box so it tracks the camera and fades when rotated away. Realtime by
   *  construction — plain React state → DOM, client-side only (storefront rule: no server render per
   *  keystroke). ponytail: billboard hotspot, not baked-into-surface; a real engraved look needs a
   *  per-product UV engrave zone in the Blender pipeline. Empty/undefined → no hotspot. */
  engraveText?: string;
  /** Rendered while loading, on failure, and when the browser has neither WebGL nor a sprite —
   *  typically the parent's static cover image. */
  fallback?: React.ReactNode;
}) {
  const t = useTranslations('productDetail');
  const viewerRef = useRef<ModelViewerElement | null>(null);
  // null = undetermined (SSR/first paint — render the fallback, no hydration mismatch).
  const [webglOk, setWebglOk] = useState<boolean | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  // "x y z" for the hotspot's data-position — front-centre of the model's bounding box, computed once
  // per loaded model (the box doesn't move; only the text content changes per keystroke).
  const [engraveAnchor, setEngraveAnchor] = useState<string | null>(null);

  // WebGL is client-only; detect after mount, then start loading the web component right away.
  // The ingest glbs (fused AND structured) are Draco-compressed (worker LOD pass), so point
  // model-viewer at the SELF-HOSTED decoder in public/draco/ (vendored from three) — its default
  // decoder loads WASM from gstatic.com at runtime, against the self-host/PDPL posture.
  // MUST be the GLOBAL config object, set before the element is constructed: model-viewer's
  // constructor re-reads `self.ModelViewerElement.dracoDecoderLocation` and silently resets to the
  // gstatic default when the global is absent (loading.js) — the static class setter alone is undone.
  useEffect(() => {
    const ok = hasWebGL();
    setWebglOk(ok);
    if (!ok) return;
    let alive = true;
    const g = window as unknown as { ModelViewerElement?: { dracoDecoderLocation?: string } };
    g.ModelViewerElement = { ...g.ModelViewerElement, dracoDecoderLocation: '/draco/' };
    import('@google/model-viewer')
      .then(() => alive && setReady(true))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  // f-3 (ADR-052): recolor each mapped part's material to the customer's picked colour. model-viewer exposes
  // the loaded scene only after its `load` event, so apply on load AND whenever the selection (partColors)
  // changes — by then the model is already loaded. getMaterialByName returns null for the fused glb / an
  // unmapped or renamed object → that part is skipped (no crash, keeps its baked colour). Setting a base
  // colour adds NO motion, so prefers-reduced-motion is unaffected (the a11y viewer-3D clause).
  useEffect(() => {
    const el = viewerRef.current;
    if (!ready || !el || (!partColors && !flatColorHex)) return;
    const apply = () => {
      const model = el.model;
      if (!model) return;
      // Flat product: one colour for the whole piece → every material (no object mapping exists).
      if (flatColorHex) {
        for (const material of model.materials) {
          material.pbrMetallicRoughness.setBaseColorFactor(flatColorHex);
        }
      }
      for (const [objectName, hex] of Object.entries(partColors ?? {})) {
        model.getMaterialByName(objectName)?.pbrMetallicRoughness.setBaseColorFactor(hex);
      }
    };
    if (el.model) apply(); // already loaded (e.g. a selection change after the first load)
    el.addEventListener('load', apply);
    return () => el.removeEventListener('load', apply);
  }, [ready, partColors, flatColorHex]);

  // Engrave hotspot anchor: front-centre of the loaded model's bounding box (normal +Z). Computed on
  // `load` — before that model-viewer has no geometry to measure. model-viewer registers a slotted
  // hotspot with its attributes at slot time, so the anchor must be known BEFORE the hotspot div
  // renders; gating the div on `engraveAnchor` guarantees that order.
  useEffect(() => {
    const el = viewerRef.current;
    if (!ready || !el) return;
    const measure = () => {
      const c = el.getBoundingBoxCenter();
      const d = el.getDimensions();
      setEngraveAnchor(`${c.x}m ${c.y}m ${c.z + d.z / 2}m`);
    };
    if (el.model) measure();
    el.addEventListener('load', measure);
    return () => el.removeEventListener('load', measure);
  }, [ready]);

  // No WebGL → the 360° sprite sheet is the fallback (ADR-007/ADR-049): a self-turning turntable so a
  // WebGL-less browser still gets a rotating preview (stilled under reduced-motion). No sprite → the
  // parent's static cover (fallback). SSR / undetermined renders the fallback too (no hydration mismatch).
  if (webglOk !== true) {
    return webglOk === false && spriteSheetUrl ? (
      <SpriteTurntable
        src={spriteSheetUrl}
        alt={t('sprite360Alt', { name: productName })}
        active
        className="h-full w-full"
      />
    ) : (
      <>{fallback}</>
    );
  }

  return (
    <div className="relative h-full w-full">
      {failed ? (
        // A broken chunk / corrupt .glb degrades to the static cover when the parent gave one — a shopper
        // with photos available should never stare at an error tile. role=alert only when there is nothing
        // better to show.
        fallback ? (
          <>{fallback}</>
        ) : (
          <p
            role="alert"
            className="flex h-full w-full items-center justify-center px-4 text-center text-sm text-text-muted"
          >
            {t('view3dError')}
          </p>
        )
      ) : ready ? (
        // model-viewer swallows a bad / 404 / corrupt .glb into an `error` event (it does NOT reject the
        // import) → wire onError to the same failed state so view3dError is reachable for asset failure,
        // not only for the chunk-load failure the dynamic import catches.
        <>
          <model-viewer
            ref={viewerRef}
            src={src}
            alt={t('view3dAlt', { name: productName })}
            camera-controls={true}
            interaction-prompt="none"
            onError={() => setFailed(true)}
            style={{ width: '100%', height: '100%' }}
          >
            {/* Live engraving preview: the typed text pinned to the model's front face. Tracks camera
                rotation; model-viewer fades hotspots that face away (--min-hotspot-opacity). aria-hidden:
                it duplicates the engrave input's value (a sighted affordance, like the nameplate). */}
            {engraveText?.trim() && engraveAnchor ? (
              <div
                slot="hotspot-engrave"
                data-position={engraveAnchor}
                data-normal="0 0 1"
                aria-hidden="true"
                className="pointer-events-none -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-sm bg-black/40 px-2 py-0.5 font-display text-sm font-bold tracking-wide text-white"
              >
                {engraveText}
              </div>
            ) : null}
          </model-viewer>
          {/* Hi-fi drag hint, bottom-left of the running viewer. Decorative — the controls are
              announced by model-viewer's own alt/aria — so it stays out of the accessibility tree. */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute bottom-3 left-3 font-mono text-[11px] text-text-muted"
          >
            {t('viewer3dCaption')}
          </span>
        </>
      ) : // While the module loads, keep the static cover in place (no spinner flash) when the parent
      // gave one; a coverless product gets the status text.
      fallback ? (
        <>{fallback}</>
      ) : (
        <p
          role="status"
          className="flex h-full w-full items-center justify-center text-sm text-text-muted"
        >
          {t('view3dLoading')}
        </p>
      )}
    </div>
  );
}
