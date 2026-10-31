import { newId } from "./create";
import { distance, updateConstraintValue } from "./geometry";
import type { Vec2 } from "../types";
import type {
  Sketch,
  SketchArc,
  SketchCircle,
  SketchConstraint,
  SketchLine,
} from "./types";

/**
 * Dimensions live on the sketch as constraints. A driving dimension constrains
 * the solver; a reference dimension (Fusion calls it "driven") is only an
 * annotation and is skipped by the solver and the drag projection.
 */
export type DimensionTarget =
  | { kind: "distance"; a: string; b: string }
  | { kind: "pointLineDistance"; point: string; line: string }
  | { kind: "diameter"; circle: string }
  | { kind: "radius"; circle: string }
  | { kind: "angle"; a: string; b: string };

export interface DimensionPlacement {
  /** Signed perpendicular offset of the dimension line, in mm. */
  offset?: number;
  /** Leader angle for a diameter/radius, in degrees. */
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

  if (target.kind === "pointLineDistance") {
    const point = sketch.points.find((candidate) => candidate.id === target.point);
    const line = lineById(sketch, target.line);
    if (!point || !line) return sketch;
    const value = pointLineDistance(sketch, target.point, target.line);
    if (value === null) return sketch;
    return upsert(sketch, existing, {
      id: existing?.id ?? newId("dim"),
      type: "pointLineDistance",
      point: target.point,
      line: target.line,
      value,
      driving,
      offset: placement.offset ?? 10,
    });
  }

  if (target.kind === "angle") {
    const lineA = lineById(sketch, target.a);
    const lineB = lineById(sketch, target.b);
    if (!lineA || !lineB) return sketch;
    const value = angleBetweenLines(sketch, lineA, lineB);
    if (value === null) return sketch;
    return upsert(sketch, existing, {
      id: existing?.id ?? newId("dim"),
      type: "angle",
      a: target.a,
      b: target.b,
      value,
      driving,
      offset: placement.offset ?? 30,
    });
  }

  const circle = sketch.curves.find(
    (curve): curve is SketchCircle | SketchArc =>
      curve.id === target.circle &&
      (curve.type === "circle" || curve.type === "arc"),
  );
  if (!circle) return sketch;

  const radius =
    circle.type === "circle"
      ? circle.radius
      : (() => {
          const center = sketch.points.find((point) => point.id === circle.center);
          const start = sketch.points.find((point) => point.id === circle.start);
          return center && start
            ? distance([center.x, center.y], [start.x, start.y])
            : null;
        })();
  if (radius === null) return sketch;

  return upsert(sketch, existing, {
    id: existing?.id ?? newId("dim"),
    type: "diameter",
    circle: target.circle,
    value: radius * 2,
    driving,
    angle: placement.angle ?? 45,
    ...(target.kind === "radius" ? { radius: true } : {}),
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
  // Radius dimensions store the diameter on the solver constraint.
  return updateConstraintValue(
    sketch,
    dimension.id,
    target.kind === "radius" ? value * 2 : value,
  );
}

/** Move a dimension's label without changing its measurement. */
export function setDimensionPlacement(
  sketch: Sketch,
  id: string,
  placement: DimensionPlacement,
): Sketch {
  return {
    ...sketch,
    constraints: sketch.constraints.map((constraint) => {
      if (constraint.id !== id) return constraint;
      if (constraint.type === "distance" || constraint.type === "pointLineDistance") {
        if (placement.offset === undefined) return constraint;
        return { ...constraint, offset: placement.offset };
      }
      if (constraint.type === "diameter" && placement.angle !== undefined) {
        return { ...constraint, angle: placement.angle };
      }
      if (constraint.type === "angle" && placement.offset !== undefined) {
        return { ...constraint, offset: placement.offset };
      }
      return constraint;
    }),
  };
}

/** True when a constraint is a driving dimension (not a reference measurement). */
export function isDrivingDimension(constraint: SketchConstraint | undefined): boolean {
  return Boolean(
    constraint &&
      (constraint.type === "distance" ||
        constraint.type === "pointLineDistance" ||
        constraint.type === "diameter" ||
        constraint.type === "angle") &&
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
  if (target.kind === "pointLineDistance") {
    return sketch.constraints.find(
      (constraint) =>
        constraint.type === "pointLineDistance" &&
        constraint.point === target.point &&
        constraint.line === target.line,
    );
  }
  if (target.kind === "angle") {
    return sketch.constraints.find(
      (constraint) =>
        constraint.type === "angle" &&
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

function lineById(sketch: Sketch, id: string): SketchLine | null {
  const line = sketch.curves.find((curve) => curve.id === id);
  return line?.type === "line" ? line : null;
}

function linePoints(
  sketch: Sketch,
  line: SketchLine,
): { a: Vec2; b: Vec2 } | null {
  const a = sketch.points.find((point) => point.id === line.a);
  const b = sketch.points.find((point) => point.id === line.b);
  return a && b ? { a: [a.x, a.y], b: [b.x, b.y] } : null;
}

/** Unsigned perpendicular distance from a point to an infinite line. */
export function pointLineDistance(
  sketch: Sketch,
  pointId: string,
  lineId: string,
): number | null {
  const point = sketch.points.find((candidate) => candidate.id === pointId);
  const line = lineById(sketch, lineId);
  const points = line ? linePoints(sketch, line) : null;
  if (!point || !points) return null;
  const dx = points.b[0] - points.a[0];
  const dy = points.b[1] - points.a[1];
  const length = Math.hypot(dx, dy);
  if (length < 1e-9) return null;
  return Math.abs(
    (point.x - points.a[0]) * dy - (point.y - points.a[1]) * dx,
  ) / length;
}

/** Smaller angle between two lines, in degrees. */
export function angleBetweenLines(
  sketch: Sketch,
  a: SketchLine,
  b: SketchLine,
): number | null {
  const pa = linePoints(sketch, a);
  const pb = linePoints(sketch, b);
  if (!pa || !pb) return null;
  const dax = pa.b[0] - pa.a[0];
  const day = pa.b[1] - pa.a[1];
  const dbx = pb.b[0] - pb.a[0];
  const dby = pb.b[1] - pb.a[1];
  if (Math.hypot(dax, day) < 1e-9 || Math.hypot(dbx, dby) < 1e-9) return null;
  const cross = dax * dby - day * dbx;
  const dot = dax * dbx + day * dby;
  return (Math.abs(Math.atan2(cross, dot)) * 180) / Math.PI;
}
