import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/**
 * Imperative three.js wrapper behind the PDP's Model3dViewer (P1-j rev 2: real surface engraving).
 * Replaces <model-viewer> because engraving needs geometry added to the scene — the typed text is
 * drawn to a canvas texture and projected onto the model's surface as a DecalGeometry, so it hugs
 * curvature like a real engraving instead of floating as a billboard. WHERE it sits is the owner's
 * call: the admin-picked engrave anchor (position + normal, PATCHed per product) is fed in via
 * setServerAnchor; a product without one falls back to the front-centre heuristic.
 *
 * Kept from the model-viewer setup: the self-hosted Draco decoder in public/draco/ (PDPL posture —
 * no gstatic), per-material recolor by NAME (f-3/ADR-052: structured glb names materials after
 * objects), no autonomous motion (orbit is user-driven only ⇒ prefers-reduced-motion honoured by
 * construction). This module is ~three.js-heavy and must only be loaded via dynamic import.
 */

const DECAL_CANVAS_W = 1024;
const DECAL_CANVAS_H = 256;

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

  private engraveText = '';
  private decal: THREE.Mesh | null = null;
  private decalTexture: THREE.CanvasTexture;
  private decalCanvas: HTMLCanvasElement;
  // Where the engraving sits: a surface point + normal on a specific mesh. Resolved from the
  // admin-picked serverAnchor when one exists, else the front-centre heuristic on load.
  private anchor: { mesh: THREE.Mesh; point: THREE.Vector3; normal: THREE.Vector3 } | null = null;
  private serverAnchor: { pos: THREE.Vector3; normal: THREE.Vector3 } | null = null;
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

    this.decalCanvas = document.createElement('canvas');
    this.decalCanvas.width = DECAL_CANVAS_W;
    this.decalCanvas.height = DECAL_CANVAS_H;
    this.decalTexture = new THREE.CanvasTexture(this.decalCanvas);
    this.decalTexture.colorSpace = THREE.SRGBColorSpace;
    this.decalTexture.anisotropy = 4;

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
      this.resolveAnchor();
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

  setEngraveText(text: string) {
    this.engraveText = text.trim();
    this.rebuildDecal();
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

  /** The admin-picked engrave anchor from the product (model-space metres + outward normal), or null
   *  when the owner hasn't picked one. Safe to call before load — resolved once geometry is in. */
  setServerAnchor(
    a: {
      posX: number;
      posY: number;
      posZ: number;
      normX: number;
      normY: number;
      normZ: number;
    } | null,
  ) {
    this.serverAnchor =
      a == null
        ? null
        : {
            pos: new THREE.Vector3(a.posX, a.posY, a.posZ),
            normal: new THREE.Vector3(a.normX, a.normY, a.normZ).normalize(),
          };
    if (this.loaded) this.resolveAnchor();
  }

  private frontCenter: { center: THREE.Vector3; frontZ: number } | null = null;

  /** Resolve `anchor` (mesh + point + normal) from the admin-picked serverAnchor when present, else
   *  the front-centre heuristic. DecalGeometry needs a target MESH: for a server anchor, a short ray
   *  fired from just outside the surface along -normal finds the mesh under the point (mesh identity
   *  isn't persisted — the glb can be re-ingested); a miss keeps the point but projects onto the
   *  largest mesh, so a slightly-stale anchor degrades to "roughly there", never a crash. */
  private resolveAnchor() {
    this.anchor = null;
    if (this.serverAnchor && this.meshes.length > 0) {
      const { pos, normal } = this.serverAnchor;
      this.raycaster.set(
        pos.clone().addScaledVector(normal, this.maxDim * 0.05),
        normal.clone().negate(),
      );
      this.raycaster.far = this.maxDim * 0.2;
      const hit = this.raycaster.intersectObjects(this.meshes, false)[0];
      this.raycaster.far = Infinity;
      this.anchor = {
        mesh: (hit?.object as THREE.Mesh | undefined) ?? this.meshes[0],
        point: hit?.point ?? pos,
        normal,
      };
    } else if (this.frontCenter) {
      // Front-centre heuristic: the front-most surface at model-centre height (a ray fired from in
      // front of the model toward its centre). Null on a degenerate model — no decal shown.
      const { center } = this.frontCenter;
      const from = new THREE.Vector3(center.x, center.y, this.frontCenter.frontZ + this.maxDim);
      this.raycaster.set(from, new THREE.Vector3(0, 0, -1));
      const hit = this.raycaster.intersectObjects(this.meshes, false)[0];
      if (hit?.face) {
        const normal = hit.face.normal
          .clone()
          .transformDirection(hit.object.matrixWorld)
          .normalize();
        this.anchor = { mesh: hit.object as THREE.Mesh, point: hit.point, normal };
      }
    }
    this.rebuildDecal();
  }

  /** Engraved look on a 2D canvas: dark text with a 1px light drop below reads as carved-in under
   *  the studio light. Canvas 2D shapes text with the page's own fonts ⇒ full Vietnamese diacritics. */
  private drawText() {
    const ctx = this.decalCanvas.getContext('2d')!;
    ctx.clearRect(0, 0, DECAL_CANVAS_W, DECAL_CANVAS_H);
    const font = (px: number) => `700 ${px}px "Hanken Grotesk", system-ui, sans-serif`;
    let px = 140;
    ctx.font = font(px);
    const w = ctx.measureText(this.engraveText).width;
    if (w > DECAL_CANVAS_W - 80) px = Math.max(40, Math.floor((px * (DECAL_CANVAS_W - 80)) / w));
    ctx.font = font(px);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillText(this.engraveText, DECAL_CANVAS_W / 2, DECAL_CANVAS_H / 2 + 3);
    ctx.fillStyle = 'rgba(30,18,10,0.88)';
    ctx.fillText(this.engraveText, DECAL_CANVAS_W / 2, DECAL_CANVAS_H / 2);
    this.decalTexture.needsUpdate = true;
  }

  private rebuildDecal() {
    if (this.decal) {
      this.scene.remove(this.decal);
      this.decal.geometry.dispose();
      (this.decal.material as THREE.Material).dispose();
      this.decal = null;
    }
    if (!this.engraveText || !this.anchor) return;
    this.drawText();
    const { mesh, point, normal } = this.anchor;
    const helper = new THREE.Object3D();
    helper.position.copy(point);
    helper.lookAt(point.clone().add(normal));
    const width = this.maxDim * 0.45;
    const size = new THREE.Vector3(
      width,
      width * (DECAL_CANVAS_H / DECAL_CANVAS_W),
      this.maxDim * 0.2,
    );
    const geometry = new DecalGeometry(mesh, point, helper.rotation, size);
    const material = new THREE.MeshStandardMaterial({
      map: this.decalTexture,
      transparent: true,
      roughness: 0.9,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      depthWrite: false,
    });
    this.decal = new THREE.Mesh(geometry, material);
    this.scene.add(this.decal);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.controls.dispose();
    this.decalTexture.dispose();
    this.renderer.dispose();
    // Chrome caps concurrent WebGL contexts (~16); repeated mount/unmount (photo ↔ 3D toggle) without
    // this can exhaust the cap, so a later remount silently fails to get a context.
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
