'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

// Minimal typing for Google's <model-viewer> custom element — we use only these attributes. (React 18
// does not map className→class for custom elements, so sizing goes through inline `style`, not a class.)
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'model-viewer': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        src?: string;
        alt?: string;
        'camera-controls'?: boolean;
        'interaction-prompt'?: string;
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
 * On-demand 3D viewer (P1-i, degrade-only). The parent always shows the static photo gallery; this only
 * ADDS a "Xem mẫu 3D" button that loads Google's model-viewer web component on click — never before
 * (storefront rule: `model-viewer` chỉ load khi khách bấm; đừng auto-load WebGL nặng). The ~1MB module
 * is pulled via a dynamic import so it stays out of the initial bundle. No auto-rotate and no
 * interaction-prompt ⇒ no autonomous motion, so prefers-reduced-motion is honoured by construction (the
 * a11y rule's viewer-3D clause). When the browser lacks WebGL the button is hidden and the static gallery
 * is the fallback — the spec's sprite fallback doesn't exist in degrade-only (no spriteUrl in the
 * contract yet). `src` is the product's `.glb` URL, already gated non-empty by the parent.
 */
export function Model3dViewer({ src, productName }: { src: string; productName: string }) {
  const t = useTranslations('productDetail');
  const containerRef = useRef<HTMLDivElement>(null);
  const [webglOk, setWebglOk] = useState(false);
  const [shown, setShown] = useState(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  // WebGL is client-only; start false so SSR + first paint render no button (no hydration mismatch),
  // then reveal after mount when supported.
  useEffect(() => {
    setWebglOk(hasWebGL());
  }, []);

  // Load the web component only once the customer asks for it, and move focus into the revealed region
  // so a keyboard / screen-reader user isn't dropped to <body> when the "Xem 3D" button unmounts.
  // ponytail: model-viewer's DEFAULT Draco/KTX2 decoders load from gstatic.com — a *compressed* .glb
  // would fetch WASM from Google at runtime (post-click), against the self-host/PDPL posture. No asset is
  // compressed today (there are no .glb at all yet). Upgrade path when real assets land: self-host the
  // decoders (CachingGLTFLoader.setDRACODecoderLocation), OR require the render-worker to emit
  // UNCOMPRESSED .glb, which loads entirely from `src` with zero third-party fetch.
  useEffect(() => {
    if (!shown) return;
    containerRef.current?.focus();
    let alive = true;
    import('@google/model-viewer')
      .then(() => alive && setReady(true))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [shown]);

  if (!webglOk) return null;

  if (!shown) {
    return (
      <button
        type="button"
        onClick={() => setShown(true)}
        className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-md border-2 border-border-default px-4 text-sm font-medium text-text-strong hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2"
      >
        {t('view3dLabel')}
      </button>
    );
  }

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      className="mt-3 aspect-square overflow-hidden rounded-lg bg-surface-sunken focus:outline-none"
    >
      {failed ? (
        <p
          role="alert"
          className="flex h-full w-full items-center justify-center px-4 text-center text-sm text-text-muted"
        >
          {t('view3dError')}
        </p>
      ) : ready ? (
        // model-viewer swallows a bad / 404 / corrupt .glb into an `error` event (it does NOT reject the
        // import) → wire onError to the same failed state so view3dError is reachable for asset failure,
        // not only for the chunk-load failure the dynamic import catches.
        <model-viewer
          src={src}
          alt={t('view3dAlt', { name: productName })}
          camera-controls={true}
          interaction-prompt="none"
          onError={() => setFailed(true)}
          style={{ width: '100%', height: '100%' }}
        />
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
