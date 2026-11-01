import type { Sketch } from "../sketch/types";

/** The document schema version. Bump this on every shape change. */
export const CURRENT_SCHEMA_VERSION = 4;

export type WorldPlane = "XY" | "XZ" | "YZ";

export type ExtrudeEnd = "blind" | "throughAll";

/**
 * Where a sketch lives. M3 only resolves world planes; M4 adds datum planes and
 * planar faces. Keeping the ref in the document (instead of hard-coding XY) is
 * the prerequisite for sketch-on-face.
 */
export type PlaneRef = { kind: "world"; plane: WorldPlane };

export interface SketchFeature {
  id: string;
  type: "sketch";
  name: string;
  support: PlaneRef;
  sketch: Sketch;
  suppressed?: boolean;
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
