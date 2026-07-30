import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { TTFLoader } from 'three/addons/loaders/TTFLoader.js';
import { Font } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';

/**
 * Imperative three.js viewer shared by the storefront PDP and the admin engrave picker (moved here
 * from apps/storefront/src/lib/viewer3d.ts so BOTH surfaces preview the same engraving). Engraving is
 * REAL raised text: the typed string becomes an extruded TextGeometry (a Vietnamese-capable TTF in
 * /fonts/engrave.ttf, parsed by three's bundled opentype) planted base-first on the surface at the
 * admin-picked anchor — embossed lettering like the printed piece, not a flat decal/billboard.
 *
 * Kept: self-hosted Draco decoder in public/draco/ (PDPL posture — no gstatic), per-material recolor
 * by NAME (f-3/ADR-052: structured glb names materials after objects), no autonomous motion (orbit is
 * user-driven only ⇒ prefers-reduced-motion honoured by construction). Both apps must serve
 * /draco/* and /fonts/engrave.ttf from their public/. ~three.js-heavy — only load via dynamic import,
 * and never re-export from the package index.
 */

const ENGRAVE_FONT_URL = '/fonts/engrave.ttf';

// One font fetch per page, shared across viewer instances (storefront gallery↔3D toggles remount).
let fontPromise: Promise<Font> | null = null;
function loadEngraveFont(): Promise<Font> {
  fontPromise ??= new TTFLoader()
    .loadAsync(ENGRAVE_FONT_URL)
    .then((json) => new Font(json as ConstructorParameters<typeof Font>[0]))
    .catch((e) => {
      fontPromise = null; // a transient fetch failure should not poison every later viewer
      throw e;
    });
  return fontPromise;
}

/** A picked engrave spot: surface point + outward normal, model space (the wire EngraveAnchor shape). */
export interface EngravePick {
  posX: number;
  posY: number;
  posZ: number;
  normX: number;
  normY: number;
  normZ: number;
}

export class Viewer3d {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private raycaster = new THREE.Raycaster();
  private meshes: THREE.Mesh[] = [];
  private materialsByName = new Map<string, THREE.MeshStandardMaterial>();
  private allMaterials: THREE.MeshStandardMaterial[] = [];
  private maxDim = 1;
  private raf = 0;
  private disposed = false;

  // Multiple simultaneous engravings, keyed by an id the caller owns (a product's option id) — a
  // product can have more than one text option, each at its own spot (ADR-037 follow-up: the anchor
  // moved from the product to the option). `input` is what the caller last asked for; `mesh` is the
  // built lettering (or none — no anchor resolved, or no text). Monotonic per-id build tokens guard
  // the async font load: a stale rebuild (text retyped mid-load) drops its result instead of racing
  // the newer one onto the scene.
  private engravings = new Map<
    string,
    {
      text: string;
      colorHex: string;
      serverAnchor: { pos: THREE.Vector3; normal: THREE.Vector3 } | null;
    }
  >();
  private engraveMeshes = new Map<string, THREE.Mesh>();
  private engraveBuildTokens = new Map<string, number>();
  private savedView: {
    orbitTheta: number;
    orbitPhi: number;
    orbitRadius: number;
    targetX: number;
    targetY: number;
    targetZ: number;
  } | null = null;
  private center = new THREE.Vector3();
  private sphereRadius = 1;
  private loaded = false;

  constructor(
    private container: HTMLElement,
    private onError: () => void,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;

    // Neutral studio lighting, close to model-viewer's default look.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment()).texture;
    pmrem.dispose();

    this.resize();
    const loop = () => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(loop);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  /** Match the canvas to the container; the parent calls this from a ResizeObserver. */
  resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  async load(src: string) {
    const loader = new GLTFLoader();
    const draco = new DRACOLoader();
    draco.setDecoderPath('/draco/');
    loader.setDRACOLoader(draco);
    try {
      const gltf = await loader.loadAsync(src);
      if (this.disposed) return;
      const root = gltf.scene;
      root.traverse((o) => {
        if (!(o as THREE.Mesh).isMesh) return;
        const mesh = o as THREE.Mesh;
        this.meshes.push(mesh);
        for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          const std = m as THREE.MeshStandardMaterial;
          this.allMaterials.push(std);
          if (std.name) this.materialsByName.set(std.name, std);
        }
      });
      this.scene.add(root);

      // Frame the model: orbit target at its centre, camera pulled back on +Z with a slight lift.
      const box = new THREE.Box3().setFromObject(root);
      const center = box.getCenter(this.center);
      const size = box.getSize(new THREE.Vector3());
      this.maxDim = Math.max(size.x, size.y, size.z) || 1;
      this.sphereRadius = size.length() / 2 || 1;
      this.camera.near = this.maxDim / 100;
      this.camera.far = this.maxDim * 20;
      this.camera.updateProjectionMatrix();

      this.loaded = true;
      this.frontCenter = { center, frontZ: box.max.z };
      this.applyCamera();
      this.rebuildEngravings();
    } catch {
      if (!this.disposed) this.onError();
    } finally {
      draco.dispose();
    }
  }

  /** f-3/ADR-052 recolor. Flat product: every material; parts product: by material (=object) name. */
  setColors(partColors: Record<string, string> | undefined, flatColorHex: string | undefined) {
    if (flatColorHex) for (const m of this.allMaterials) m.color.set(flatColorHex);
    for (const [name, hex] of Object.entries(partColors ?? {})) {
      this.materialsByName.get(name)?.color.set(hex);
    }
  }

  /** Replace the full set of engravings shown at once — one per text option (ADR-037 follow-up), each
   *  with its OWN anchor (or none, meaning "not placed yet"). An id dropped from `entries` (an option
   *  deleted, or its text cleared upstream) removes that engraving; an id whose text/anchor/colour is
   *  unchanged since the last call is left alone (no needless rebuild). Colour defaults to an ink-dark
   *  matte — a customer/owner pick from the product's OWN paint palette (no separate engrave-colour
   *  config). Safe to call before load; resolved once geometry is in. */
  setEngravings(
    entries: { id: string; text: string; anchor: EngravePick | null; colorHex?: string }[],
  ) {
    const next = new Map<
      string,
      {
        text: string;
        colorHex: string;
        serverAnchor: { pos: THREE.Vector3; normal: THREE.Vector3 } | null;
      }
    >();
    for (const e of entries) {
      next.set(e.id, {
        text: e.text.trim(),
        colorHex: e.colorHex ?? '#2e1c0c',
        serverAnchor: e.anchor
          ? {
              pos: new THREE.Vector3(e.anchor.posX, e.anchor.posY, e.anchor.posZ),
              normal: new THREE.Vector3(e.anchor.normX, e.anchor.normY, e.anchor.normZ).normalize(),
            }
          : null,
      });
    }
    for (const id of this.engravings.keys()) {
      if (!next.has(id)) this.disposeEngrave(id); // dropped id → remove its lettering
    }
    this.engravings = next;
    if (this.loaded) this.rebuildEngravings();
  }

  private disposeEngrave(id: string) {
    const mesh = this.engraveMeshes.get(id);
    if (!mesh) return;
    this.scene.remove(mesh);
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
    this.engraveMeshes.delete(id);
  }

  /** The owner-saved default camera pose (ADR-038): model-viewer camera-orbit semantics — theta/phi in
   *  degrees (theta 0 = in front, +Z), radius as percent of the auto-frame distance, target in model-space
   *  metres. Null → the viewer's own default framing. Safe to call before load. */
  setView(
    v: {
      orbitTheta: number;
      orbitPhi: number;
      orbitRadius: number;
      targetX: number;
      targetY: number;
      targetZ: number;
    } | null,
  ) {
    this.savedView = v;
    if (this.loaded) this.applyCamera();
  }

  /** Place the camera: the saved pose when one exists, else auto-framing. The "ideal" (100%) distance is
   *  approximated by fitting the bounding sphere to the vertical FoV — a few percent off model-viewer's
   *  exact framing math, which only shifts zoom slightly, never the angle. */
  private applyCamera() {
    const v = this.savedView;
    if (v) {
      const fov = (this.camera.fov * Math.PI) / 180;
      const ideal = this.sphereRadius / Math.sin(fov / 2);
      const r = (v.orbitRadius / 100) * ideal;
      const phi = (v.orbitPhi * Math.PI) / 180;
      const theta = (v.orbitTheta * Math.PI) / 180;
      this.controls.target.set(v.targetX, v.targetY, v.targetZ);
      this.camera.position.set(
        v.targetX + r * Math.sin(phi) * Math.sin(theta),
        v.targetY + r * Math.cos(phi),
        v.targetZ + r * Math.sin(phi) * Math.cos(theta),
      );
    } else {
      this.controls.target.copy(this.center);
      this.camera.position.set(
        this.center.x,
        this.center.y + this.maxDim * 0.15,
        this.center.z + this.maxDim * 2.2,
      );
    }
  }

  /** Hit-test a pointer position (client px) against the model: the surface point + outward normal
   *  under it, or null on a miss. The admin engrave picker's click → anchor path. */
  pickAt(clientX: number, clientY: number): EngravePick | null {
    if (!this.loaded) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObjects(this.meshes, false)[0];
    if (!hit?.face) return null;
    const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
    return {
      posX: hit.point.x,
      posY: hit.point.y,
      posZ: hit.point.z,
      normX: n.x,
      normY: n.y,
      normZ: n.z,
    };
  }

  private frontCenter: { center: THREE.Vector3; frontZ: number } | null = null;

  /** The front-most surface at model-centre height (a ray fired from in front of the model toward its
   *  centre) — the ONE engraving's placement when the owner hasn't picked an anchor yet. Only applied
   *  when there is exactly ONE engraving in play (see resolveAnchors): with several text options in
   *  play, an un-placed one should show nothing rather than stack on top of another at the same
   *  guessed spot — the owner is expected to place each via the anchor picker. */
  private frontCenterAnchor(): { point: THREE.Vector3; normal: THREE.Vector3 } | null {
    if (!this.frontCenter) return null;
    const { center } = this.frontCenter;
    const from = new THREE.Vector3(center.x, center.y, this.frontCenter.frontZ + this.maxDim);
    this.raycaster.set(from, new THREE.Vector3(0, 0, -1));
    const hit = this.raycaster.intersectObjects(this.meshes, false)[0];
    if (!hit?.face) return null;
    const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
    return { point: hit.point, normal };
  }

  /** Rebuild every engraving in `this.engravings` against the current anchor resolution. Called after
   *  load and whenever setEngravings changes an id's inputs. */
  private rebuildEngravings() {
    const onlyOneEntry = this.engravings.size === 1;
    for (const [id, input] of this.engravings) {
      const anchor = input.serverAnchor
        ? { point: input.serverAnchor.pos, normal: input.serverAnchor.normal }
        : onlyOneEntry
          ? this.frontCenterAnchor()
          : null;
      this.rebuildOneEngrave(id, input.text, input.colorHex, anchor);
    }
  }

  /** Raised lettering for ONE engraving: extruded TextGeometry planted base-first along the anchor's
   *  normal — ~30% of the depth sinks in, the rest stands proud, so a flat plane reads as engraved
   *  rather than glued on. `bendToSurface` then curves that flat plane to hug the ACTUAL surface along
   *  the word's width (a raycast per sample point) — without it, only the centre character touches a
   *  curved part (a dome, a cylinder) and the ends float above it. */
  private rebuildOneEngrave(
    id: string,
    text: string,
    colorHex: string,
    anchor: { point: THREE.Vector3; normal: THREE.Vector3 } | null,
  ) {
    this.disposeEngrave(id);
    const build = (this.engraveBuildTokens.get(id) ?? 0) + 1;
    this.engraveBuildTokens.set(id, build);
    if (!text || !anchor) return;
    void loadEngraveFont()
      .then((font) => {
        if (this.disposed || this.engraveBuildTokens.get(id) !== build) return;
        const depth = this.maxDim * 0.02;
        const geometry = new TextGeometry(text, {
          font,
          size: this.maxDim * 0.09,
          depth,
          curveSegments: 6,
          bevelEnabled: false,
        });
        geometry.computeBoundingBox();
        const bb = geometry.boundingBox!;
        const w = bb.max.x - bb.min.x || 1;
        const h = bb.max.y - bb.min.y || 1;
        // Centre the word on the anchor and cap its width to stay on the surface.
        geometry.translate(-(bb.min.x + w / 2), -(bb.min.y + h / 2), 0);
        const scale = Math.min(1, (this.maxDim * 0.45) / w);

        const { point, normal } = anchor;
        const mesh = new THREE.Mesh(
          geometry,
          new THREE.MeshStandardMaterial({
            color: colorHex,
            roughness: 0.85,
            metalness: 0,
          }),
        );
        mesh.scale.setScalar(scale);
        mesh.position.copy(point).addScaledVector(normal, -depth * scale * 0.3);
        mesh.lookAt(point.clone().add(normal));
        this.bendToSurface(geometry, mesh, normal, scale);
        this.engraveMeshes.set(id, mesh);
        this.scene.add(mesh);
      })
      .catch(() => {
        // No font → no raised preview; the model itself still renders, so stay silent.
      });
  }

  /** Curve a flat engrave-text plane to hug the model's ACTUAL surface along its width: sample the
   *  surface height at N points across the text (a short raycast toward the anchor's normal from just
   *  outside the model, at `mesh`'s already-placed pose) and push each vertex along the same local axis
   *  by however much the surface bulges/recedes there versus the anchor's own point. A miss (edge of a
   *  part, gap between meshes) contributes 0 — that slice just keeps the flat placement. Single-axis
   *  (word width only, not glyph height) — a name reads left-to-right, so bending the other axis too
   *  would fight the letterforms for no visible gain. */
  private bendToSurface(
    geometry: THREE.BufferGeometry,
    mesh: THREE.Mesh,
    normal: THREE.Vector3,
    scale: number,
  ) {
    mesh.updateMatrixWorld(true);
    const pos = geometry.attributes.position;
    let minX = Infinity;
    let maxX = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }
    const width = Math.max(maxX - minX, 1e-6);
    const BUCKETS = 20;
    const rotInv = new THREE.Matrix4().extractRotation(mesh.matrixWorld).invert();
    // The world normal expressed in the mesh's OWN local axes — since the mesh is oriented to face the
    // anchor's normal, this is close to a pure (0,0,±1), but deriving it (rather than assuming the
    // sign) keeps the shift correct regardless of lookAt's exact convention.
    const localNormal = normal.clone().transformDirection(rotInv);
    const deltas: number[] = [];
    for (let b = 0; b <= BUCKETS; b++) {
      const localX = minX + (b / BUCKETS) * width;
      const worldPoint = new THREE.Vector3(localX, 0, 0).applyMatrix4(mesh.matrixWorld);
      const rayOrigin = worldPoint.clone().addScaledVector(normal, this.maxDim * 0.2);
      this.raycaster.set(rayOrigin, normal.clone().negate());
      this.raycaster.far = this.maxDim * 0.4;
      const hit = this.raycaster.intersectObjects(this.meshes, false)[0];
      this.raycaster.far = Infinity;
      deltas.push(hit ? hit.point.clone().sub(worldPoint).dot(normal) / scale : 0);
    }
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const t = ((x - minX) / width) * BUCKETS;
      const b0 = Math.max(0, Math.min(BUCKETS, Math.floor(t)));
      const b1 = Math.min(BUCKETS, b0 + 1);
      const f = t - b0;
      const delta = deltas[b0] * (1 - f) + deltas[b1] * f;
      pos.setX(i, x + localNormal.x * delta);
      pos.setY(i, pos.getY(i) + localNormal.y * delta);
      pos.setZ(i, pos.getZ(i) + localNormal.z * delta);
    }
    pos.needsUpdate = true;
    geometry.computeVertexNormals();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.controls.dispose();
    this.renderer.dispose();
    // Chrome caps concurrent WebGL contexts (~16); repeated mount/unmount (photo ↔ 3D toggle) without
    // this can exhaust the cap, so a later remount silently fails to get a context.
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
