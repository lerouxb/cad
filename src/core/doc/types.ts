import type { Sketch } from "../sketch/types";
import type { PlaneFrame, Vec2 } from "../types";
import type { EdgeRef, TopoRef } from "../kernel/protocol";

/** The document schema version. Bump this on every shape change. */
export const CURRENT_SCHEMA_VERSION = 10;

export type WorldPlane = "XY" | "XZ" | "YZ";

export type ExtrudeEnd = "blind" | "throughAll";

/**
 * Where a sketch lives. World planes are intrinsic; a face support stores the
 * JSON-safe TopoRef plus the last-known frame (M4's cached-frame fallback); a
 * datum support points at a datum-plane feature and keeps the last-known frame.
 */
export type PlaneRef =
  | { kind: "world"; plane: WorldPlane }
  | { kind: "face"; ref: TopoRef; frame: PlaneFrame }
  | {
      kind: "datum";
      featureId: string;
      label: string;
      frame: PlaneFrame;
    };

/** How a datum plane is derived from existing supports. */
export type DatumPlaneDefinition =
  | { kind: "offset"; base: PlaneRef; distance: number }
  | { kind: "midplane"; a: PlaneRef; b: PlaneRef };

export interface DatumPlaneFeature {
  id: string;
  type: "datum";
  name: string;
  definition: DatumPlaneDefinition;
  /** Last-known resolved frame, used for display/recovery before rebuild. */
  frame: PlaneFrame;
  /** Hidden in the model view only; still rebuilds and supports sketches. */
  hidden?: boolean;
  suppressed?: boolean;
}

export interface SketchFeature {
  id: string;
  type: "sketch";
  name: string;
  support: PlaneRef;
  sketch: Sketch;
  /** Derived face outlines, cached for rendering/solver recovery. */
  projections?: FaceProjection[];
  suppressed?: boolean;
}

export interface FaceProjection {
  id: string;
  kind: "faceBoundary";
  source: TopoRef;
  label: string;
  /** Projected loops in sketch-local millimetres; the last known cache. */
  loops: Vec2[][];
  /** True when the live face changed topologically and the cache was kept. */
  stale?: boolean;
}

export type ExtrudeOperation = "new" | "join" | "cut";

export interface ExtrudeFeature {
  id: string;
  type: "extrude";
  name: string;
  /** The sketch feature this extrude consumes. */
  sketchId: string;
  /** Selected region ids; empty means the current auto/largest fallback. */
  regions: string[];
  height: number;
  operation: ExtrudeOperation;
  /** Two-sided extrude (the sketch plane is the midplane). */
  symmetric: boolean;
  /** Blind uses `height`; throughAll cuts through the current body. */
  end: ExtrudeEnd;
  suppressed?: boolean;
}

/**
 * A constant-radius fillet on edges of the current body. The edges are stable
 * face-pair refs, never kernel hashes; the worker resolves them against the
 * prefix solid at rebuild time.
 */
export interface FilletFeature {
  id: string;
  type: "fillet";
  name: string;
  edges: EdgeRef[];
  radius: number;
  suppressed?: boolean;
}

/** A constant-distance chamfer on edges of the current body. */
export interface ChamferFeature {
  id: string;
  type: "chamfer";
  name: string;
  edges: EdgeRef[];
  distance: number;
  suppressed?: boolean;
}

export type Feature =
  | SketchFeature
  | ExtrudeFeature
  | DatumPlaneFeature
  | FilletFeature
  | ChamferFeature;

/**
 * The whole persisted part. Plain JSON only: no kernel handles, no solver
 * output, no class instances. It must survive JSON.stringify -> JSON.parse.
 */
export interface Doc {
  schemaVersion: number;
  id: string;
  name: string;
  features: Feature[];
}

export function isSketchFeature(feature: Feature): feature is SketchFeature {
  return feature.type === "sketch";
}

export function isExtrudeFeature(feature: Feature): feature is ExtrudeFeature {
  return feature.type === "extrude";
}

export function isDatumPlaneFeature(
  feature: Feature,
): feature is DatumPlaneFeature {
  return feature.type === "datum";
}

export function isFilletFeature(feature: Feature): feature is FilletFeature {
  return feature.type === "fillet";
}

export function isChamferFeature(feature: Feature): feature is ChamferFeature {
  return feature.type === "chamfer";
}

/** A fillet or chamfer: both consume the current body along selected edges. */
export type EdgeBlendFeature = FilletFeature | ChamferFeature;

export function isEdgeBlendFeature(
  feature: Feature,
): feature is EdgeBlendFeature {
  return feature.type === "fillet" || feature.type === "chamfer";
}
