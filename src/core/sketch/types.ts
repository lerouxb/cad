import type { Vec2 } from "../types";

/**
 * A 2D sketch. Geometry is plane-local: (x, y) in millimetres, no 3D.
 *
 * Points marked `fixed` live in solver group 0: they are not unknowns, so they
 * act as real anchors (the sketch origin, imported reference geometry, ...).
 */
export interface SketchPoint {
  id: string;
  x: number;
  y: number;
  fixed?: boolean;
}

export interface SketchLine {
  id: string;
  type: "line";
  a: string;
  b: string;
  /** Reference/dimension helper; never part of a profile. */
  construction?: boolean;
}

export interface SketchCircle {
  id: string;
  type: "circle";
  center: string;
  radius: number;
}

export type SketchCurve = SketchLine | SketchCircle;

export type SketchConstraint =
  | { id: string; type: "coincident"; a: string; b: string }
  | { id: string; type: "horizontal" | "vertical"; line: string }
  | { id: string; type: "distance"; a: string; b: string; value: number }
  | { id: string; type: "diameter"; circle: string; value: number }
  | { id: string; type: "midpoint"; point: string; line: string };

export interface Sketch {
  points: SketchPoint[];
  curves: SketchCurve[];
  constraints: SketchConstraint[];
}

export interface SketchRef {
  points: Record<string, Vec2>;
  radii: Record<string, number>;
}

export function pointMap(sketch: Sketch): Map<string, SketchPoint> {
  return new Map(sketch.points.map((p) => [p.id, p]));
}
