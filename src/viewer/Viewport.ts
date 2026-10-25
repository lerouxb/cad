import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { BodyMesh } from "../core/kernel/protocol";

/**
 * Imperative three.js scene. Deliberately not react-three-fiber: picking and
 * sketch dragging are hot paths that should not go through React's render loop.
 *
 * Model space is Z-up (CAD convention), matching OCCT.
 */
export class Viewport {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private body = new THREE.Group();
  private resizeObserver: ResizeObserver;
  private disposed = false;
  private framed = false;
  private active = true;
  private dirty = true;
  private readonly canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x101317);

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
    this.addEnvironment();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();

    this.startLoop();
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
      color: 0xb3c0d2,
      metalness: 0.28,
      roughness: 0.46,
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
      color: 0x11161c,
      transparent: true,
      opacity: 0.85,
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
    this.renderer.dispose();
  }

  private addEnvironment(): void {
    this.scene.add(new THREE.HemisphereLight(0xc7d8ff, 0x1a1f27, 1.1));

    const key = new THREE.DirectionalLight(0xffffff, 1.7);
    key.position.set(120, -90, 180);
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0x8fb4ff, 0.55);
    fill.position.set(-140, 120, 40);
    this.scene.add(fill);

    const grid = new THREE.GridHelper(600, 60, 0x333c48, 0x20262e);
    grid.rotation.x = Math.PI / 2;
    grid.material.transparent = true;
    grid.material.opacity = 0.7;
    grid.position.z = -0.05;
    this.scene.add(grid);

    const axes = new THREE.AxesHelper(22);
    axes.position.z = 0.01;
    this.scene.add(axes);
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
