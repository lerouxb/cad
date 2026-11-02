import type { Sketch } from "../sketch/types";
import type { PlaneFrame, Vec2 } from "../types";
import type { TopoRef } from "../kernel/protocol";

/** The document schema version. Bump this on every shape change. */
export const CURRENT_SCHEMA_VERSION = 6;

export type WorldPlane = "XY" | "XZ" | "YZ";

export type ExtrudeEnd = "blind" | "throughAll";

/**
 * Where a sketch lives. World planes are intrinsic; a face support stores the
 * JSON-safe TopoRef plus the last-known frame (M4's cached-frame fallback).
 */
export type PlaneRef =
  | { kind: "world"; plane: WorldPlane }
  | { kind: "face"; ref: TopoRef; frame: PlaneFrame };

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

export type Feature = SketchFeature | ExtrudeFeature;

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
