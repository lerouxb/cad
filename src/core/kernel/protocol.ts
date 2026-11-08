import type { PlaneFrame, ProfileLoop, Vec2, Vec3 } from "../types";

export type { ProfileLoop };

/** One closed profile: an outer boundary plus its holes. */
export interface ProfileRegion {
  outer: ProfileLoop;
  holes: ProfileLoop[];
}

export interface ExtrudeParams {
  /** Selected regions; each becomes a solid and the solids are fused. */
  regions: ProfileRegion[];
  height: number;
  /** Two-sided extrude around the sketch plane. */
  symmetric?: boolean;
  /** `blind` uses height; `throughAll` cuts the current body's full extent. */
  end?: "blind" | "throughAll";
  /** Local sketch plane -> world. Omitted for the XY world plane. */
  frame?: PlaneFrame;
}

/** A profile revolved around an in-plane sketch axis. */
export interface RevolveParams {
  regions: ProfileRegion[];
  /** Local sketch-plane coordinates; the axis is infinite in both directions. */
  axis: { at: Vec2; direction: Vec2 };
  /** Degrees, 1–360. */
  angle: number;
  direction: "ccw" | "cw";
  frame?: PlaneFrame;
}

/** Plain-JSON geometric hint for fallback matching when a role dies. */
export interface TopoHint {
  entityType: "face";
  surfaceType?: string;
  normal?: [number, number, number];
  centroid?: [number, number, number];
  area?: number;
  /** Radius of a full cylindrical hole/boss wall, when known. */
  radius?: number;
  /** +1 for a boss wall, -1 for a hole wall (normal points into the void). */
  radialSign?: 1 | -1;
}

/**
 * A stable reference to a face, never a kernel hash or an array index. The
 * worker creates it with `assignRoles` + `captureHint`/`createRef`; the main
 * thread may store it as JSON in a document later (M4).
 */
export interface TopoRef {
  source: string;
  kind: "face";
  role: string;
  hint: TopoHint;
}

/** Geometric snapshot of an edge; a tiebreaker when faces share several. */
export interface EdgeHint {
  entityType: "edge";
  length?: number;
  midpoint?: [number, number, number];
}

/**
 * A stable reference to an edge, identified by the two faces it bounds. An
 * edge *is* the intersection of its adjacent faces, so a face-role change (an
 * upstream edit or a fillet trimming it) keeps the reference resolvable as
 * long as both faces still meet.
 */
export interface EdgeRef {
  kind: "edge";
  /** The two adjacent faces, in no particular order. */
  faces: [TopoRef, TopoRef];
  hint: EdgeHint;
}

/** Stable, rebuild-independent identity for a face reference. */
export function faceRefKey(ref: TopoRef): string {
  return `${ref.source}|${ref.role}`;
}

/**
 * Face-pair identity: stable across geometry edits, but not unique in a mesh.
 * A face role can map to several faces after a boolean, and two coincident or
 * tangent edges can bound the same pair, so distinct edges can share this.
 */
export function edgeFaceKey(ref: EdgeRef): string {
  const faces = ref.faces
    .map((face) => `${face.source}:${face.role}`)
    .sort()
    .join("|");
  return `edge:${faces}`;
}

function edgeHintKey(ref: EdgeRef): string {
  const midpoint = ref.hint.midpoint
    ? ref.hint.midpoint.map((value) => value.toFixed(3)).join(",")
    : "";
  const length =
    ref.hint.length !== undefined ? ref.hint.length.toFixed(3) : "";
  return `${length}@${midpoint}`;
}

/**
 * Identity for picking and selection. The geometric hint is part of the key:
 * on the cat-face body the bottom-left arc and the long top arc both bound
 * `face_4|face_1`, and a face-pair-only key made hover skip the second edge and
 * selection treat both as one. Use `edgeFaceKey` when a reference must survive
 * a geometry edit (the viewer falls back to it when hints have moved).
 */
export function edgeRefKey(ref: EdgeRef): string {
  return `${edgeFaceKey(ref)}#${edgeHintKey(ref)}`;
}

export function edgeRefsEqual(a: EdgeRef, b: EdgeRef): boolean {
  return edgeRefKey(a) === edgeRefKey(b);
}

export interface FaceGroup {
  /** Start index in the triangle index buffer. */
  start: number;
  /** Number of indices in this group. */
  count: number;
  faceId: number;
  /** brepjs face-origin id, the basis for stable references later. */
  origin: number;
  /** Stable face reference for selections; JSON-safe. */
  ref?: TopoRef;
}

export interface EdgeGroup {
  /** Start vertex index in `edgePositions` (2 vertices per segment). */
  start: number;
  count: number;
  edgeId: number;
  /** Stable edge reference for selections; JSON-safe. */
  ref?: EdgeRef;
}

export interface BodyStats {
  faces: number;
  edges: number;
  triangles: number;
  volume: number;
  buildMs: number;
  /** Solid bodies in the result (a boolean can wrap a compound). */
  bodies: number;
  /** Shells across those bodies; a watertight solid with a hole is one shell. */
  shells: number;
  /**
   * OCCT's BRepCheck validity: closed shells (watertight) and consistent
   * orientation. A raw "open edge" count is not exposed: a seam edge belongs to
   * one face and would be misreported as a boundary edge.
   */
  valid: boolean;
  /** [minX, minY, minZ, maxX, maxY, maxZ] in model millimetres. */
  bounds: [number, number, number, number, number, number];
}

/** One side of an offset draft's boolean difference. */
export interface DiffMesh {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

/** Material the preview adds and removes relative to the prefix body. */
export interface BodyDiff {
  added: DiffMesh | null;
  removed: DiffMesh | null;
  /** Material a boolean discards without cutting: intersect context/tool. */
  ghost?: DiffMesh | null;
}

/** Renderable output of one rebuild. Typed arrays are transferred, not copied. */
export interface BodyMesh {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  faceGroups: FaceGroup[];
  edgePositions: Float32Array;
  edgeGroups: EdgeGroup[];
  /** Only present for a previewed offset draft. */
  diff?: BodyDiff;
  stats: BodyStats;
}

export type KernelOperation = "new" | "join" | "cut" | "intersect";

interface KernelFeatureBase {
  featureId: string;
  /** hash(canonical(feature) + upstreamKey); also the worker cache key. */
  cacheKey: string;
  /** Ask the worker for the added/removed/ghost boolean-difference meshes. */
  preview?: boolean;
}

/** One resolved extrude in history order, with the main-thread cache key. */
export interface KernelExtrudeFeature extends KernelFeatureBase {
  kind: "extrude";
  params: ExtrudeParams;
  operation: KernelOperation;
}

/** A profile revolved around an in-plane sketch axis. */
export interface KernelRevolveFeature extends KernelFeatureBase {
  kind: "revolve";
  params: RevolveParams;
  operation: KernelOperation;
}

/** A constant-radius fillet on selected edges of the current body. */
export interface KernelFilletFeature extends KernelFeatureBase {
  kind: "fillet";
  edges: EdgeRef[];
  radius: number;
}

/** A constant-distance chamfer on selected edges of the current body. */
export interface KernelChamferFeature extends KernelFeatureBase {
  kind: "chamfer";
  edges: EdgeRef[];
  distance: number;
}

/** A shell on the current body; `faces` are the faces to remove. */
export interface KernelShellFeature extends KernelFeatureBase {
  kind: "shell";
  faces: TopoRef[];
  thickness: number;
}

/** Move planar faces along their normals; the sign picks out or in. */
export interface KernelOffsetFaceFeature extends KernelFeatureBase {
  kind: "offsetFace";
  faces: TopoRef[];
  distance: number;
}

export type KernelEdgeBlendFeature =
  | KernelFilletFeature
  | KernelChamferFeature;

export type KernelFeature =
  | KernelExtrudeFeature
  | KernelRevolveFeature
  | KernelFilletFeature
  | KernelChamferFeature
  | KernelShellFeature
  | KernelOffsetFaceFeature;

export interface FeatureBuildStatus {
  featureId: string;
  status: "ok" | "error" | "skipped";
  /** True when the worker reused a previously built prefix solid. */
  cached: boolean;
  message?: string;
}

/** File formats the worker can derive from a cached prefix solid. */
export type ExportFormat = "stl" | "step";

/** A face or edge the measure tool can consume. */
export type MeasureTarget =
  | { kind: "face"; ref: TopoRef }
  | { kind: "edge"; ref: EdgeRef };

/** Exact measurements from the kernel. Absent fields do not apply. */
export interface MeasureResult {
  /** Face area, or the body's surface area, in mm². */
  area?: number;
  /** Face boundary length (all wires), in mm. */
  perimeter?: number;
  /** Edge length, in mm. */
  length?: number;
  /** Radius of a circular edge or arc, in mm. */
  radius?: number;
  /** Minimum distance between two targets, in mm. */
  distance?: number;
  /** Acute angle between two planar faces or two straight edges, in degrees. */
  angle?: number;
  /** Body volume, in mm³. */
  volume?: number;
  /** Centre of mass of the measured shape. */
  centerOfMass?: Vec3;
}

export type KernelRequest =
  | { type: "init" }
  | { type: "rebuild"; gen: number; features: KernelFeature[] }
  | {
      type: "faceBoundary";
      requestId: number;
      cacheKey: string;
      ref: TopoRef;
    }
  | {
      type: "export";
      requestId: number;
      format: ExportFormat;
      /** The final prefix solid of the rendered rebuild. */
      cacheKey: string;
    }
  | {
      type: "measure";
      requestId: number;
      cacheKey: string;
      /** Zero (body), one (shape), or two (distance/angle) targets. */
      targets: MeasureTarget[];
    };

export type KernelResponse =
  | { type: "ready"; kernel: string }
  | {
      type: "result";
      gen: number;
      mesh: BodyMesh;
      features: FeatureBuildStatus[];
    }
  | {
      type: "error";
      gen: number;
      message: string;
      features?: FeatureBuildStatus[];
    }
  | {
      type: "faceBoundary";
      requestId: number;
      ok: boolean;
      normal?: Vec3;
      centroid?: Vec3;
      loops?: Vec3[][];
      confidence?: "exact" | "geometric-fallback";
      message?: string;
    }
  | {
      type: "exported";
      requestId: number;
      format: ExportFormat;
      data: ArrayBuffer;
    }
  | { type: "exportError"; requestId: number; message: string }
  | {
      type: "measured";
      requestId: number;
      ok: true;
      result: MeasureResult;
    }
  | { type: "measured"; requestId: number; ok: false; message: string };
