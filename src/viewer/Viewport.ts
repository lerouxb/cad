import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import type { BodyMesh } from "../core/kernel/protocol";
import type { PlaneFrame } from "../core/types";
import {
  edgeGroupForVertex,
  edgePick,
  edgePositionsForGroup,
  datumPick,
  edgeUnitForMesh,
  faceGroupForTriangle,
  facePick,
  type BodyPick,
  type EdgeUnit,
} from "./picking";

/**
 * Imperative three.js scene. Deliberately not react-three-fiber: picking and
 * sketch dragging are hot paths that should not go through React's render loop.
 *
 * Model space is Z-up (CAD convention), matching OCCT.
 */
type ViewportTheme = "day" | "night";

export interface ViewportOptions {
  theme?: ViewportTheme;
  /** Highlighter colour for hover/selection overlays. */
  highlightColor?: string;
  /** Ephemeral body selection callback; null means cleared. */
  onPick?: (pick: BodyPick | null) => void;
}

/** A sketch rendered on its plane in the model view. Plain data, no three.js. */
export interface SketchOverlayData {
  /** Local sketch plane -> world. Omitted for the default XY plane. */
  frame?: PlaneFrame;
  curves: ReadonlyArray<{
    points: ReadonlyArray<readonly [number, number]>;
    construction?: boolean;
  }>;
  points: ReadonlyArray<{
    position: readonly [number, number];
    construction?: boolean;
  }>;
  /** Filled profile loops used by the active extrude, with holes. */
  fills?: ReadonlyArray<{
    outer: ReadonlyArray<readonly [number, number]>;
    holes?: ReadonlyArray<ReadonlyArray<readonly [number, number]>>;
  }>;
}

export type { BodyPick };

export interface DatumPlaneOverlay {
  featureId: string;
  frame: PlaneFrame;
}

export class Viewport {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private body = new THREE.Group();
  private sketch = new THREE.Group();
  private datums = new THREE.Group();
  private datumPlanes: ReadonlyArray<DatumPlaneOverlay> = [];
  private readonly datumByFeature = new Map<string, DatumPlaneOverlay>();
  private supportPreviewGroup = new THREE.Group();
  private supportPreviewFrame: PlaneFrame | null = null;
  private dimmed = false;
  private sketchOverlay: SketchOverlayData | null = null;
  private readonly sketchLineMaterials = new Set<LineMaterial>();
  private environment = new THREE.Group();
  private hoverGroup = new THREE.Group();
  private selectionGroup = new THREE.Group();
  private theme: ViewportTheme;
  private highlightColor: string;
  private readonly onPick?: (pick: BodyPick | null) => void;
  private resizeObserver: ResizeObserver;
  private disposed = false;
  private framed = false;
  private active = true;
  private dirty = true;
  private readonly canvas: HTMLCanvasElement;

  private mesh: BodyMesh | null = null;
  private solid: THREE.Mesh | null = null;
  private edges: THREE.LineSegments | null = null;
  private edgeUnit: EdgeUnit = "segment";
  private readonly raycaster = new THREE.Raycaster();
  private pointerStart: { x: number; y: number; pointerId: number } | null = null;
  private hoverPick: BodyPick | null = null;
  private selectedPick: BodyPick | null = null;

  constructor(canvas: HTMLCanvasElement, options: ViewportOptions = {}) {
    this.canvas = canvas;
    this.theme = options.theme ?? "night";
    this.highlightColor = options.highlightColor ?? "#ddff00";
    this.onPick = options.onPick;
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
    this.controls.zoomSpeed = 1.5;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 2000;
    this.controls.target.set(30, 20, 0);
    this.controls.update();

    this.scene.add(this.body);
    this.scene.add(this.sketch);
    this.scene.add(this.datums);
    this.scene.add(this.supportPreviewGroup);
    this.scene.add(this.environment);
    this.scene.add(this.hoverGroup);
    this.scene.add(this.selectionGroup);
    this.addEnvironment();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();

    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointercancel", this.onPointerCancel);
    canvas.addEventListener("pointerleave", this.onPointerLeave);

    this.startLoop();
  }

  setTheme(theme: ViewportTheme): void {
    if (this.theme === theme || this.disposed) return;
    this.theme = theme;
    this.scene.background = new THREE.Color(this.background());
    this.addEnvironment();
    this.applyBodyTheme();
    this.rebuildSketchOverlay();
    this.setDatumPlanes(this.datumPlanes);
    this.setSupportPreview(this.supportPreviewFrame);
    this.dirty = true;
  }

  setHighlightColor(color: string): void {
    if (this.highlightColor === color || this.disposed) return;
    this.highlightColor = color;
    this.rebuildSelectionOverlays();
    this.rebuildSketchOverlay();
  }

  /**
   * Show the active extrude's source sketch on its plane. Lines are drawn over
   * the body (depthTest false), like Fusion's sketch preview, so the sketch
   * plane and the one-sided/symmetric direction are readable.
   */
  setSketchOverlay(overlay: SketchOverlayData | null): void {
    if (this.disposed) return;
    this.sketchOverlay = overlay;
    this.canvas.dataset.sketchOverlay = overlay ? "on" : "off";
    this.canvas.dataset.sketchCurves = String(overlay?.curves.length ?? 0);
    this.canvas.dataset.sketchFills = String(overlay?.fills?.length ?? 0);
    this.rebuildSketchOverlay();
    this.dirty = true;
  }

  /** Show datum planes as faint translucent quads with their local axes. */
  setDatumPlanes(planes: ReadonlyArray<DatumPlaneOverlay>): void {
    if (this.disposed) return;
    this.datumPlanes = planes;
    this.datumByFeature.clear();
    this.canvas.dataset.datumPlanes = String(planes.length);
    this.clearGroup(this.datums);
    const day = this.theme === "day";
    const fill = new THREE.MeshBasicMaterial({
      color: day ? 0x8c9aa6 : 0x8f9ca8,
      transparent: true,
      opacity: 0.07,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const line = new THREE.LineBasicMaterial({
      color: day ? 0x6d7b88 : 0x9aa7b3,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    const size = 80;
    for (const { featureId, frame } of planes) {
      this.datumByFeature.set(featureId, { featureId, frame });
      const matrix = new THREE.Matrix4()
        .makeBasis(
          new THREE.Vector3(...frame.xAxis),
          new THREE.Vector3(...frame.yAxis),
          new THREE.Vector3(...frame.normal),
        )
        .setPosition(new THREE.Vector3(...frame.origin));
      const plane = new THREE.PlaneGeometry(size, size);
      // Build the outline from the local plane, then transform both once. Edges
      // built from an already-transformed geometry would be transformed twice.
      const border = new THREE.EdgesGeometry(plane);
      plane.applyMatrix4(matrix);
      border.applyMatrix4(matrix);
      const mesh = new THREE.Mesh(plane, fill.clone());
      mesh.userData.datumId = featureId;
      mesh.renderOrder = 1;
      const outline = new THREE.LineSegments(border, line.clone());
      outline.renderOrder = 2;
      outline.raycast = () => {};
      this.datums.add(mesh);
      this.datums.add(outline);

      const axisGeometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-size / 2, 0, 0).applyMatrix4(matrix),
        new THREE.Vector3(size / 2, 0, 0).applyMatrix4(matrix),
        new THREE.Vector3(0, -size / 2, 0).applyMatrix4(matrix),
        new THREE.Vector3(0, size / 2, 0).applyMatrix4(matrix),
      ]);
      const axes = new THREE.LineSegments(axisGeometry, line.clone());
      axes.renderOrder = 2;
      axes.raycast = () => {};
      this.datums.add(axes);
    }
    fill.dispose();
    line.dispose();
    this.rebuildSelectionOverlays();
    this.dirty = true;
  }

  /** Dim the body while a support choice is being previewed. */
  setDimmed(dimmed: boolean): void {
    if (this.dimmed === dimmed) return;
    this.dimmed = dimmed;
    this.canvas.dataset.bodyDimmed = dimmed ? "on" : "off";
    this.applyBodyTheme();
    this.dirty = true;
  }

  /** Preview the plane a new sketch will use, without touching datum planes. */
  setSupportPreview(frame: PlaneFrame | null): void {
    if (this.disposed) return;
    this.supportPreviewFrame = frame;
    this.canvas.dataset.supportPreview = frame ? "on" : "off";
    this.clearGroup(this.supportPreviewGroup);
    if (!frame) {
      this.dirty = true;
      return;
    }
    const matrix = new THREE.Matrix4()
      .makeBasis(
        new THREE.Vector3(...frame.xAxis),
        new THREE.Vector3(...frame.yAxis),
        new THREE.Vector3(...frame.normal),
      )
      .setPosition(new THREE.Vector3(...frame.origin));
    const size = 84;
    const plane = new THREE.PlaneGeometry(size, size);
    const border = new THREE.EdgesGeometry(plane);
    plane.applyMatrix4(matrix);
    border.applyMatrix4(matrix);
    const fill = new THREE.Mesh(
      plane,
      new THREE.MeshBasicMaterial({
        color: this.highlightColor,
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    fill.renderOrder = 3;
    fill.raycast = () => {};
    const outline = new THREE.LineSegments(
      border,
      new THREE.LineBasicMaterial({
        color: this.highlightColor,
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
      }),
    );
    outline.renderOrder = 4;
    outline.raycast = () => {};
    this.supportPreviewGroup.add(fill);
    this.supportPreviewGroup.add(outline);
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
      this.setHover(null);
      this.renderer.setAnimationLoop(null);
    }
  }

  setMesh(mesh: BodyMesh): void {
    this.clearBody();
    this.mesh = mesh;
    this.edgeUnit = edgeUnitForMesh(mesh);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3));
    geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    const material = new THREE.MeshStandardMaterial({
      color: this.bodyColor(),
      metalness: 0,
      roughness: 0.94,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    const solid = new THREE.Mesh(geometry, material);
    solid.name = "body";
    this.body.add(solid);
    this.solid = solid;

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
    this.edges = edges;

    if (!this.framed && geometry.boundingSphere) {
      this.frameAll();
      this.framed = true;
    }
    this.onPick?.(null);
    this.dirty = true;
  }

  clearMesh(): void {
    this.clearBody();
    this.framed = false;
    this.onPick?.(null);
    this.dirty = true;
  }

  clearPick(): void {
    this.selectedPick = null;
    this.clearGroup(this.selectionGroup);
    this.dirty = true;
  }

  frameAll(): void {
    const box = new THREE.Box3().setFromObject(this.body);
    if (box.isEmpty()) box.setFromObject(this.sketch);
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
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerCancel);
    this.canvas.removeEventListener("pointerleave", this.onPointerLeave);
    this.clearBody();
    this.clearSketchOverlay();
    this.clearEnvironment();
    this.renderer.dispose();
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (!this.active || event.button !== 0) return;
    this.pointerStart = {
      x: event.clientX,
      y: event.clientY,
      pointerId: event.pointerId,
    };
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.active || this.disposed) return;
    if (event.buttons !== 0) {
      this.setHover(null);
      return;
    }
    this.setHover(this.pickAt(event));
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (!this.active || this.disposed) return;
    const start = this.pointerStart;
    this.pointerStart = null;
    if (!start || start.pointerId !== event.pointerId || event.button !== 0) {
      return;
    }
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4) {
      return;
    }
    this.selectPick(this.pickAt(event));
  };

  private onPointerCancel = (): void => {
    this.pointerStart = null;
    this.setHover(null);
  };

  private onPointerLeave = (): void => {
    this.pointerStart = null;
    this.setHover(null);
  };

  private pickAt(event: PointerEvent): BodyPick | null {
    if (!this.mesh || !this.solid || !this.edges) return null;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;

    const ndc = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);

    const distance = this.camera.position.distanceTo(this.controls.target);
    const pixelSize =
      (2 *
        Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) *
        distance) /
      Math.max(1, rect.height);
    const threshold = Math.max(0.35, pixelSize * 8);
    this.raycaster.params.Line.threshold = threshold;

    const faceHit = this.raycaster.intersectObject(this.solid, false)[0] ?? null;
    const edgeHit = this.raycaster.intersectObject(this.edges, false)[0] ?? null;
    const datumHit =
      this.raycaster.intersectObjects(this.datums.children, false)[0] ?? null;

    // An edge on the surface is at roughly the same depth as the face. A hidden
    // back edge is farther away, so it must not win over the front face.
    if (edgeHit && (!faceHit || edgeHit.distance <= faceHit.distance + threshold)) {
      const group = edgeGroupForVertex(
        this.mesh,
        edgeHit.index ?? 0,
        this.edgeUnit,
      );
      if (group) return edgePick(group);
    }

    if (
      datumHit &&
      (!faceHit || datumHit.distance <= faceHit.distance + threshold)
    ) {
      const featureId = datumHit.object.userData.datumId;
      if (typeof featureId === "string") return datumPick(featureId);
    }

    if (faceHit && typeof faceHit.faceIndex === "number") {
      const group = faceGroupForTriangle(this.mesh, faceHit.faceIndex);
      if (group) return facePick(group);
    }
    return null;
  }

  private setHover(pick: BodyPick | null): void {
    if ((this.hoverPick?.id ?? null) === (pick?.id ?? null)) return;
    this.hoverPick = pick;
    this.clearGroup(this.hoverGroup);
    if (pick) this.addOverlay(this.hoverGroup, pick, false);
    this.canvas.dataset.hoverKind = pick?.kind ?? "";
    this.canvas.dataset.hoverId = pick?.id ?? "";
    this.dirty = true;
  }

  private selectPick(pick: BodyPick | null): void {
    this.selectedPick = pick;
    this.clearGroup(this.selectionGroup);
    if (pick) this.addOverlay(this.selectionGroup, pick, true);
    this.dirty = true;
    this.onPick?.(pick);
  }

  private rebuildSelectionOverlays(): void {
    const hover = this.hoverPick;
    const selected = this.selectedPick;
    this.clearGroup(this.hoverGroup);
    this.clearGroup(this.selectionGroup);
    if (hover) this.addOverlay(this.hoverGroup, hover, false);
    if (selected) this.addOverlay(this.selectionGroup, selected, true);
    this.dirty = true;
  }

  private addOverlay(
    group: THREE.Group,
    pick: BodyPick,
    selected: boolean,
  ): void {
    if (pick.kind === "datum") {
      const datum = pick.datumId ? this.datumByFeature.get(pick.datumId) : null;
      if (!datum) return;
      const size = 84;
      const matrix = new THREE.Matrix4()
        .makeBasis(
          new THREE.Vector3(...datum.frame.xAxis),
          new THREE.Vector3(...datum.frame.yAxis),
          new THREE.Vector3(...datum.frame.normal),
        )
        .setPosition(new THREE.Vector3(...datum.frame.origin));
      const geometry = new THREE.PlaneGeometry(size, size);
      geometry.applyMatrix4(matrix);
      const material = new THREE.MeshBasicMaterial({
        color: this.highlightColor,
        transparent: true,
        opacity: selected ? 0.3 : 0.14,
        depthTest: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const overlay = new THREE.Mesh(geometry, material);
      overlay.renderOrder = selected ? 5 : 4;
      overlay.raycast = () => {};
      group.add(overlay);
      return;
    }

    if (!this.mesh) return;

    if (pick.kind === "face") {
      const face = this.mesh.faceGroups.find(
        (candidate) =>
          candidate.faceId === pick.faceId &&
          (pick.origin === undefined || candidate.origin === pick.origin),
      );
      if (!face || face.count <= 0) return;

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.BufferAttribute(this.mesh.positions, 3),
      );
      geometry.setAttribute(
        "normal",
        new THREE.BufferAttribute(this.mesh.normals, 3),
      );
      geometry.setIndex(
        new THREE.BufferAttribute(
          this.mesh.indices.slice(face.start, face.start + face.count),
          1,
        ),
      );
      const material = new THREE.MeshBasicMaterial({
        color: this.highlightColor,
        transparent: true,
        opacity: selected ? 0.38 : 0.2,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        side: THREE.DoubleSide,
      });
      const overlay = new THREE.Mesh(geometry, material);
      overlay.renderOrder = selected ? 4 : 3;
      overlay.raycast = () => {};
      group.add(overlay);
      return;
    }

    const edge = this.mesh.edgeGroups.find(
      (candidate) => candidate.edgeId === pick.edgeId,
    );
    if (!edge) return;
    const positions = edgePositionsForGroup(this.mesh, edge, this.edgeUnit);
    if (positions.length < 6) return;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = new THREE.LineBasicMaterial({
      color: this.highlightColor,
      transparent: true,
      opacity: selected ? 1 : 0.6,
      depthTest: false,
      depthWrite: false,
    });
    const overlay = new THREE.LineSegments(geometry, material);
    overlay.renderOrder = selected ? 6 : 5;
    overlay.raycast = () => {};
    group.add(overlay);
  }

  private clearGroup(group: THREE.Group): void {
    for (const child of [...group.children]) {
      group.remove(child);
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

  private addEnvironment(): void {
    this.clearEnvironment();

    const day = this.theme === "day";
    this.environment.add(
      new THREE.HemisphereLight(
        day ? 0xffffff : 0xa5a396,
        day ? 0xf0efe8 : 0x1a1a17,
        day ? 1.25 : 1.05,
      ),
    );

    const key = new THREE.DirectionalLight(0xffffff, day ? 1.15 : 1.85);
    key.position.set(120, -90, 180);
    this.environment.add(key);

    const fill = new THREE.DirectionalLight(
      day ? 0xffffff : 0xb9b6a8,
      day ? 0.55 : 0.55,
    );
    fill.position.set(-140, 120, 40);
    this.environment.add(fill);

    // The model is a drawing on paper, not a viewport with wallpaper. The
    // sketch grid is the snap grid; the 3D stage keeps only the body and its
    // B-rep edges. Orientation is stated in the stage foot (Z-up · mm).
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
          material.transparent = this.dimmed;
          material.opacity = this.dimmed ? 0.32 : 1;
          material.depthWrite = !this.dimmed;
          material.needsUpdate = true;
        }
      } else if (child instanceof THREE.LineSegments) {
        const material = child.material;
        if (material instanceof THREE.LineBasicMaterial) {
          material.color.setHex(this.edgeColor());
          material.transparent = this.dimmed;
          material.opacity = this.dimmed ? 0.4 : 1;
          material.needsUpdate = true;
        }
      }
    }
  }

  private background(): number {
    return this.theme === "day" ? 0xfbfbf9 : 0x111110;
  }

  private bodyColor(): number {
    return this.theme === "day" ? 0xf5f2e8 : 0x77756b;
  }

  private edgeColor(): number {
    return this.theme === "day" ? 0x161614 : 0xf2efe3;
  }

  private rebuildSketchOverlay(): void {
    this.clearSketchOverlay();
    const overlay = this.sketchOverlay;
    if (!overlay) return;
    const highlighter = this.highlightColor;
    const ink = this.theme === "day" ? "#141412" : "#f2efe3";
    const dim = this.theme === "day" ? "#87847a" : "#807d72";
    const resolution = new THREE.Vector2(
      Math.max(1, this.canvas.clientWidth),
      Math.max(1, this.canvas.clientHeight),
    );
    const frameMatrix = overlay.frame
      ? new THREE.Matrix4()
          .makeBasis(
            new THREE.Vector3(...overlay.frame.xAxis),
            new THREE.Vector3(...overlay.frame.yAxis),
            new THREE.Vector3(...overlay.frame.normal),
          )
          .setPosition(new THREE.Vector3(...overlay.frame.origin))
      : null;
    const frameGeometry = <T extends THREE.BufferGeometry>(geometry: T): T => {
      if (frameMatrix) geometry.applyMatrix4(frameMatrix);
      return geometry;
    };

    const lineMaterial = (
      color: string,
      width: number,
      opacity: number,
      dashed = false,
    ): LineMaterial => {
      const material = new LineMaterial({
        color,
        linewidth: width,
        transparent: true,
        opacity,
        depthTest: false,
        depthWrite: false,
        dashed,
        dashSize: 3,
        gapSize: 2,
        resolution,
      });
      this.sketchLineMaterials.add(material);
      return material;
    };

    for (const fill of overlay.fills ?? []) {
      const ring = (
        points: ReadonlyArray<readonly [number, number]>,
      ): THREE.Vector2[] => {
        const out = points.map(([x, y]) => new THREE.Vector2(x, y));
        if (out.length > 1) {
          const first = out[0]!;
          const last = out[out.length - 1]!;
          if (first.distanceTo(last) < 1e-9) out.pop();
        }
        return out;
      };
      const outer = ring(fill.outer);
      if (outer.length < 3) continue;
      const shape = new THREE.Shape(outer);
      for (const hole of fill.holes ?? []) {
        const loop = ring(hole);
        if (loop.length >= 3) shape.holes.push(new THREE.Path(loop));
      }
      const geometry = frameGeometry(new THREE.ShapeGeometry(shape));
      const material = new THREE.MeshBasicMaterial({
        color: highlighter,
        transparent: true,
        opacity: 0.18,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.renderOrder = 19;
      this.sketch.add(mesh);
    }

    for (const curve of overlay.curves) {
      if (curve.points.length < 2) continue;
      const positions = curve.points.flatMap(([x, y]) => [x, y, 0]);
      const makeLine = (material: LineMaterial, order: number): Line2 => {
        const geometry = new LineGeometry();
        geometry.setPositions(positions);
        frameGeometry(geometry);
        const line = new Line2(geometry, material);
        if (material.dashed) line.computeLineDistances();
        line.renderOrder = order;
        this.sketch.add(line);
        return line;
      };
      if (curve.construction) {
        makeLine(lineMaterial(dim, 1.2, 0.85, true), 20);
      } else {
        // The highlighter is the mark; the ink centerline is what makes it
        // readable over the solid. Never rely on linewidth alone.
        makeLine(lineMaterial(highlighter, 8, 0.42), 20);
        makeLine(lineMaterial(ink, 1.6, 0.95), 21);
      }
    }

    if (overlay.points.length > 0) {
      const positions = new Float32Array(overlay.points.length * 3);
      overlay.points.forEach((point, index) => {
        positions[index * 3] = point.position[0];
        positions[index * 3 + 1] = point.position[1];
        positions[index * 3 + 2] = 0;
      });
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      frameGeometry(geometry);
      const material = new THREE.PointsMaterial({
        color: ink,
        size: 3.5,
        sizeAttenuation: false,
        transparent: true,
        opacity: 0.95,
        depthTest: false,
        depthWrite: false,
      });
      const points = new THREE.Points(geometry, material);
      points.renderOrder = 22;
      this.sketch.add(points);
    }
  }

  private clearSketchOverlay(): void {
    for (const child of [...this.sketch.children]) {
      this.sketch.remove(child);
      const disposable = child as unknown as {
        geometry?: { dispose: () => void };
        material?: { dispose: () => void } | Array<{ dispose: () => void }>;
      };
      disposable.geometry?.dispose();
      if (Array.isArray(disposable.material)) {
        disposable.material.forEach((material) => material.dispose());
      } else {
        disposable.material?.dispose();
      }
    }
    for (const material of this.sketchLineMaterials) material.dispose();
    this.sketchLineMaterials.clear();
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
    this.mesh = null;
    this.solid = null;
    this.edges = null;
    this.hoverPick = null;
    this.selectedPick = null;
    this.canvas.dataset.hoverKind = "";
    this.canvas.dataset.hoverId = "";
    this.clearGroup(this.hoverGroup);
    this.clearGroup(this.selectionGroup);
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
    for (const material of this.sketchLineMaterials) {
      material.resolution.set(width, height);
    }
    this.dirty = true;
  }
}
