'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Badge, Button, Input, cn } from '@lumin/ui';
import type { Viewer3d } from '@lumin/ui/viewer3d';
import type { components } from '@lumin/api-client';
import {
  orbitToModel3dView,
  model3dViewToAttrs,
  pickedObjectName,
  pickedAnchor,
  loadModelViewer,
} from '@/lib/model-view';
import { saveModelView, saveEngraveAnchor } from '@/lib/product-actions';
import { getAssetJobs } from '@/lib/asset-actions';

type Model3dView = components['schemas']['Model3dView'];
type JobStatusName = components['schemas']['AssetJob']['status'];
// Badge hue per job status — mirrors the upload card (product-model.tsx).
const SPRITE_TONE = {
  queued: 'neutral',
  processing: 'sky',
  ready: 'teal',
  failed: 'danger',
} as const;
type EngraveAnchor = components['schemas']['EngraveAnchor'];
type Color = components['schemas']['Color'];

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
  // Default-paint (f-3): recolour materials by name (structured glb names materials after objects).
  // setBaseColorFactor accepts a CSS colour string — model-viewer converts to linear itself.
  model?: {
    materials: {
      name: string;
      pbrMetallicRoughness: { setBaseColorFactor(color: string): void };
    }[];
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

/** True when the browser can make a WebGL context (the 3D viewers need it). Client-only. */
function hasWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl') || canvas.getContext('experimental-webgl'));
  } catch {
    return false;
  }
}

/** WebGL availability as state. Context creation can FAIL in a hidden/background tab, so a one-shot
 *  mount probe would wrongly lock the page into "no WebGL" — re-probe when the tab becomes visible. */
function useWebglOk(): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    if (hasWebGL()) {
      setOk(true);
      return;
    }
    const probe = () => {
      if (hasWebGL()) {
        setOk(true);
        document.removeEventListener('visibilitychange', probe);
      }
    };
    document.addEventListener('visibilitychange', probe);
    return () => document.removeEventListener('visibilitychange', probe);
  }, []);
  return ok;
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
  model3dStructuredUrl,
  model3dView,
  productName,
  defaultColors,
}: {
  productId: string;
  model3dUrl: string;
  /** f-4 structured glb (materials named after objects) — preferred when present so the default paint
   *  below recolours per part exactly like the storefront viewer; plain glb otherwise. */
  model3dStructuredUrl?: string;
  model3dView?: Model3dView;
  productName: string;
  /** Default paint (defaultModelColors) — the pose is aligned on the model AS THE CUSTOMER SEES IT. */
  defaultColors?: { flatHex?: string; byObject: Record<string, string> };
}) {
  const t = useTranslations('products.edit.preview');
  const tm = useTranslations('products.edit.model');
  const router = useRouter();
  const viewerRef = useRef<ModelViewerElement | null>(null);
  const idealRadiusRef = useRef(0);
  const webglOk = useWebglOk();
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [saved, setSaved] = useState(false);
  // True when the angle save also kicked off a sprite_render — the 360° sprite is being redone at the new angle.
  const [rerender, setRerender] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // The initial camera comes from the saved pose (else model-viewer's 105% default). Because we KNOW the
  // percent we open at, the metres model-viewer reports at load give the ideal (100%) radius exactly —
  // no magic constant — which lets a later save express distance back as a percent.
  const attrs = model3dView ? model3dViewToAttrs(model3dView) : null;
  const initialPercent = model3dView ? model3dView.orbitRadius : 105;

  // Load the web component only when there's a model and WebGL to show it. model-viewer swallows a bad /
  // 404 / corrupt .glb into an `error` event (it does NOT reject the import) → onError maps to `failed`.
  useEffect(() => {
    if (!webglOk || !model3dUrl) return;
    let alive = true;
    loadModelViewer()
      .then(() => alive && setReady(true))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [webglOk, model3dUrl]);

  // The pose is aligned on the model AS THE CUSTOMER SEES IT: structured glb when present (materials
  // named after objects — per-part default paint lands on the right meshes) + the default colours.
  const viewerSrc = model3dStructuredUrl || model3dUrl;

  // Capture the ideal radius the moment the model frames (or immediately if it loaded before this ran),
  // and paint the default colours in the same load hook.
  useEffect(() => {
    const el = viewerRef.current;
    if (!el || !ready) return;
    const capture = () => {
      const r = el.getCameraOrbit().radius;
      idealRadiusRef.current = Number.isFinite(r) && r > 0 ? (r * 100) / initialPercent : 0;
      for (const m of el.model?.materials ?? []) {
        const hex = defaultColors?.byObject[m.name] ?? defaultColors?.flatHex;
        if (hex) m.pbrMetallicRoughness.setBaseColorFactor(hex);
      }
    };
    if (el.loaded) capture();
    el.addEventListener('load', capture);
    return () => el.removeEventListener('load', capture);
  }, [ready, initialPercent, defaultColors]);

  // The sprite_render job kicked off by an angle save — polled here so the owner SEES the 360° redo
  // progress right where they changed the angle (it used to be invisible: the job list lives in the
  // upload card, whose poll loop had already stopped). Unbounded while this card is mounted and the
  // redo is in flight — a GPU render can outlast any fixed cap; on settle, refresh the RSC so the
  // sprite preview (upload card) shows the new render.
  const [spriteJob, setSpriteJob] = useState<{ status: JobStatusName } | null>(null);
  const spritePolling =
    rerender && (!spriteJob || spriteJob.status === 'queued' || spriteJob.status === 'processing');
  useEffect(() => {
    if (!spritePolling) return;
    const id = setTimeout(async () => {
      const jobs = await getAssetJobs(productId);
      const s = jobs.find((j) => j.jobType === 'sprite_render') ?? null;
      setSpriteJob(s);
      if (s && s.status !== 'queued' && s.status !== 'processing') router.refresh();
    }, 5000);
    return () => clearTimeout(id);
  }, [spritePolling, spriteJob, productId, router]);

  function onSaveView() {
    const el = viewerRef.current;
    if (!el) return;
    const view = orbitToModel3dView(
      el.getCameraOrbit(),
      el.getCameraTarget(),
      idealRadiusRef.current,
    );
    setSaved(false);
    setRerender(false);
    setSaveError(null);
    setSpriteJob(null);
    start(async () => {
      const res = await saveModelView(productId, view);
      if (res.ok) {
        setSaved(true);
        setRerender(res.rerender);
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
            src={viewerSrc}
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
              {rerender ? t('savedRerender') : t('saved')}
            </span>
          )}
          {/* Live status of the 360° redo the save kicked off (reuses the upload card's job i18n). */}
          {rerender && (
            <span role="status" className="flex items-center gap-2 text-sm">
              <span className="font-medium text-text-strong">{tm('jobType.sprite_render')}</span>
              <Badge tone={spriteJob ? SPRITE_TONE[spriteJob.status] : 'neutral'}>
                {tm(`jobStatus.${spriteJob?.status ?? 'queued'}`)}
              </Badge>
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
  const webglOk = useWebglOk();
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  // Same ~1MB on-demand import as the align viewer, only with WebGL to show it.
  useEffect(() => {
    if (!webglOk) return;
    let alive = true;
    loadModelViewer()
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

/** One text option's identity for the anchor picker — just what it needs to render a tab and seed its
 *  draft positions; the full Option lives in product-editor.tsx. */
export interface EngraveOptionRef {
  id: string;
  label: string;
  engravePositions: EngraveAnchor[];
}

/**
 * Pick a text option's engrave POSITIONS — a NAMED list of spots the storefront customer later chooses
 * ONE of — and preview all of them raised on the model (edit-mode only, needs the pipeline's glb). Runs
 * the SAME three.js viewer as the storefront PDP (`@lumin/ui/viewer3d`), so the owner sees exactly what
 * a customer will. Pill tabs pick which option the picker edits when a product has more than one text
 * option; within the active option, typing a name and tapping the model APPENDS a new named spot to
 * that option's list (a tap not a drag/orbit — `pickedAnchor` guards that), each listed with a delete
 * button. "Lưu vị trí khắc" PATCHes the WHOLE list for the active option (owner-only at the BE, replaces
 * atomically). No WebGL → a plain note; no text options yet → a hint to add one first. Orbit is
 * user-driven only → prefers-reduced-motion honoured by construction.
 */
export function EngraveAnchorPicker({
  productId,
  model3dUrl,
  options,
  productName,
  colors = [],
  model3dView,
  defaultColors,
  model3dStructuredUrl,
}: {
  productId: string;
  model3dUrl: string;
  /** Every `text`-type option on the product (product-editor.tsx filters product.options). */
  options: EngraveOptionRef[];
  productName: string;
  /** The product's own paint colours (ADR-037/ADR-039) — reused as the engrave-text colour picker so
   *  there is no separate config to maintain. */
  colors?: Color[];
  /** The owner-saved default camera pose (ADR-038) — the picker opens at the SAME angle the storefront
   *  (and the engrave heuristic) uses, so what the owner sees is what the customer sees. */
  model3dView?: Model3dView;
  /** Default paint (defaultModelColors) — applied to the model so anchors are picked on the product's
   *  real colours, not the glb's baked material. */
  defaultColors?: { flatHex?: string; byObject: Record<string, string> };
  /** f-4 structured glb — preferred so per-part paint lands on the right meshes (same as storefront). */
  model3dStructuredUrl?: string;
}) {
  const t = useTranslations('products.edit.engraveAnchor');
  const router = useRouter();
  const mountRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<Viewer3d | null>(null);
  const webglOk = useWebglOk();
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  // Which option a tap places into right now.
  const [activeOptionId, setActiveOptionId] = useState<string | null>(options[0]?.id ?? null);
  const optionIds = options.map((o) => o.id).join(',');
  useEffect(() => {
    if (activeOptionId && options.some((o) => o.id === activeOptionId)) return;
    setActiveOptionId(options[0]?.id ?? null);
    // optionIds (not `options`, a fresh array every render) is the real dependency — the id SET.
  }, [optionIds]);

  // Draft positions per option: seeded once from the saved ones, then only ADDING an id newly appearing
  // (a text option just created) — never clobbering a local unsaved edit when the parent re-renders.
  const [positions, setPositions] = useState<Record<string, EngraveAnchor[]>>(() =>
    Object.fromEntries(options.map((o) => [o.id, o.engravePositions])),
  );
  useEffect(() => {
    setPositions((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const o of options) {
        if (!(o.id in next)) {
          next[o.id] = o.engravePositions;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [optionIds]);
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  // The name typed for the NEXT tap-placed position (e.g. "Mặt trước") — cleared after each placement.
  const [draftLabel, setDraftLabel] = useState('');
  // Sample text for the raised-lettering preview — admin-local, never persisted.
  const [sample, setSample] = useState('');
  // Sample colour for the preview — also admin-local; the customer picks their own on the storefront.
  const [sampleColorHex, setSampleColorHex] = useState<string | null>(null);
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Boot the shared viewer into the mount node and wire tap-to-pick. The dynamic import keeps
  // three.js out of the initial admin bundle (same discipline as the storefront viewer).
  useEffect(() => {
    if (!webglOk || !model3dUrl) return;
    const mount = mountRef.current;
    if (!mount) return;
    let alive = true;
    let observer: ResizeObserver | null = null;
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY };
    };
    const onClick = (e: MouseEvent) => {
      const el = viewerRef.current;
      const id = activeOptionIdRef.current;
      if (!el || !id) return;
      const next = pickedAnchor(down, { x: e.clientX, y: e.clientY }, (x, y) => {
        const p = el.pickAt(x, y);
        return p
          ? {
              position: { x: p.posX, y: p.posY, z: p.posZ },
              normal: { x: p.normX, y: p.normY, z: p.normZ },
            }
          : null;
      });
      if (next) {
        setPositions((prev) => {
          const list = prev[id] ?? [];
          // A typed name labels the new spot; empty → auto-name "Vị trí N" (renameable-by-delete-and-
          // redo). The old flow silently ignored taps until a name was typed — the top confusion report.
          const label =
            draftLabelRef.current.trim() || autoLabelRef.current({ n: list.length + 1 });
          return { ...prev, [id]: [...list, { label, ...next }] };
        });
        setDirty((prev) => ({ ...prev, [id]: true }));
        setSaved((prev) => ({ ...prev, [id]: false }));
        setDraftLabel('');
      }
    };
    import('@lumin/ui/viewer3d')
      .then(({ Viewer3d }) => {
        if (!alive || !mountRef.current) return;
        const viewer = new Viewer3d(mountRef.current, () => alive && setFailed(true));
        viewerRef.current = viewer;
        observer = new ResizeObserver(() => viewer.resize());
        observer.observe(mountRef.current);
        mount.addEventListener('pointerdown', onDown);
        mount.addEventListener('click', onClick);
        // Structured glb when present (f-4) so setColors' per-part paint keys onto the right materials.
        void viewer.load(model3dStructuredUrl || model3dUrl).then(() => alive && setReady(true));
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
      observer?.disconnect();
      mount.removeEventListener('pointerdown', onDown);
      mount.removeEventListener('click', onClick);
      viewerRef.current?.dispose();
      viewerRef.current = null;
      setReady(false);
    };
  }, [webglOk, model3dUrl, model3dStructuredUrl]);

  // Open at the saved pose + paint the default colours (mirrors the storefront model-3d-viewer wiring).
  // setView also re-places the heuristic engrave preview, so admin and PDP agree on where un-anchored
  // text lands. Separate ready-gated effects so a later pose/colour prop change re-applies live.
  useEffect(() => {
    if (ready) viewerRef.current?.setView(model3dView ?? null);
  }, [ready, model3dView]);
  useEffect(() => {
    if (ready) viewerRef.current?.setColors(defaultColors?.byObject, defaultColors?.flatHex);
  }, [ready, defaultColors]);

  // The click handler above is registered once (boot effect) but needs the LATEST activeOptionId/label —
  // refs sidestep re-registering the DOM listener on every keystroke/tab switch.
  const activeOptionIdRef = useRef(activeOptionId);
  activeOptionIdRef.current = activeOptionId;
  const draftLabelRef = useRef(draftLabel);
  draftLabelRef.current = draftLabel;
  // t() via ref for the same reason — the DOM click handler is registered once.
  const autoLabel = (values: { n: number }) => t('autoPositionLabel', values);
  const autoLabelRef = useRef(autoLabel);
  autoLabelRef.current = autoLabel;

  function removePosition(optionId: string, index: number) {
    setPositions((prev) => ({ ...prev, [optionId]: prev[optionId].filter((_, i) => i !== index) }));
    setDirty((prev) => ({ ...prev, [optionId]: true }));
    setSaved((prev) => ({ ...prev, [optionId]: false }));
  }

  // Every already-placed position (any option) previews as its own name; the active option's LAST spot
  // additionally shows the live sample text once one is typed — so the owner sees every spot together
  // while iterating on one. viewer3d's single-entry front-centre fallback still applies when there is
  // exactly one text option and it has no positions yet.
  useEffect(() => {
    if (!ready) return;
    const entries: { id: string; text: string; anchor: EngraveAnchor | null; colorHex?: string }[] =
      [];
    for (const o of options) {
      const list = positions[o.id] ?? [];
      if (list.length === 0) {
        entries.push({
          id: o.id,
          text: o.id === activeOptionId ? sample.trim() || o.label : o.label,
          anchor: null,
          colorHex: sampleColorHex ?? undefined,
        });
        continue;
      }
      list.forEach((pos, i) => {
        entries.push({
          id: `${o.id}::${i}`,
          text:
            o.id === activeOptionId && i === list.length - 1
              ? sample.trim() || pos.label
              : pos.label,
          anchor: pos,
          colorHex: sampleColorHex ?? undefined,
        });
      });
    }
    viewerRef.current?.setEngravings(entries);
  }, [ready, options, activeOptionId, sample, positions, sampleColorHex]);

  function onSave() {
    const id = activeOptionId;
    if (!id) return;
    setSaveError(null);
    start(async () => {
      const res = await saveEngraveAnchor(productId, id, positions[id] ?? []);
      if (res.ok) {
        setSaved((prev) => ({ ...prev, [id]: true }));
        setDirty((prev) => ({ ...prev, [id]: false }));
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
  if (options.length === 0) {
    return <p className="text-sm text-text-muted">{t('noTextOptions')}</p>;
  }

  const activePositions = activeOptionId ? (positions[activeOptionId] ?? []) : [];
  const activeDirty = activeOptionId ? (dirty[activeOptionId] ?? false) : false;
  const activeSaved = activeOptionId ? (saved[activeOptionId] ?? false) : false;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-text-muted">{t('hint')}</p>

      {/* One pill per text option — picks which option's position list the picker edits. */}
      {options.length > 1 && (
        <div className="flex flex-wrap gap-2" role="tablist" aria-label={t('optionTabsLabel')}>
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              role="tab"
              aria-selected={o.id === activeOptionId}
              onClick={() => setActiveOptionId(o.id)}
              className={cn(
                'rounded-pill border-2 px-3 py-1.5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2',
                o.id === activeOptionId
                  ? 'border-border-strong bg-primary text-on-primary'
                  : 'border-border-default text-text-body hover:border-border-strong',
              )}
            >
              {o.label}
              {(positions[o.id]?.length ?? 0) > 0
                ? ` ✓${positions[o.id]!.length > 1 ? ` ×${positions[o.id]!.length}` : ''}`
                : ''}
            </button>
          ))}
        </div>
      )}

      <div className="relative aspect-square overflow-hidden rounded-lg bg-surface-sunken">
        {/* The three.js canvas mounts here (imperatively) — hidden until the model is in. */}
        <div
          ref={mountRef}
          role="img"
          aria-label={t('alt', { name: productName })}
          className={'h-full w-full cursor-crosshair ' + (ready && !failed ? '' : 'invisible')}
        />
        {failed ? (
          <p
            role="alert"
            className="absolute inset-0 flex items-center justify-center px-4 text-center text-sm text-text-muted"
          >
            {t('error')}
          </p>
        ) : !ready ? (
          <p
            role="status"
            className="absolute inset-0 flex items-center justify-center text-sm text-text-muted"
          >
            {t('loading')}
          </p>
        ) : null}
      </div>

      {ready && !failed && (
        <>
          <Input
            label={t('positionLabelInput')}
            hint={t('positionLabelHint')}
            value={draftLabel}
            onChange={(e) => setDraftLabel(e.target.value)}
            placeholder={t('positionLabelPlaceholder')}
            autoComplete="off"
          />

          {activePositions.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {activePositions.map((pos, i) => (
                <li
                  key={i}
                  className="flex items-center justify-between gap-2 rounded-md border border-border-default px-3 py-2 text-sm"
                >
                  <span className="font-medium text-text-strong">{pos.label}</span>
                  <button
                    type="button"
                    onClick={() => activeOptionId && removePosition(activeOptionId, i)}
                    className="text-sm text-danger underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2"
                  >
                    {t('removePosition')}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <Input
            label={t('sampleLabel')}
            hint={t('sampleHint')}
            value={sample}
            onChange={(e) => setSample(e.target.value)}
            placeholder={
              activeOptionId ? options.find((o) => o.id === activeOptionId)?.label : undefined
            }
            autoComplete="off"
          />
        </>
      )}

      {/* Engrave-text colour preview — the SAME palette as the product's own paint colours (no separate
          config); the customer picks their own on the storefront. */}
      {ready && !failed && colors.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="font-display text-sm font-medium text-text-strong">
            {t('sampleColorLabel')}
          </span>
          <div className="flex flex-wrap gap-2">
            {colors.map((c) => (
              <button
                key={c.id}
                type="button"
                aria-label={c.name}
                aria-pressed={sampleColorHex === c.hex}
                onClick={() => setSampleColorHex(c.hex)}
                style={{ backgroundColor: c.hex }}
                className={cn(
                  'h-8 w-8 rounded-full border-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2',
                  sampleColorHex === c.hex ? 'border-text-strong' : 'border-border-default',
                )}
              />
            ))}
          </div>
        </div>
      )}

      {ready && !failed && (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" onClick={onSave} disabled={pending || !activeDirty}>
            {pending ? t('saving') : t('save')}
          </Button>
          <span role="status" className="text-sm text-text-muted">
            {activeSaved ? (
              <span className="text-accent-teal">{t('saved')}</span>
            ) : activeDirty ? (
              t('pickedUnsaved')
            ) : activePositions.length > 0 ? (
              t('savedExisting')
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
