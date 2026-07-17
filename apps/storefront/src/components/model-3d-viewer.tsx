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

  // WebGL is client-only; detect after mount, then start loading the web component right away.
  // ponytail: model-viewer's DEFAULT Draco/KTX2 decoders load from gstatic.com — a *compressed* .glb
  // would fetch WASM from Google at runtime, against the self-host/PDPL posture. The ingest glb (fused
  // AND structured) is UNCOMPRESSED, so it loads entirely from `src` with zero third-party fetch.
  // Upgrade path if a later LOD pass compresses: self-host the decoders (setDRACODecoderLocation).
  useEffect(() => {
    const ok = hasWebGL();
    setWebglOk(ok);
    if (!ok) return;
    let alive = true;
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
          />
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
