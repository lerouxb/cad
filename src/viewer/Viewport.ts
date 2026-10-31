import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { BodyMesh } from "../core/kernel/protocol";

/**
 * Imperative three.js scene. Deliberately not react-three-fiber: picking and
 * sketch dragging are hot paths that should not go through React's render loop.
 *
 * Model space is Z-up (CAD convention), matching OCCT.
 */
type ViewportTheme = "day" | "night";

export class Viewport {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private body = new THREE.Group();
  private environment = new THREE.Group();
  private theme: ViewportTheme;
  private resizeObserver: ResizeObserver;
  private disposed = false;
  private framed = false;
  private active = true;
  private dirty = true;
  private readonly canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement, theme: ViewportTheme = "night") {
    this.canvas = canvas;
    this.theme = theme;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(this.background());

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 10_000);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(110, -150, 95);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.rotateSpeed = 0.8;
    this.controls.zoomSpeed = 0.9;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 2000;
    this.controls.target.set(30, 20, 0);
    this.controls.update();

    this.scene.add(this.body);
    this.scene.add(this.environment);
    this.addEnvironment();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();

    this.startLoop();
  }

  setTheme(theme: ViewportTheme): void {
    if (this.theme === theme || this.disposed) return;
    this.theme = theme;
    this.scene.background = new THREE.Color(this.background());
    this.addEnvironment();
    this.applyBodyTheme();
    this.dirty = true;
  }

  /** Pause rendering while the 3D view is hidden (sketch mode). */
  setActive(active: boolean): void {
    if (this.active === active || this.disposed) return;
    this.active = active;
    if (active) {
      this.dirty = true;
      this.startLoop();
    } else {
      this.renderer.setAnimationLoop(null);
    }
  }

  setMesh(mesh: BodyMesh): void {
    this.clearBody();

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3));
    geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    const material = new THREE.MeshStandardMaterial({
      color: this.bodyColor(),
      metalness: 0.05,
      roughness: 0.72,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    const solid = new THREE.Mesh(geometry, material);
    solid.name = "body";
    this.body.add(solid);

    const edgeGeometry = new THREE.BufferGeometry();
    edgeGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(mesh.edgePositions, 3),
    );
    const edgeMaterial = new THREE.LineBasicMaterial({
      color: this.edgeColor(),
      transparent: true,
      opacity: 0.9,
    });
    const edges = new THREE.LineSegments(edgeGeometry, edgeMaterial);
    edges.name = "edges";
    this.body.add(edges);

    if (!this.framed && geometry.boundingSphere) {
      this.frameAll();
      this.framed = true;
    }
    this.dirty = true;
  }

  clearMesh(): void {
    this.clearBody();
    this.framed = false;
    this.dirty = true;
  }

  frameAll(): void {
    const box = new THREE.Box3().setFromObject(this.body);
    if (box.isEmpty()) return;

    const center = box.getCenter(new THREE.Vector3());
    const radius = box.getSize(new THREE.Vector3()).length() / 2;
    const distance = (radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2))) * 1.6;

    const direction = new THREE.Vector3(0.9, -1.15, 0.75).normalize();
    this.camera.position.copy(center).addScaledVector(direction, distance);
    this.controls.target.copy(center);
    this.controls.update();
    this.dirty = true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.clearBody();
    this.clearEnvironment();
    this.renderer.dispose();
  }

  private addEnvironment(): void {
    this.clearEnvironment();

    const day = this.theme === "day";
    this.environment.add(
      new THREE.HemisphereLight(
        day ? 0xffffff : 0xa5a396,
        day ? 0xf0efe8 : 0x1a1a17,
        day ? 1.15 : 1.05,
      ),
    );

    const key = new THREE.DirectionalLight(0xffffff, day ? 1.5 : 1.85);
    key.position.set(120, -90, 180);
    this.environment.add(key);

    const fill = new THREE.DirectionalLight(
      day ? 0xffffff : 0xb9b6a8,
      day ? 0.45 : 0.55,
    );
    fill.position.set(-140, 120, 40);
    this.environment.add(fill);

    const grid = new THREE.GridHelper(
      600,
      60,
      day ? 0xc9c8bf : 0x4e4d45,
      day ? 0xe2e1d9 : 0x2d2d28,
    );
    grid.rotation.x = Math.PI / 2;
    grid.material.transparent = true;
    grid.material.opacity = day ? 0.85 : 0.8;
    grid.position.z = -0.05;
    this.environment.add(grid);

    const axes = new THREE.AxesHelper(22);
    axes.position.z = 0.01;
    this.environment.add(axes);
  }

  private clearEnvironment(): void {
    for (const child of [...this.environment.children]) {
      this.environment.remove(child);
      if (
        child instanceof THREE.GridHelper ||
        child instanceof THREE.AxesHelper ||
        child instanceof THREE.LineSegments ||
        child instanceof THREE.Mesh
      ) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((material) => material.dispose());
        } else {
          child.material.dispose();
        }
      }
    }
  }

  private applyBodyTheme(): void {
    for (const child of this.body.children) {
      if (child instanceof THREE.Mesh) {
        const material = child.material;
        if (material instanceof THREE.MeshStandardMaterial) {
          material.color.setHex(this.bodyColor());
          material.needsUpdate = true;
        }
      } else if (child instanceof THREE.LineSegments) {
        const material = child.material;
        if (material instanceof THREE.LineBasicMaterial) {
          material.color.setHex(this.edgeColor());
          material.needsUpdate = true;
        }
      }
    }
  }

  private background(): number {
    return this.theme === "day" ? 0xfbfbf9 : 0x111110;
  }

  private bodyColor(): number {
    return this.theme === "day" ? 0xefeee7 : 0x77756b;
  }

  private edgeColor(): number {
    return this.theme === "day" ? 0x161614 : 0xf2efe3;
  }

  private clearBody(): void {
    for (const child of [...this.body.children]) {
      this.body.remove(child);
      if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((material) => material.dispose());
        } else {
          child.material.dispose();
        }
      }
    }
  }

  /**
   * Render on demand instead of at a constant 60 fps: OrbitControls with
   * damping tells us when the camera moved, and mesh/resize changes set
   * `dirty`. A static part costs nothing between interactions.
   */
  private startLoop(): void {
    this.renderer.setAnimationLoop(() => {
      const moved = this.controls.update();
      if (!moved && !this.dirty) return;
      this.dirty = false;
      this.renderer.render(this.scene, this.camera);
    });
  }

  private resize(): void {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (width === 0 || height === 0) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }
}
