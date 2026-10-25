import type { Vec2 } from "../types";
import type { Sketch, SketchConstraint } from "./types";

/** A solved sketch, in the form the UI and the kernel care about. */
export interface SolvedGeometry {
  points: Record<string, Vec2>;
  radii: Record<string, number>;
}

/** Read geometry straight out of the document (the last applied solution). */
export function sketchGeometry(sketch: Sketch): SolvedGeometry {
  return {
    points: Object.fromEntries(
      sketch.points.map((point) => [point.id, [point.x, point.y] as Vec2]),
    ),
    radii: Object.fromEntries(
      sketch.curves.flatMap((curve) =>
        curve.type === "circle" ? [[curve.id, curve.radius] as const] : [],
      ),
    ),
  };
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/** Positive for counter-clockwise loops. */
export function signedArea(points: readonly Vec2[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    if (!current || !next) continue;
    area += current[0] * next[1] - next[0] * current[1];
  }
  return area / 2;
}

/**
 * OCCT accepts either winding for a face, but holes and extrude direction are
 * easier to reason about when every outer loop is CCW.
 */
export function ensureCounterClockwise(points: Vec2[]): Vec2[] {
  return signedArea(points) < 0 ? [...points].reverse() : points;
}

/** Write solver output back into the document (new object; input is untouched). */
export function applySolution(sketch: Sketch, solved: SolvedGeometry): Sketch {
  return {
    ...sketch,
    points: sketch.points.map((point) => {
      const position = solved.points[point.id];
      return position ? { ...point, x: position[0], y: position[1] } : point;
    }),
    curves: sketch.curves.map((curve) => {
      if (curve.type !== "circle") return curve;
      const radius = solved.radii[curve.id];
      return radius === undefined ? curve : { ...curve, radius };
    }),
  };
}

export function updateConstraintValue(
  sketch: Sketch,
  constraintId: string,
  value: number,
): Sketch {
  return {
    ...sketch,
    constraints: sketch.constraints.map((constraint) =>
      constraint.id === constraintId && "value" in constraint
        ? { ...constraint, value }
        : constraint,
    ),
  };
}

export function constraintById(
  sketch: Sketch,
  constraintId: string,
): SketchConstraint | undefined {
  return sketch.constraints.find((constraint) => constraint.id === constraintId);
}
