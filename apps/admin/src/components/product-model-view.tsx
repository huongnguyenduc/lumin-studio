'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@lumin/ui';
import type { components } from '@lumin/api-client';
import {
  orbitToModel3dView,
  model3dViewToAttrs,
  pickedObjectName,
  pickedAnchor,
} from '@/lib/model-view';
import { saveModelView, saveEngraveAnchor } from '@/lib/product-actions';

type Model3dView = components['schemas']['Model3dView'];
type EngraveAnchor = components['schemas']['EngraveAnchor'];

/** The imperative slice of <model-viewer> we read: current camera, load state, and click hit-test. */
interface ModelViewerElement extends HTMLElement {
  loaded: boolean;
  getCameraOrbit(): { theta: number; phi: number; radius: number };
  getCameraTarget(): { x: number; y: number; z: number };
  // f-2 click-on-model: the material under a pixel. f-3 names each object's material after the object, so
  // material.name is the object name to map. (Model$1.Material has more fields; we read only .name.)
  materialFromPoint(pixelX: number, pixelY: number): { name: string } | null;
  // Engrave-anchor picking: the surface point + normal under a pixel (null on a miss).
  positionAndNormalFromPoint(
    pixelX: number,
    pixelY: number,
  ): {
    position: { x: number; y: number; z: number };
    normal: { x: number; y: number; z: number };
  } | null;
}

// Minimal typing for Google's <model-viewer> custom element — we use only these attributes/events. The
// element type is ModelViewerElement so a typed `ref` lines up. (React 18 does not map className→class for
// custom elements, so sizing goes through inline `style`.)
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
        'camera-orbit'?: string;
        'camera-target'?: string;
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
 * Preview & align the product's 3D model (P3-l l-5, ADR-038) — edit-mode only, and only once the model
 * pipeline has produced a `.glb` (model3dUrl non-empty; else a "upload first" note). Loads Google's
 * model-viewer on demand (dynamic import keeps ~1MB out of the initial bundle) and opens at the product's
 * saved camera pose so the owner sees exactly what a customer will. "Lưu góc mặc định" reads the current
 * camera and PATCHes it as the new default (owner-only at the BE). No auto-rotate / no interaction-prompt,
 * so prefers-reduced-motion is honoured by construction (the a11y rule's viewer-3D clause). No-WebGL and
 * asset-load failures degrade to a plain message.
 */
export function ProductModelView({
  productId,
  model3dUrl,
  model3dView,
  productName,
}: {
  productId: string;
  model3dUrl: string;
  model3dView?: Model3dView;
  productName: string;
}) {
  const t = useTranslations('products.edit.preview');
  const router = useRouter();
  const viewerRef = useRef<ModelViewerElement | null>(null);
  const idealRadiusRef = useRef(0);
  const [webglOk, setWebglOk] = useState(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // The initial camera comes from the saved pose (else model-viewer's 105% default). Because we KNOW the
  // percent we open at, the metres model-viewer reports at load give the ideal (100%) radius exactly —
  // no magic constant — which lets a later save express distance back as a percent.
  const attrs = model3dView ? model3dViewToAttrs(model3dView) : null;
  const initialPercent = model3dView ? model3dView.orbitRadius : 105;

  useEffect(() => {
    setWebglOk(hasWebGL());
  }, []);

  // Load the web component only when there's a model and WebGL to show it. model-viewer swallows a bad /
  // 404 / corrupt .glb into an `error` event (it does NOT reject the import) → onError maps to `failed`.
  useEffect(() => {
    if (!webglOk || !model3dUrl) return;
    let alive = true;
    import('@google/model-viewer')
      .then(() => alive && setReady(true))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [webglOk, model3dUrl]);

  // Capture the ideal radius the moment the model frames (or immediately if it loaded before this ran).
  useEffect(() => {
    const el = viewerRef.current;
    if (!el || !ready) return;
    const capture = () => {
      const r = el.getCameraOrbit().radius;
      idealRadiusRef.current = Number.isFinite(r) && r > 0 ? (r * 100) / initialPercent : 0;
    };
    if (el.loaded) capture();
    el.addEventListener('load', capture);
    return () => el.removeEventListener('load', capture);
  }, [ready, initialPercent]);

  function onSaveView() {
    const el = viewerRef.current;
    if (!el) return;
    const view = orbitToModel3dView(
      el.getCameraOrbit(),
      el.getCameraTarget(),
      idealRadiusRef.current,
    );
    setSaved(false);
    setSaveError(null);
    start(async () => {
      const res = await saveModelView(productId, view);
      if (res.ok) {
        setSaved(true);
        router.refresh();
      } else {
        setSaveError(res.code);
      }
    });
  }

  if (!model3dUrl) {
    return <p className="text-sm text-text-muted">{t('noModel')}</p>;
  }
  if (!webglOk) {
    return <p className="text-sm text-text-muted">{t('noWebgl')}</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-text-muted">{t('hint')}</p>
      <div className="aspect-square overflow-hidden rounded-lg bg-surface-sunken">
        {failed ? (
          <p
            role="alert"
            className="flex h-full w-full items-center justify-center px-4 text-center text-sm text-text-muted"
          >
            {t('error')}
          </p>
        ) : ready ? (
          <model-viewer
            ref={viewerRef}
            src={model3dUrl}
            alt={t('alt', { name: productName })}
            camera-controls={true}
            interaction-prompt="none"
            camera-orbit={attrs?.orbit}
            camera-target={attrs?.target}
            onError={() => setFailed(true)}
            style={{ width: '100%', height: '100%' }}
          />
        ) : (
          <p
            role="status"
            className="flex h-full w-full items-center justify-center text-sm text-text-muted"
          >
            {t('loading')}
          </p>
        )}
      </div>

      {ready && !failed && (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" onClick={onSaveView} disabled={pending}>
            {pending ? t('saving') : t('saveView')}
          </Button>
          {saved && (
            <span role="status" className="text-sm text-accent-teal">
              {t('saved')}
            </span>
          )}
          {saveError && (
            <span role="alert" className="text-sm text-danger">
              {t(`saveErr.${saveError}`)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Click-to-map a part to a named 3D object (f-2 click-on-model follow-up) — the pointer alternative to the
 * PartForm dropdown, for owners who'd rather click the thing they see than know its internal name. Loads the
 * STRUCTURED glb (f-4: named objects, each object's material named after it — f-3) so a click hit-tests to a
 * material name = object name; a click (not a drag/orbit — `pickedObjectName` guards that) calls onPick(name)
 * and the parent writes it to the SAME `objectName` the dropdown sets. Rendered only when a structured glb
 * exists and WebGL is available — otherwise the dropdown alone stands (and it is the keyboard-accessible
 * path). No auto-rotate / no interaction-prompt → prefers-reduced-motion honoured by construction.
 */
export function PartObjectPicker({
  src,
  selected,
  onPick,
}: {
  src: string;
  selected: string;
  onPick: (objectName: string) => void;
}) {
  const t = useTranslations('products.edit.colors');
  const viewerRef = useRef<ModelViewerElement | null>(null);
  const downRef = useRef<{ x: number; y: number } | null>(null);
  const [webglOk, setWebglOk] = useState(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setWebglOk(hasWebGL());
  }, []);

  // Same ~1MB on-demand import as the align viewer, only with WebGL to show it.
  useEffect(() => {
    if (!webglOk) return;
    let alive = true;
    import('@google/model-viewer')
      .then(() => alive && setReady(true))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [webglOk]);

  function onClick(e: React.MouseEvent<ModelViewerElement>) {
    const el = viewerRef.current;
    if (!el) return;
    const name = pickedObjectName(downRef.current, { x: e.clientX, y: e.clientY }, (x, y) =>
      el.materialFromPoint(x, y),
    );
    if (name) onPick(name);
  }

  if (!webglOk) return null; // no WebGL → the dropdown alone maps the object

  return (
    <div className="flex flex-col gap-1.5">
      <div className="aspect-square overflow-hidden rounded-md bg-surface-sunken">
        {failed ? (
          <p
            role="alert"
            className="flex h-full w-full items-center justify-center px-4 text-center text-sm text-text-muted"
          >
            {t('objectPickError')}
          </p>
        ) : ready ? (
          <model-viewer
            ref={viewerRef}
            src={src}
            alt={t('objectPickAlt')}
            camera-controls={true}
            interaction-prompt="none"
            onPointerDown={(e) => {
              downRef.current = { x: e.clientX, y: e.clientY };
            }}
            onClick={onClick}
            style={{ width: '100%', height: '100%', cursor: 'crosshair' }}
          />
        ) : (
          <p
            role="status"
            className="flex h-full w-full items-center justify-center text-sm text-text-muted"
          >
            {t('objectPickLoading')}
          </p>
        )}
      </div>
      <p className="text-xs text-text-muted">
        {selected ? t('objectPickSelected', { name: selected }) : t('objectPickHint')}
      </p>
    </div>
  );
}

/**
 * Pick WHERE engraving text sits on the model (edit-mode only, needs the pipeline's glb). A tap on the
 * model (not a drag/orbit — `pickedAnchor` guards that) hit-tests the surface via
 * `positionAndNormalFromPoint` and drops an "Aa" marker hotspot there; "Lưu vị trí khắc" PATCHes it as
 * the product's engrave anchor (owner-only at the BE) — the storefront then projects the customer's
 * text at exactly that spot. No WebGL → a plain note (there is no keyboard path to pick a 3D surface
 * point; the storefront's front-centre fallback still applies to products without an anchor). No
 * auto-rotate / no interaction-prompt → prefers-reduced-motion honoured by construction.
 */
export function EngraveAnchorPicker({
  productId,
  model3dUrl,
  engraveAnchor,
  productName,
}: {
  productId: string;
  model3dUrl: string;
  engraveAnchor?: EngraveAnchor;
  productName: string;
}) {
  const t = useTranslations('products.edit.engraveAnchor');
  const router = useRouter();
  const viewerRef = useRef<ModelViewerElement | null>(null);
  const downRef = useRef<{ x: number; y: number } | null>(null);
  const [webglOk, setWebglOk] = useState(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  // The anchor being previewed: starts at the saved one, replaced by each tap. Saved separately.
  const [anchor, setAnchor] = useState<EngraveAnchor | undefined>(engraveAnchor);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    setWebglOk(hasWebGL());
  }, []);

  useEffect(() => {
    if (!webglOk || !model3dUrl) return;
    let alive = true;
    import('@google/model-viewer')
      .then(() => alive && setReady(true))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [webglOk, model3dUrl]);

  function onClick(e: React.MouseEvent<ModelViewerElement>) {
    const el = viewerRef.current;
    if (!el) return;
    const next = pickedAnchor(downRef.current, { x: e.clientX, y: e.clientY }, (x, y) =>
      el.positionAndNormalFromPoint(x, y),
    );
    if (next) {
      setAnchor(next);
      setDirty(true);
      setSaved(false);
    }
  }

  function onSave() {
    if (!anchor) return;
    setSaved(false);
    setSaveError(null);
    start(async () => {
      const res = await saveEngraveAnchor(productId, anchor);
      if (res.ok) {
        setSaved(true);
        setDirty(false);
        router.refresh();
      } else {
        setSaveError(res.code);
      }
    });
  }

  if (!model3dUrl) {
    return <p className="text-sm text-text-muted">{t('noModel')}</p>;
  }
  if (!webglOk) {
    return <p className="text-sm text-text-muted">{t('noWebgl')}</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-text-muted">{t('hint')}</p>
      <div className="aspect-square overflow-hidden rounded-lg bg-surface-sunken">
        {failed ? (
          <p
            role="alert"
            className="flex h-full w-full items-center justify-center px-4 text-center text-sm text-text-muted"
          >
            {t('error')}
          </p>
        ) : ready ? (
          <model-viewer
            ref={viewerRef}
            src={model3dUrl}
            alt={t('alt', { name: productName })}
            camera-controls={true}
            interaction-prompt="none"
            onPointerDown={(e) => {
              downRef.current = { x: e.clientX, y: e.clientY };
            }}
            onClick={onClick}
            onError={() => setFailed(true)}
            style={{ width: '100%', height: '100%', cursor: 'crosshair' }}
          >
            {/* "Aa" marker at the picked spot — tracks the camera, fades when facing away. Decorative
                (the status line below announces the state). */}
            {anchor ? (
              <div
                slot="hotspot-engrave"
                data-position={`${anchor.posX}m ${anchor.posY}m ${anchor.posZ}m`}
                data-normal={`${anchor.normX} ${anchor.normY} ${anchor.normZ}`}
                aria-hidden="true"
                className="pointer-events-none -translate-x-1/2 -translate-y-1/2 rounded-sm bg-black/50 px-1.5 py-0.5 font-display text-xs font-bold text-white"
              >
                {t('marker')}
              </div>
            ) : null}
          </model-viewer>
        ) : (
          <p
            role="status"
            className="flex h-full w-full items-center justify-center text-sm text-text-muted"
          >
            {t('loading')}
          </p>
        )}
      </div>

      {ready && !failed && (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" onClick={onSave} disabled={pending || !anchor || !dirty}>
            {pending ? t('saving') : t('save')}
          </Button>
          <span role="status" className="text-sm text-text-muted">
            {saved ? (
              <span className="text-accent-teal">{t('saved')}</span>
            ) : anchor ? (
              dirty ? (
                t('pickedUnsaved')
              ) : (
                t('savedExisting')
              )
            ) : (
              t('empty')
            )}
          </span>
          {saveError && (
            <span role="alert" className="text-sm text-danger">
              {t(`saveErr.${saveError}`)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
