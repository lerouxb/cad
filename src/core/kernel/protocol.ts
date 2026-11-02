import type { PlaneFrame, ProfileLoop, Vec3 } from "../types";

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

/** Plain-JSON geometric hint for fallback matching when a role dies. */
export interface TopoHint {
  entityType: "face";
  surfaceType?: string;
  normal?: [number, number, number];
  centroid?: [number, number, number];
  area?: number;
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
}

export interface BodyStats {
  faces: number;
  edges: number;
  triangles: number;
  volume: number;
  buildMs: number;
  /** [minX, minY, minZ, maxX, maxY, maxZ] in model millimetres. */
  bounds: [number, number, number, number, number, number];
}

/** Renderable output of one rebuild. Typed arrays are transferred, not copied. */
export interface BodyMesh {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  faceGroups: FaceGroup[];
  edgePositions: Float32Array;
  edgeGroups: EdgeGroup[];
  stats: BodyStats;
}

export type KernelOperation = "new" | "join" | "cut";

/** One resolved extrude in history order, with the main-thread cache key. */
export interface KernelFeature {
  featureId: string;
  /** hash(canonical(feature) + upstreamKey); also the worker cache key. */
  cacheKey: string;
  params: ExtrudeParams;
  operation: KernelOperation;
}

export interface FeatureBuildStatus {
  featureId: string;
  status: "ok" | "error" | "skipped";
  /** True when the worker reused a previously built prefix solid. */
  cached: boolean;
  message?: string;
}

export type KernelRequest =
  | { type: "init" }
  | { type: "rebuild"; gen: number; features: KernelFeature[] }
  | {
      type: "faceBoundary";
      requestId: number;
      cacheKey: string;
      ref: TopoRef;
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
    };
