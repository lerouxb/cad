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
  /** Reference geometry: not a handle the user can drag. */
  construction?: boolean;
  /** Lives in solver group 0: an immutable anchor (origin, projected edges). */
  fixed?: boolean;
  /** Part of the sketch coordinate frame (origin/axis endpoints). */
  reference?: boolean;
  /** Projected face/edge reference this point belongs to. */
  projectionId?: string;
  /** Human label for a projected reference. */
  referenceLabel?: string;
  /**
   * A user-placed point that is not a curve endpoint or centre. It is a normal
   * solver point (draggable/constrainable/dimensionable) but survives pruning;
   * points alone never form a profile.
   */
  standalone?: boolean;
}

export interface SketchLine {
  id: string;
  type: "line";
  a: string;
  b: string;
  /** Reference/dimension helper; never part of a profile. */
  construction?: boolean;
  /** X/Y sketch axis (fixed reference line). */
  reference?: boolean;
  /** Projected face/edge reference this line belongs to. */
  projectionId?: string;
  /** Human label for a projected reference. */
  referenceLabel?: string;
}

export interface SketchCircle {
  id: string;
  type: "circle";
  center: string;
  radius: number;
  /** Reference/dimension helper; never part of a profile. */
  construction?: boolean;
}

/**
 * A circular arc. The arc is the counter-clockwise sweep from `start` to `end`
 * around `center` (the sketch plane's +Z normal). `start` and `end` are shared
 * with adjacent line segments.
 */
export interface SketchArc {
  id: string;
  type: "arc";
  center: string;
  start: string;
  end: string;
  /** Reference/dimension helper; never part of a profile. */
  construction?: boolean;
}

export type SketchCurve = SketchLine | SketchCircle | SketchArc;

export type SketchConstraint =
  | { id: string; type: "coincident"; a: string; b: string }
  | { id: string; type: "horizontal" | "vertical"; line: string }
  | { id: string; type: "parallel" | "perpendicular" | "equal"; a: string; b: string }
  /** Two lines on the same infinite line: parallel plus a shared point/endpoint. */
  | { id: string; type: "collinear"; a: string; b: string }
  | { id: string; type: "pointOnLine"; point: string; line: string }
  | { id: string; type: "pointOnCircle"; point: string; circle: string }
  | { id: string; type: "tangent"; a: string; b: string }
  | { id: string; type: "symmetric"; a: string; b: string; about: string }
  | { id: string; type: "fix"; point: string }
  | {
      id: string;
      type: "distance";
      a: string;
      b: string;
      value: number;
      /** Driving dimensions constrain; reference dimensions only measure. */
      driving?: boolean;
      /** Signed perpendicular offset of the dimension line, mm. */
      offset?: number;
      /** Label position along the dimension line, 0 = a, 1 = b. Default 0.5. */
      along?: number;
    }
  | {
      id: string;
      type: "pointLineDistance";
      point: string;
      line: string;
      value: number;
      driving?: boolean;
      /** Signed perpendicular offset of the dimension line, mm. */
      offset?: number;
      /** Label position along the dimension line, 0 = point, 1 = projection. */
      along?: number;
    }
  | {
      id: string;
      type: "diameter";
      circle: string;
      value: number;
      driving?: boolean;
      /** Leader angle in degrees. */
      angle?: number;
      /** Leader length beyond the circle edge, mm. Default 12. */
      distance?: number;
      /** Display as a radius (the solver still constrains the diameter). */
      radius?: boolean;
    }
  | {
      id: string;
      type: "angle";
      /** Two lines. */
      a: string;
      b: string;
      /** Degrees. */
      value: number;
      driving?: boolean;
      /** Radius of the dimension arc, in millimetres. */
      offset?: number;
    }
  | { id: string; type: "midpoint"; point: string; line: string };

/** The fixed coordinate frame drawn behind the sketch. */
export interface SketchReferences {
  /** Convenience alias for the origin point; also present in `points`. */
  origin: SketchPoint;
  points: SketchPoint[];
  lines: SketchLine[];
}

export interface Sketch {
  points: SketchPoint[];
  curves: SketchCurve[];
  constraints: SketchConstraint[];
  references?: SketchReferences;
}

/** User geometry plus the fixed origin/axis references. */
export function allPoints(sketch: Sketch): SketchPoint[] {
  return sketch.references
    ? [...sketch.points, ...sketch.references.points]
    : sketch.points;
}

export function allCurves(sketch: Sketch): SketchCurve[] {
  return sketch.references
    ? [...sketch.curves, ...sketch.references.lines]
    : sketch.curves;
}

export function findSketchPoint(
  sketch: Sketch,
  id: string,
): SketchPoint | undefined {
  return allPoints(sketch).find((point) => point.id === id);
}

export function findSketchCurve(
  sketch: Sketch,
  id: string,
): SketchCurve | undefined {
  return allCurves(sketch).find((curve) => curve.id === id);
}

export interface SketchRef {
  points: Record<string, Vec2>;
  radii: Record<string, number>;
}

export function pointMap(sketch: Sketch): Map<string, SketchPoint> {
  return new Map(sketch.points.map((p) => [p.id, p]));
}
