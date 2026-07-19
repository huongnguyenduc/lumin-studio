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
 * curvature like a real engraving instead of floating as a billboard. A tap on the model (pointer
 * up-down within a small slop, i.e. not an orbit drag) re-anchors the decal there: "chọn vị trí".
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
  // Where the engraving sits: a surface point + normal on a specific mesh. Defaulted to the
  // front-most surface point at model centre height on load; replaced by taps.
  private anchor: { mesh: THREE.Mesh; point: THREE.Vector3; normal: THREE.Vector3 } | null = null;

  private downAt: { x: number; y: number } | null = null;
  private onPointerDown = (e: PointerEvent) => {
    this.downAt = { x: e.clientX, y: e.clientY };
  };
  private onPointerUp = (e: PointerEvent) => {
    const d = this.downAt;
    this.downAt = null;
    // A drag is orbiting, not picking — only a near-stationary tap places the engraving.
    if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) return;
    if (!this.engraveText) return;
    const hit = this.raycastClient(e.clientX, e.clientY);
    if (hit) {
      this.anchor = hit;
      this.rebuildDecal();
    }
  };

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

    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.addEventListener('pointerup', this.onPointerUp);

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
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      this.maxDim = Math.max(size.x, size.y, size.z) || 1;
      this.controls.target.copy(center);
      this.camera.position.set(
        center.x,
        center.y + this.maxDim * 0.15,
        center.z + this.maxDim * 2.2,
      );
      this.camera.near = this.maxDim / 100;
      this.camera.far = this.maxDim * 20;
      this.camera.updateProjectionMatrix();

      // Default engraving anchor: the front-most surface at model-centre height (a ray fired from
      // in front of the model toward its centre). Falls back to null on a degenerate model — the
      // decal then only appears once the customer taps a position.
      const from = new THREE.Vector3(center.x, center.y, box.max.z + this.maxDim);
      this.raycaster.set(from, new THREE.Vector3(0, 0, -1));
      const hit = this.raycaster.intersectObjects(this.meshes, false)[0];
      if (hit?.face) {
        const normal = hit.face.normal
          .clone()
          .transformDirection(hit.object.matrixWorld)
          .normalize();
        this.anchor = { mesh: hit.object as THREE.Mesh, point: hit.point, normal };
      }
      this.rebuildDecal();
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

  private raycastClient(clientX: number, clientY: number) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObjects(this.meshes, false)[0];
    if (!hit?.face) return null;
    const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
    return { mesh: hit.object as THREE.Mesh, point: hit.point, normal };
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
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.removeEventListener('pointerup', this.onPointerUp);
    this.controls.dispose();
    this.decalTexture.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
