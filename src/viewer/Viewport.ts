import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import type { BodyDiff, BodyMesh } from "../core/kernel/protocol";
import {
  edgeFaceKey,
  edgeRefKey,
  faceRefKey,
  type EdgeGroup,
  type EdgeRef,
} from "../core/kernel/protocol";
import type { PlaneFrame } from "../core/types";
import type { OffsetHint } from "./offsetHint";
import {
  boxBetween,
  boxIsEmpty,
  pointInBox,
  polygonIsEmpty,
  polylineInBox,
  polylineTouchesPolygon,
  type ScreenPoint,
} from "./marquee";
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

/** What the model cursor may pick. Bodies wait for the multi-body work. */
export type ModelPickFilter = "all" | "edges" | "faces";

/** The overlapping picks under the cursor, for the Select Other chip. */
export interface PickInfo {
  candidates: readonly BodyPick[];
  index: number;
  /** Cursor position relative to the canvas, in CSS pixels. */
  x: number;
  y: number;
  /** The cursor hit something, but the active filter excluded it. */
  blocked: boolean;
}

export interface ViewportOptions {
  theme?: ViewportTheme;
  /** Highlighter colour for hover/selection overlays. */
  highlightColor?: string;
  /**
   * Ephemeral body selection callback; null means cleared. `additive` is the
   * Shift modifier at pick time (used for multi-edge selection). `info`
   * carries every overlapping candidate for Select Other.
   */
  onPick?: (
    pick: BodyPick | null,
    additive: boolean,
    info?: PickInfo,
  ) => void;
  /**
   * Edges enclosed (box) or touched (lasso) by a marquee gesture. An empty
   * list means the gesture selected nothing and must not change the selection.
   */
  onMarquee?: (picks: readonly BodyPick[], additive: boolean) => void;
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

/** The model selection gesture: click, window box, or freehand lasso. */
export type ModelPickTool = "select" | "box" | "lasso";

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
  /** Screen-space hover/selection edge materials, rebuilt with the pick. */
  private readonly overlayLineMaterials = new Set<LineMaterial>();
  private environment = new THREE.Group();
  private hoverGroup = new THREE.Group();
  private selectionGroup = new THREE.Group();
  private edgeSelectionGroup = new THREE.Group();
  private faceSelectionGroup = new THREE.Group();
  /** The faces one history feature introduced, highlighted on its step. */
  private featureGroup = new THREE.Group();
  private featureHighlightId: string | null = null;
  /** The pre-offset body shown as a ghost under an offset draft. */
  private ghostGroup = new THREE.Group();
  private ghostMesh: BodyMesh | null = null;
  /** Source-face boundary and normal arrows for an offset draft. */
  private offsetHintGroup = new THREE.Group();
  private offsetHint: OffsetHint | null = null;
  /** Added/removed material for an offset preview. */
  private diffGroup = new THREE.Group();
  private diff: BodyDiff | null = null;
  private theme: ViewportTheme;
  private highlightColor: string;
  private readonly onPick?: (
    pick: BodyPick | null,
    additive: boolean,
    info?: PickInfo,
  ) => void;
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
  private edgePicks: BodyPick[] = [];
  private facePicks: BodyPick[] = [];
  private pickFilter: ModelPickFilter = "all";
  private pickTool: ModelPickTool = "select";
  private marquee: {
    tool: "box" | "lasso";
    additive: boolean;
    pointerId: number;
    points: ScreenPoint[];
  } | null = null;
  private marqueeEl: HTMLDivElement | null = null;
  private readonly onMarquee?: (picks: readonly BodyPick[], additive: boolean) => void;
  private pickCandidates: BodyPick[] = [];
  private pickCandidateIndex = 0;
  private pickCursor = { x: 0, y: 0 };
  /** Swallow the pick for the current click (a background click dismisses an
   * operation instead of selecting through it). */
  private suppressClick = false;

  constructor(canvas: HTMLCanvasElement, options: ViewportOptions = {}) {
    this.canvas = canvas;
    this.theme = options.theme ?? "night";
    this.highlightColor = options.highlightColor ?? "#ddff00";
    this.canvas.dataset.highlightColor = this.highlightColor;
    this.onPick = options.onPick;
    this.onMarquee = options.onMarquee;
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
    this.scene.add(this.edgeSelectionGroup);
    this.scene.add(this.faceSelectionGroup);
    this.scene.add(this.featureGroup);
    this.scene.add(this.ghostGroup);
    this.scene.add(this.offsetHintGroup);
    this.scene.add(this.diffGroup);
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
    // Cut red and ghost ink are theme tokens, and the highlighter may be the
    // same value in both modes; re-materialise the diff even when the colour
    // effect below does not run.
    this.setDiff(this.diff);
    this.setOffsetHint(this.offsetHint);
    this.dirty = true;
  }

  setHighlightColor(color: string): void {
    if (this.highlightColor === color || this.disposed) return;
    this.highlightColor = color;
    this.canvas.dataset.highlightColor = color;
    // Every highlighter-coloured overlay is reconstructed from the new colour.
    // A face pick or a step's generated-face wash would otherwise keep the old
    // material until the selection or mesh changed.
    this.rebuildFeatureHighlight();
    this.rebuildSelectionOverlays();
    this.rebuildSketchOverlay();
    this.setSupportPreview(this.supportPreviewFrame);
    this.setDiff(this.diff);
    this.setOffsetHint(this.offsetHint);
    this.dirty = true;
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
    // The drawing sits on its plane in world depth, so the body occludes it.
    this.canvas.dataset.sketchDepth = overlay ? "depth" : "";
    this.rebuildSketchOverlay();
    // If the overlay landed after the first preview (the worker can answer
    // before the effect that sets it), frame once the plane is known.
    if (!this.framed && this.mesh) {
      this.frameDraft(overlay?.frame ?? null);
      this.framed = true;
    }
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
    this.canvas.dataset.supportPreviewOrigin = frame
      ? frame.origin.map((value) => value.toFixed(3)).join(",")
      : "";
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

    this.rebuildFeatureHighlight();
    this.rebuildEdgeSelection();
    this.rebuildFaceSelection();
    if (!this.framed && geometry.boundingSphere) {
      this.frameDraft(this.sketchOverlay?.frame ?? null);
      this.framed = true;
    }
    // A rebuild can remove a face/edge. Drop a selection only when its stable
    // ref is gone; an edit that merely re-hashes keeps the selection.
    if (this.selectedPick && !this.pickExists(this.selectedPick)) {
      this.selectedPick = null;
      this.onPick?.(null, false);
    }
    this.setDiff(mesh.diff ?? null);
    this.dirty = true;
  }

  /** Highlight a set of edges (model-mode multi-select). App owns the policy. */
  setEdgeSelection(picks: readonly BodyPick[]): void {
    this.edgePicks = picks.filter((pick) => pick.kind === "edge");
    this.rebuildEdgeSelection();
  }

  /** Highlight a set of selected faces (the shell/offset input). */
  setFaceSelection(picks: readonly BodyPick[]): void {
    this.facePicks = picks.filter(
      (pick) => pick.kind === "face" && pick.ref !== undefined,
    );
    this.rebuildFaceSelection();
  }

  private rebuildFaceSelection(): void {
    this.clearGroup(this.faceSelectionGroup);
    if (!this.mesh) return;
    for (const pick of this.facePicks) {
      this.addOverlay(this.faceSelectionGroup, pick, true);
    }
    this.dirty = true;
  }

  /**
   * Sync the single face overlay with App's face set, without firing a pick
   * callback. Toggling a face off used to leave its single selected overlay
   * behind (a stale 0.38 wash) even though the multi-set no longer had it.
   */
  setPickedFace(pick: BodyPick | null): void {
    this.selectedPick = pick?.kind === "face" ? pick : null;
    this.clearGroup(this.selectionGroup);
    if (this.selectedPick) {
      this.addOverlay(this.selectionGroup, this.selectedPick, true);
    }
    this.canvas.dataset.pickedFace =
      this.selectedPick?.ref !== undefined
        ? faceRefKey(this.selectedPick.ref)
        : "";
    this.dirty = true;
  }

  private rebuildEdgeSelection(): void {
    this.clearGroup(this.edgeSelectionGroup);
    if (!this.mesh) return;
    for (const pick of this.edgePicks) {
      this.addOverlay(this.edgeSelectionGroup, pick, true);
    }
    this.dirty = true;
  }

  /** True when the pick's stable ref still exists in the current mesh. */
  private pickExists(pick: BodyPick): boolean {
    if (!this.mesh) return false;
    if (pick.kind === "face") {
      const ref = pick.ref;
      if (!ref) return false;
      return this.mesh.faceGroups.some(
        (group) =>
          group.ref?.source === ref.source && group.ref.role === ref.role,
      );
    }
    if (pick.kind === "edge") {
      const ref = pick.edgeRef;
      if (!ref) return false;
      return this.edgeGroupForRef(ref) !== null;
    }
    return true;
  }

  /**
   * The edge group a ref names. The exact hint identity wins; after a rebuild
   * the hints may have moved, so fall back to the face pair and take the twin
   * whose midpoint is nearest the stored one.
   */
  private edgeGroupForRef(ref: EdgeRef): EdgeGroup | null {
    if (!this.mesh) return null;
    const key = edgeRefKey(ref);
    const exact = this.mesh.edgeGroups.find(
      (group) => group.ref !== undefined && edgeRefKey(group.ref) === key,
    );
    if (exact) return exact;
    const faceKey = edgeFaceKey(ref);
    const candidates = this.mesh.edgeGroups.filter(
      (group) => group.ref !== undefined && edgeFaceKey(group.ref) === faceKey,
    );
    if (candidates.length <= 1) return candidates[0] ?? null;
    const target = ref.hint.midpoint;
    if (!target) return candidates[0] ?? null;
    let best: EdgeGroup | null = null;
    let bestDistance = Infinity;
    for (const candidate of candidates) {
      const midpoint = candidate.ref?.hint.midpoint;
      if (!midpoint) continue;
      const distance = Math.hypot(
        midpoint[0] - target[0],
        midpoint[1] - target[1],
        midpoint[2] - target[2],
      );
      if (distance < bestDistance) {
        bestDistance = distance;
        best = candidate;
      }
    }
    return best ?? candidates[0] ?? null;
  }

  clearMesh(): void {
    this.clearBody();
    this.framed = false;
    this.onPick?.(null, false);
    this.dirty = true;
  }

  /** The next pointer-up is a dismissal, not a pick. */
  suppressNextClick(): void {
    this.suppressClick = true;
  }

  clearPick(): void {
    this.selectedPick = null;
    this.edgePicks = [];
    this.facePicks = [];
    this.pickCandidates = [];
    this.pickCandidateIndex = 0;
    this.clearGroup(this.selectionGroup);
    this.clearGroup(this.edgeSelectionGroup);
    this.clearGroup(this.faceSelectionGroup);
    this.canvas.dataset.pickedFace = "";
    this.dirty = true;
  }

  /** Highlight every face the given history feature introduced. */
  setFeatureHighlight(featureId: string | null): void {
    if (this.featureHighlightId === featureId) return;
    this.featureHighlightId = featureId;
    this.rebuildFeatureHighlight();
  }

  private rebuildFeatureHighlight(): void {
    this.clearGroup(this.featureGroup);
    const id = this.featureHighlightId;
    if (!id || !this.mesh) {
      this.canvas.dataset.featureHighlight = "";
      this.canvas.dataset.featureFaces = "0";
      this.canvas.dataset.featureTriangles = "0";
      this.dirty = true;
      return;
    }
    const mesh = this.mesh;
    let faces = 0;
    let triangles = 0;
    for (const face of mesh.faceGroups) {
      // Face roles travel with the feature that introduced them, so a join or
      // cut highlights only the geometry it added, not the whole body.
      if (face.ref?.source !== id || face.count <= 0) continue;
      faces += 1;
      triangles += face.count / 3;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.BufferAttribute(mesh.positions, 3),
      );
      geometry.setAttribute(
        "normal",
        new THREE.BufferAttribute(mesh.normals, 3),
      );
      geometry.setIndex(
        new THREE.BufferAttribute(
          mesh.indices.slice(face.start, face.start + face.count),
          1,
        ),
      );
      const material = new THREE.MeshBasicMaterial({
        color: this.highlightColor,
        transparent: true,
        opacity: 0.24,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        side: THREE.DoubleSide,
      });
      const overlay = new THREE.Mesh(geometry, material);
      overlay.renderOrder = 2;
      overlay.raycast = () => {};
      this.featureGroup.add(overlay);
    }
    this.canvas.dataset.featureHighlight = id;
    this.canvas.dataset.featureFaces = String(faces);
    this.canvas.dataset.featureTriangles = String(triangles);
    this.dirty = true;
  }

  /** Show the material an offset preview adds and removes. */
  setDiff(diff: BodyDiff | null): void {
    this.diff = diff;
    this.clearGroup(this.diffGroup);
    const added = diff?.added ?? null;
    const removed = diff?.removed ?? null;
    const ghost = diff?.ghost ?? null;
    const kinds = [
      added ? "added" : "",
      removed ? "removed" : "",
      ghost ? "ghost" : "",
    ].filter(Boolean);
    this.canvas.dataset.offsetDiff = kinds.join(",");
    this.canvas.dataset.offsetDiffAdded = String(
      (added?.indices.length ?? 0) / 3,
    );
    this.canvas.dataset.offsetDiffRemoved = String(
      (removed?.indices.length ?? 0) / 3,
    );
    this.canvas.dataset.offsetDiffGhost = String(
      (ghost?.indices.length ?? 0) / 3,
    );
    const addedColor = added ? this.highlightColor : "";
    const removedColor = removed ? this.cutColor() : "";
    const ghostColor = ghost ? this.ghostColor() : "";
    this.canvas.dataset.offsetDiffColors = [
      addedColor,
      removedColor,
      ghostColor,
    ]
      .filter(Boolean)
      .join(",");
    if (added) {
      this.addDiffMesh(added, addedColor, 0.34, 3);
    }
    if (removed) {
      this.addDiffMesh(removed, removedColor, 0.3, 4);
    }
    if (ghost) {
      this.addDiffMesh(ghost, ghostColor, 0.12, 2);
    }
    this.dirty = true;
  }

  private cutColor(): string {
    const value = getComputedStyle(this.canvas)
      .getPropertyValue("--cut")
      .trim();
    return value || (this.theme === "night" ? "#e26a6a" : "#b83b3b");
  }

  private ghostColor(): string {
    const value = getComputedStyle(this.canvas)
      .getPropertyValue("--ink-3")
      .trim();
    return value || (this.theme === "night" ? "#807d72" : "#87847a");
  }

  private addDiffMesh(
    mesh: { positions: Float32Array; indices: Uint32Array },
    color: string,
    opacity: number,
    renderOrder: number,
  ): void {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(mesh.positions, 3),
    );
    geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const overlay = new THREE.Mesh(geometry, material);
    overlay.renderOrder = renderOrder;
    overlay.raycast = () => {};
    this.diffGroup.add(overlay);
  }

  /** Show the pre-offset body as a wireframe/translucent ghost. */
  setGhostMesh(mesh: BodyMesh | null): void {
    if (this.ghostMesh === mesh && (mesh !== null || this.ghostGroup.children.length === 0)) {
      return;
    }
    this.ghostMesh = mesh;
    this.clearGroup(this.ghostGroup);
    this.canvas.dataset.offsetGhost = mesh ? "on" : "";
    if (mesh && mesh.positions.length > 0) {
      const color = this.theme === "night" ? "#c8d0da" : "#3a3a3a";
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.BufferAttribute(mesh.positions, 3),
      );
      geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
      const material = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.07,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const ghost = new THREE.Mesh(geometry, material);
      ghost.renderOrder = 0;
      ghost.raycast = () => {};
      this.ghostGroup.add(ghost);

      if (mesh.edgePositions.length > 0) {
        const edgeGeometry = new THREE.BufferGeometry();
        edgeGeometry.setAttribute(
          "position",
          new THREE.BufferAttribute(mesh.edgePositions, 3),
        );
        const edgeMaterial = new THREE.LineBasicMaterial({
          color,
          transparent: true,
          opacity: 0.45,
          depthTest: false,
        });
        const edges = new THREE.LineSegments(edgeGeometry, edgeMaterial);
        edges.renderOrder = 1;
        edges.raycast = () => {};
        this.ghostGroup.add(edges);
      }
    }
    this.dirty = true;
  }

  /** Dashed source face plus one normal arrow per selected offset face. */
  setOffsetHint(hint: OffsetHint | null): void {
    this.offsetHint = hint;
    this.clearGroup(this.offsetHintGroup);
    this.canvas.dataset.offsetHintSegments = hint
      ? String(hint.boundary.length / 6)
      : "";
    this.canvas.dataset.offsetHintArrows = hint
      ? String(hint.arrows.length)
      : "";
    if (!hint) {
      this.dirty = true;
      return;
    }

    if (hint.boundary.length > 0) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.BufferAttribute(hint.boundary, 3),
      );
      const material = new THREE.LineDashedMaterial({
        color: this.highlightColor,
        transparent: true,
        opacity: 0.85,
        dashSize: 1.8,
        gapSize: 1.5,
        depthTest: false,
      });
      const boundary = new THREE.LineSegments(geometry, material);
      boundary.computeLineDistances();
      boundary.renderOrder = 8;
      boundary.raycast = () => {};
      this.offsetHintGroup.add(boundary);
    }

    const color = this.edgeColor();
    for (const arrow of hint.arrows) {
      if (arrow.length < 1e-6) continue;
      const origin = new THREE.Vector3(...arrow.origin);
      const direction = new THREE.Vector3(...arrow.direction).normalize();
      const tip = origin.clone().addScaledVector(direction, arrow.length);
      const shaftGeometry = new THREE.BufferGeometry().setFromPoints([
        origin,
        tip,
      ]);
      const shaftMaterial = new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 1,
        depthTest: false,
        depthWrite: false,
      });
      const shaft = new THREE.LineSegments(shaftGeometry, shaftMaterial);
      shaft.renderOrder = 9;
      shaft.raycast = () => {};
      this.offsetHintGroup.add(shaft);

      const headLength = Math.min(arrow.length * 0.28, 3);
      const headRadius = Math.max(headLength * 0.32, 0.25);
      const headGeometry = new THREE.ConeGeometry(
        headRadius,
        headLength,
        10,
      );
      const headMaterial = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 1,
        depthTest: false,
        depthWrite: false,
      });
      const head = new THREE.Mesh(headGeometry, headMaterial);
      head.position.copy(tip).addScaledVector(direction, -headLength / 2);
      head.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        direction,
      );
      head.renderOrder = 9;
      head.raycast = () => {};
      this.offsetHintGroup.add(head);
    }
    this.dirty = true;
  }

  frameAll(): void {
    this.frameContents(new THREE.Vector3(0.9, -1.15, 0.75));
  }

  /**
   * Frame the body and the sketch overlay from an oblique view of `frame`'s
   * plane (DRAFT_VIEW §2.4). A world isometric hides an inclined sketch plane;
   * leaning on the frame's own axes keeps the profile readable without
   * switching to the flat sketch camera. `null` falls back to the world iso.
   */
  frameDraft(frame?: PlaneFrame | null): void {
    if (!frame) {
      this.frameAll();
      return;
    }
    const direction = new THREE.Vector3(...frame.xAxis)
      .multiplyScalar(0.9)
      .addScaledVector(new THREE.Vector3(...frame.yAxis), -1.15)
      .addScaledVector(new THREE.Vector3(...frame.normal), 0.75);
    this.frameContents(direction);
  }

  /**
   * The `look at sketch` preset: normal to the draft plane, still in the model
   * scene (DRAFT_VIEW §3). `null` means the default XY plane.
   */
  frameDraftNormal(frame?: PlaneFrame | null): void {
    this.frameContents(
      frame
        ? new THREE.Vector3(...frame.normal)
        : new THREE.Vector3(0, 0, 1),
    );
  }

  private frameContents(direction: THREE.Vector3): void {
    if (direction.lengthSq() === 0) direction.set(0.9, -1.15, 0.75);
    const box = new THREE.Box3().setFromObject(this.body);
    const sketchBox = new THREE.Box3().setFromObject(this.sketch);
    if (box.isEmpty()) box.copy(sketchBox);
    else if (!sketchBox.isEmpty()) box.union(sketchBox);
    if (box.isEmpty()) return;

    const center = box.getCenter(new THREE.Vector3());
    const radius = box.getSize(new THREE.Vector3()).length() / 2;
    const distance = (radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2))) * 1.6;

    this.camera.position
      .copy(center)
      .addScaledVector(direction.normalize(), distance);
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
    this.cancelMarquee();
    this.clearBody();
    this.clearGroup(this.ghostGroup);
    this.clearGroup(this.offsetHintGroup);
    this.clearGroup(this.diffGroup);
    this.clearSketchOverlay();
    this.clearEnvironment();
    this.renderer.dispose();
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (!this.active || event.button !== 0) return;
    if (this.pickTool !== "select") {
      if (!this.mesh) return;
      // A press starts a marquee. If it never moves, pointer-up falls through
      // to a normal pick (see onPointerUp), so a marquee tool can refine its
      // own selection without switching tools.
      this.setHover(null);
      this.marquee = {
        tool: this.pickTool,
        additive: event.shiftKey,
        pointerId: event.pointerId,
        points: [this.localPoint(event)],
      };
      this.canvas.setPointerCapture(event.pointerId);
      this.updateMarquee();
      return;
    }
    this.pointerStart = {
      x: event.clientX,
      y: event.clientY,
      pointerId: event.pointerId,
    };
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.active || this.disposed) return;
    if (this.marquee) {
      this.updateMarquee(this.localPoint(event));
      return;
    }
    if (event.buttons !== 0) {
      this.setHover(null);
      return;
    }
    this.setHover(this.pickAt(event));
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (!this.active || this.disposed) return;
    if (this.suppressClick) {
      this.suppressClick = false;
      this.pointerStart = null;
      return;
    }
    if (this.marquee) {
      const marquee = this.marquee;
      if (marquee.pointerId !== event.pointerId) return;
      const end = this.localPoint(event);
      this.updateMarquee(end);
      // A click with a marquee tool is a normal pick. Check the marquee's
      // shape, not the end-to-start distance: a closed lasso ends where it
      // began but is not a click.
      const empty =
        marquee.tool === "box"
          ? marquee.points.length < 2 ||
            boxIsEmpty(
              boxBetween(marquee.points[0]!, marquee.points[1]!),
            )
          : polygonIsEmpty(marquee.points);
      if (empty) {
        // The natural refine gesture: box everything, then Shift-click one
        // face/edge away without switching tools.
        this.cancelMarquee();
        this.commitClickPick(event);
        return;
      }
      const { picks, additive } = this.marqueeResult();
      this.cancelMarquee();
      this.onMarquee?.(picks, additive);
      return;
    }
    const start = this.pointerStart;
    this.pointerStart = null;
    if (!start || start.pointerId !== event.pointerId || event.button !== 0) {
      return;
    }
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4) {
      return;
    }
    this.commitClickPick(event);
  };

  /** A single click pick, with Select Other cycling for overlapping hits. */
  private commitClickPick(event: PointerEvent): void {
    const { candidates, ...info } = this.pickCandidatesAt(event);
    const sameOverlap =
      !event.shiftKey &&
      candidates.length > 1 &&
      candidates.length === this.pickCandidates.length &&
      candidates.every(
        (candidate, index) =>
          candidate.id === this.pickCandidates[index]?.id,
      ) &&
      Math.abs(info.x - this.pickCursor.x) <= 6 &&
      Math.abs(info.y - this.pickCursor.y) <= 6;
    this.pickCandidates = [...candidates];
    this.pickCursor = { x: info.x, y: info.y };
    this.pickCandidateIndex = sameOverlap
      ? (this.pickCandidateIndex + 1) % candidates.length
      : 0;
    this.selectPick(
      candidates[this.pickCandidateIndex] ?? null,
      event.shiftKey,
      {
        ...info,
        candidates,
        index: this.pickCandidateIndex,
      },
    );
  }

  private onPointerCancel = (): void => {
    this.pointerStart = null;
    this.suppressClick = false;
    this.cancelMarquee();
    this.setHover(null);
  };

  private onPointerLeave = (): void => {
    if (this.marquee) return;
    this.pointerStart = null;
    this.suppressClick = false;
    this.setHover(null);
  };

  /** Change the selection gesture. Box/lasso take over the drag. */
  setPickTool(tool: ModelPickTool): void {
    // Runtime guard: a bad key mapping once left this as "v".
    if (tool !== "select" && tool !== "box" && tool !== "lasso") return;
    if (this.pickTool === tool) return;
    this.pickTool = tool;
    this.canvas.dataset.pickTool = tool;
    // Orbit must not fight the marquee drag (it listens on the same canvas),
    // but the wheel still zooms while a marquee tool is active.
    const select = tool === "select";
    this.controls.enableRotate = select;
    this.controls.enablePan = select;
    this.cancelMarquee();
    this.setHover(null);
  }

  /** Change what the cursor may pick; the current selection is untouched. */
  setPickFilter(filter: ModelPickFilter): void {
    if (this.pickFilter === filter) return;
    this.pickFilter = filter;
    // The previous hover may be a kind the new filter excludes.
    this.setHover(null);
    this.dirty = true;
  }

  /** Advance the Select Other chip to the next overlapping candidate. */
  cyclePick(): void {
    if (this.pickCandidates.length < 2) return;
    this.pickCandidateIndex =
      (this.pickCandidateIndex + 1) % this.pickCandidates.length;
    const pick = this.pickCandidates[this.pickCandidateIndex] ?? null;
    this.selectPick(pick, false, {
      candidates: this.pickCandidates,
      index: this.pickCandidateIndex,
      ...this.pickCursor,
      blocked: false,
    });
  }

  private pickAt(event: PointerEvent): BodyPick | null {
    return this.pickCandidatesAt(event).candidates[0] ?? null;
  }

  /**
   * Every overlapping pick at the cursor. Edges win by depth but stay in the
   * list so Select Other can reach the face behind them; the filter removes
   * disallowed kinds and reports the hit as blocked instead of clearing.
   */
  private pickCandidatesAt(event: PointerEvent): {
    candidates: BodyPick[];
    x: number;
    y: number;
    blocked: boolean;
  } {
    const none = { candidates: [], x: 0, y: 0, blocked: false };
    if (!this.mesh || !this.solid || !this.edges) return none;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return none;
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    const ndc = new THREE.Vector2(
      (x / rect.width) * 2 - 1,
      -(y / rect.height) * 2 + 1,
    );
    // The controls move the camera between render frames, so its world matrix
    // can be stale here. Raycasting with a stale matrix makes the same screen
    // point resolve to different edges (at a corner) depending on frame
    // timing: hover and click disagree, and picking looks random.
    this.camera.updateMatrixWorld();
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
    const datumHit =
      this.raycaster.intersectObjects(this.datums.children, false)[0] ?? null;
    // Several edges can be inside the ray's line threshold at a corner. Pick
    // the one visually nearest the cursor, with the stable ref key as the
    // tie-break, so the same pixel always resolves to the same edge instead of
    // depending on ray-distance ordering (hover and click must agree).
    const edgeHits = this.raycaster
      .intersectObject(this.edges, false)
      .filter((hit) => !faceHit || hit.distance <= faceHit.distance + threshold)
      .map((hit) => {
        const group = edgeGroupForVertex(
          this.mesh!,
          hit.index ?? 0,
          this.edgeUnit,
        );
        if (!group) return null;
        const pick = edgePick(group);
        return {
          pick,
          screen: this.screenDistanceTo(hit.point, x, y, rect),
          key: pick.edgeRef ? edgeRefKey(pick.edgeRef) : pick.id,
        };
      })
      .filter(
        (
          candidate,
        ): candidate is {
          pick: BodyPick;
          screen: number;
          key: string;
        } => candidate !== null,
      )
      .sort((a, b) =>
        Math.abs(a.screen - b.screen) < 0.5
          ? a.key.localeCompare(b.key)
          : a.screen - b.screen,
      );
    const edgePickValue = edgeHits[0]?.pick ?? null;

    const facePickValue =
      faceHit && typeof faceHit.faceIndex === "number"
        ? (() => {
            const group = faceGroupForTriangle(this.mesh!, faceHit.faceIndex);
            return group ? facePick(group) : null;
          })()
        : null;
    const datumPickValue =
      datumHit &&
      (!faceHit || datumHit.distance <= faceHit.distance + threshold) &&
      typeof datumHit.object.userData.datumId === "string"
        ? datumPick(datumHit.object.userData.datumId)
        : null;

    const hits: BodyPick[] = [];
    if (this.pickFilter === "edges") {
      if (edgePickValue) hits.push(edgePickValue);
    } else if (this.pickFilter === "faces") {
      if (facePickValue) hits.push(facePickValue);
    } else {
      if (edgePickValue) hits.push(edgePickValue);
      if (datumPickValue) hits.push(datumPickValue);
      if (facePickValue) hits.push(facePickValue);
    }
    // Dedupe by id without reordering the depth priority.
    const candidates = hits.filter(
      (pick, index) => hits.findIndex((other) => other.id === pick.id) === index,
    );
    const blocked =
      candidates.length === 0 &&
      Boolean(faceHit || edgeHits.length > 0 || datumHit);
    return { candidates, x, y, blocked };
  }

  private localPoint(event: PointerEvent): ScreenPoint {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  /** Draw the in-progress box or lasso in stage coordinates. */
  private updateMarquee(point?: ScreenPoint): void {
    const marquee = this.marquee;
    if (!marquee) return;
    if (point) {
      if (marquee.tool === "lasso") {
        const previous = marquee.points[marquee.points.length - 1];
        if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) > 2) {
          marquee.points.push(point);
        }
      } else {
        marquee.points[1] = point;
      }
    }
    const el =
      this.marqueeEl ??
      (() => {
        const created = document.createElement("div");
        created.className = "model-marquee";
        created.dataset.testid = "model-marquee";
        created.style.position = "absolute";
        created.style.pointerEvents = "none";
        created.style.zIndex = "6";
        this.canvas.parentElement?.appendChild(created);
        this.marqueeEl = created;
        return created;
      })();

    if (marquee.tool === "box") {
      const box = boxBetween(
        marquee.points[0]!,
        marquee.points[1] ?? marquee.points[0]!,
      );
      el.replaceChildren();
      el.style.left = `${box.minX}px`;
      el.style.top = `${box.minY}px`;
      el.style.width = `${box.maxX - box.minX}px`;
      el.style.height = `${box.maxY - box.minY}px`;
      el.style.border = `1px dashed ${this.highlightColor}`;
      el.style.background = `${this.highlightColor}1f`;
      return;
    }

    el.style.left = "0";
    el.style.top = "0";
    el.style.width = "100%";
    el.style.height = "100%";
    el.style.border = "none";
    el.style.background = "none";
    const rect = this.canvas.getBoundingClientRect();
    el.innerHTML = `<svg width="${rect.width}" height="${rect.height}" style="display:block"><polyline fill="${this.highlightColor}1f" stroke="${this.highlightColor}" stroke-width="1" stroke-dasharray="3 3" points="${marquee.points
      .map((item) => `${item.x.toFixed(1)},${item.y.toFixed(1)}`)
      .join(" ")}" /></svg>`;
  }

  private cancelMarquee(): void {
    if (this.marquee) {
      const pointerId = this.marquee.pointerId;
      this.marquee = null;
      if (this.canvas.hasPointerCapture(pointerId)) {
        this.canvas.releasePointerCapture(pointerId);
      }
    }
    this.marqueeEl?.remove();
    this.marqueeEl = null;
  }

  /** Edges enclosed by the box or touched by the lasso. */
  private marqueeResult(): { picks: BodyPick[]; additive: boolean } {
    const marquee = this.marquee;
    const none = { picks: [], additive: marquee?.additive ?? false };
    if (!marquee || !this.mesh || !this.edges) return none;
    const rect = this.canvas.getBoundingClientRect();
    const points = marquee.points;
    if (marquee.tool === "box") {
      if (points.length < 2 || boxIsEmpty(boxBetween(points[0]!, points[1]!))) {
        return none;
      }
    } else if (polygonIsEmpty(points)) {
      return none;
    }
    this.camera.updateMatrixWorld();
    const box =
      marquee.tool === "box" ? boxBetween(points[0]!, points[1]!) : null;
    const picks = new Map<string, BodyPick>();
    if (this.pickFilter === "faces") {
      for (const group of this.mesh.faceGroups) {
        if (!group.ref) continue;
        const triangles = this.projectFace(group, rect);
        if (!triangles) continue;
        const hit = box
          ? triangles.every((triangle) =>
              triangle.every((point) => pointInBox(point, box)),
            )
          : triangles.some((triangle) =>
              polylineTouchesPolygon(
                [...triangle, triangle[0]!],
                points,
              ),
            );
        if (!hit) continue;
        picks.set(faceRefKey(group.ref), facePick(group));
      }
    } else {
      for (const group of this.mesh.edgeGroups) {
        if (!group.ref) continue;
        const screen = this.projectPolyline(
          edgePositionsForGroup(this.mesh, group, this.edgeUnit),
          rect,
        );
        if (!screen) continue;
        const hit = box
          ? polylineInBox(screen, box)
          : polylineTouchesPolygon(screen, points);
        if (!hit) continue;
        picks.set(edgeRefKey(group.ref), edgePick(group));
      }
    }
    // A stable order keeps the selection (and its popover list) deterministic.
    return {
      picks: [...picks.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([, pick]) => pick),
      additive: marquee.additive,
    };
  }

  /**
   * The face's mesh triangles as screen-space point triples. A face with any
   * triangle behind the camera is skipped (its projection is meaningless).
   */
  private projectFace(
    group: { start: number; count: number },
    rect: DOMRect,
  ): Array<[ScreenPoint, ScreenPoint, ScreenPoint]> | null {
    if (!this.mesh) return null;
    const positions = this.mesh.positions;
    const indices = this.mesh.indices;
    this.camera.updateMatrixWorld();
    const point = new THREE.Vector3();
    const project = (index: number): ScreenPoint | null => {
      point.set(
        positions[index * 3]!,
        positions[index * 3 + 1]!,
        positions[index * 3 + 2]!,
      );
      if (
        point.clone().applyMatrix4(this.camera.matrixWorldInverse).z >
        -this.camera.near
      ) {
        return null;
      }
      point.project(this.camera);
      return {
        x: (point.x * 0.5 + 0.5) * rect.width,
        y: (-point.y * 0.5 + 0.5) * rect.height,
      };
    };
    const triangles: Array<[ScreenPoint, ScreenPoint, ScreenPoint]> = [];
    for (let i = group.start; i + 2 < group.start + group.count; i += 3) {
      const a = project(indices[i]!);
      const b = project(indices[i + 1]!);
      const c = project(indices[i + 2]!);
      if (!a || !b || !c) return null;
      triangles.push([a, b, c]);
    }
    return triangles.length > 0 ? triangles : null;
  }

  private projectPolyline(
    positions: Float32Array,
    rect: DOMRect,
  ): ScreenPoint[] | null {
    const screen: ScreenPoint[] = [];
    const point = new THREE.Vector3();
    for (let i = 0; i + 2 < positions.length; i += 3) {
      point.set(positions[i]!, positions[i + 1]!, positions[i + 2]!);
      // Points at or behind the camera have no meaningful screen position.
      if (point.clone().applyMatrix4(this.camera.matrixWorldInverse).z > -this.camera.near) {
        return null;
      }
      point.project(this.camera);
      screen.push({
        x: (point.x * 0.5 + 0.5) * rect.width,
        y: (-point.y * 0.5 + 0.5) * rect.height,
      });
    }
    return screen.length >= 2 ? screen : null;
  }

  /** Cursor distance in CSS pixels from a world point on the canvas. */
  private screenDistanceTo(
    point: THREE.Vector3,
    x: number,
    y: number,
    rect: DOMRect,
  ): number {
    const projected = point.clone().project(this.camera);
    return Math.hypot(
      (projected.x * 0.5 + 0.5) * rect.width - x,
      (-projected.y * 0.5 + 0.5) * rect.height - y,
    );
  }

  private setHover(pick: BodyPick | null): void {
    if ((this.hoverPick?.id ?? null) === (pick?.id ?? null)) return;
    this.hoverPick = pick;
    this.clearGroup(this.hoverGroup);
    if (pick) this.addOverlay(this.hoverGroup, pick, false);
    this.canvas.dataset.hoverKind = pick?.kind ?? "";
    this.canvas.dataset.hoverId = pick?.id ?? "";
    this.canvas.dataset.hoverEdgeLength =
      pick?.kind === "edge" && pick.edgeRef?.hint.length !== undefined
        ? String(pick.edgeRef.hint.length)
        : "";
    this.canvas.dataset.hoverEdgeRef =
      pick?.kind === "edge" && pick.edgeRef
        ? JSON.stringify(pick.edgeRef)
        : "";
    this.dirty = true;
  }

  private selectPick(
    pick: BodyPick | null,
    additive = false,
    info?: PickInfo,
  ): void {
    if (info?.blocked) {
      // The filter excluded the hit; keep the current selection.
      this.onPick?.(null, additive, info);
      return;
    }
    // Edges are multi-selectable; App drives their highlight set and the
    // additive policy. Faces/datum remain a single selected pick.
    if (pick?.kind !== "edge") {
      this.selectedPick = pick;
      this.clearGroup(this.selectionGroup);
      if (pick) this.addOverlay(this.selectionGroup, pick, true);
      this.canvas.dataset.pickedFace =
        pick?.kind === "face" && pick.ref ? faceRefKey(pick.ref) : "";
    }
    this.dirty = true;
    this.onPick?.(pick, additive, info);
  }

  private rebuildSelectionOverlays(): void {
    const hover = this.hoverPick;
    const selected = this.selectedPick;
    this.clearGroup(this.hoverGroup);
    this.clearGroup(this.selectionGroup);
    if (hover) this.addOverlay(this.hoverGroup, hover, false);
    if (selected) this.addOverlay(this.selectionGroup, selected, true);
    this.rebuildEdgeSelection();
    this.rebuildFaceSelection();
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

    const edge = pick.edgeRef
      ? this.edgeGroupForRef(pick.edgeRef)
      : this.mesh.edgeGroups.find(
          (candidate) => candidate.edgeId === pick.edgeId,
        );
    if (!edge) return;
    const positions = edgePositionsForGroup(this.mesh, edge, this.edgeUnit);
    if (positions.length < 6) return;

    // WebGL ignores LineBasicMaterial.linewidth. Use Line2's screen-space
    // quads. The selected edge is the same pair as a sketch line: a soft
    // highlighter block under an ink centerline. Hover is the block alone, over
    // the body ink that is already there.
    const addLine = (
      color: string | number,
      width: number,
      opacity: number,
      renderOrder: number,
    ): void => {
      const geometry = new LineSegmentsGeometry();
      geometry.setPositions(Array.from(positions));
      const material = new LineMaterial({
        color,
        linewidth: width,
        transparent: true,
        opacity,
        // The pair sits slightly in front of the body so it reads on its own
        // face, but it still respects other geometry: a selected edge behind a
        // cylinder must not paint over it.
        depthTest: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
        resolution: new THREE.Vector2(
          Math.max(1, this.canvas.clientWidth),
          Math.max(1, this.canvas.clientHeight),
        ),
      });
      this.overlayLineMaterials.add(material);
      const overlay = new LineSegments2(geometry, material);
      overlay.renderOrder = renderOrder;
      overlay.raycast = () => {};
      group.add(overlay);
    };

    if (selected) {
      addLine(this.highlightColor, 9, 0.5, 5);
      addLine(this.edgeColor(), 1.7, 1, 6);
    } else {
      addLine(this.highlightColor, 5, 0.7, 5);
    }
  }

  private clearGroup(group: THREE.Group): void {
    for (const child of [...group.children]) {
      group.remove(child);
      if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((material) => material.dispose());
        } else {
          if (child.material instanceof LineMaterial) {
            this.overlayLineMaterials.delete(child.material);
          }
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
        // The sketch is real geometry on its plane: keep it behind the body
        // when it is, and let a small depth bias win against the coincident
        // face it was drawn on. Line2 renders triangle quads, so the offset
        // works despite the name.
        depthTest: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
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
        depthTest: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
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
      geometry.translate(0, 0, 0.05);
      frameGeometry(geometry);
      const material = new THREE.PointsMaterial({
        color: ink,
        size: 3.5,
        sizeAttenuation: false,
        transparent: true,
        opacity: 0.95,
        // GL_POINTS ignores polygon offset; the positions are nudged along the
        // plane normal below instead.
        depthTest: true,
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
    this.diff = null;
    this.clearGroup(this.diffGroup);
    this.offsetHint = null;
    this.clearGroup(this.offsetHintGroup);
    this.canvas.dataset.offsetHintSegments = "";
    this.canvas.dataset.offsetHintArrows = "";
    this.hoverPick = null;
    this.selectedPick = null;
    this.edgePicks = [];
    this.pickCandidates = [];
    this.pickCandidateIndex = 0;
    this.canvas.dataset.hoverKind = "";
    this.canvas.dataset.hoverId = "";
    this.canvas.dataset.hoverEdgeLength = "";
    this.canvas.dataset.hoverEdgeRef = "";
    this.canvas.dataset.pickedFace = "";
    this.clearGroup(this.hoverGroup);
    this.clearGroup(this.selectionGroup);
    this.clearGroup(this.edgeSelectionGroup);
    this.clearGroup(this.faceSelectionGroup);
    this.clearGroup(this.featureGroup);
    this.canvas.dataset.featureHighlight = "";
    this.canvas.dataset.featureFaces = "0";
    this.canvas.dataset.featureTriangles = "0";
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
      // Publish the settled camera for tests: orbit damping moves it for a few
      // frames after the gesture, and a screen-space scan taken mid-drift can
      // miss an edge (or pick a different one) at the same pixel.
      this.canvas.dataset.camera = [
        ...this.camera.position.toArray(),
        ...this.controls.target.toArray(),
      ]
        .map((value) => value.toFixed(3))
        .join(",");
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
    for (const material of this.overlayLineMaterials) {
      material.resolution.set(width, height);
    }
    this.dirty = true;
  }
}
