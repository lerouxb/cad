import { newId } from "./create";
import { distance, updateConstraintValue } from "./geometry";
import type { Sketch, SketchConstraint } from "./types";

/**
 * Dimensions live on the sketch as constraints. A driving dimension constrains
 * the solver; a reference dimension (Fusion calls it "driven") is only an
 * annotation and is skipped by the solver and the drag projection.
 */
export type DimensionTarget =
  | { kind: "distance"; a: string; b: string }
  | { kind: "diameter"; circle: string };

export interface DimensionPlacement {
  /** Signed perpendicular offset of the dimension line, in mm. */
  offset?: number;
  /** Leader angle for a diameter, in degrees. */
  angle?: number;
}

/**
 * Create a dimension, or update the one already measuring the same entities.
 * The value captured is the current measurement, which is what a sketcher does
 * when you dimension existing geometry.
 */
export function addDimension(
  sketch: Sketch,
  target: DimensionTarget,
  driving: boolean,
  placement: DimensionPlacement,
): Sketch {
  const existing = findDimension(sketch, target);

  if (target.kind === "distance") {
    const a = sketch.points.find((point) => point.id === target.a);
    const b = sketch.points.find((point) => point.id === target.b);
    if (!a || !b) return sketch;

    return upsert(sketch, existing, {
      id: existing?.id ?? newId("dim"),
      type: "distance",
      a: target.a,
      b: target.b,
      value: distance([a.x, a.y], [b.x, b.y]),
      driving,
      offset: placement.offset ?? 12,
    });
  }

  const circle = sketch.curves.find(
    (curve) => curve.id === target.circle && curve.type === "circle",
  );
  if (!circle || circle.type !== "circle") return sketch;

  return upsert(sketch, existing, {
    id: existing?.id ?? newId("dim"),
    type: "diameter",
    circle: target.circle,
    value: circle.radius * 2,
    driving,
    angle: placement.angle ?? 45,
  });
}

/** Change an existing dimension's target value. */
export function setDimensionValue(
  sketch: Sketch,
  target: DimensionTarget,
  value: number,
): Sketch {
  const dimension = findDimension(sketch, target);
  if (!dimension) return sketch;
  return updateConstraintValue(sketch, dimension.id, value);
}

/** True when a constraint is a driving dimension (not a reference measurement). */
export function isDrivingDimension(constraint: SketchConstraint | undefined): boolean {
  return Boolean(
    constraint &&
      (constraint.type === "distance" || constraint.type === "diameter") &&
      constraint.driving !== false,
  );
}

export function removeConstraint(sketch: Sketch, id: string): Sketch {
  return {
    ...sketch,
    constraints: sketch.constraints.filter((constraint) => constraint.id !== id),
  };
}

export function findDimension(
  sketch: Sketch,
  target: DimensionTarget,
): SketchConstraint | undefined {
  if (target.kind === "distance") {
    return sketch.constraints.find(
      (constraint) =>
        constraint.type === "distance" &&
        ((constraint.a === target.a && constraint.b === target.b) ||
          (constraint.a === target.b && constraint.b === target.a)),
    );
  }
  return sketch.constraints.find(
    (constraint) => constraint.type === "diameter" && constraint.circle === target.circle,
  );
}

function upsert(
  sketch: Sketch,
  existing: SketchConstraint | undefined,
  next: SketchConstraint,
): Sketch {
  if (!existing) {
    return { ...sketch, constraints: [...sketch.constraints, next] };
  }
  return {
    ...sketch,
    constraints: sketch.constraints.map((constraint) =>
      constraint.id === existing.id ? next : constraint,
    ),
  };
}
