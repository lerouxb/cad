import { newId } from "./create";
import { distance, updateConstraintValue } from "./geometry";
import type { Vec2 } from "../types";
import {
  allCurves,
  allPoints,
  findSketchCurve,
  findSketchPoint,
  type Sketch,
  type SketchArc,
  type SketchCircle,
  type SketchConstraint,
  type SketchLine,
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

/**
 * Infer the dimension a selection asks for. Dimension creation is contextual:
 * select the entities, then choose dimension/radius in the selection popover.
 */
export function dimensionTargetForSelection(
  sketch: Sketch,
  ids: readonly string[],
  radius = false,
): DimensionTarget | null {
  const wanted = new Set(ids);
  const curves = allCurves(sketch).filter((curve) => wanted.has(curve.id));
  const points = allPoints(sketch).filter((point) => wanted.has(point.id));
  if (curves.length === 0 && points.length === 2) {
    return { kind: "distance", a: points[0]!.id, b: points[1]!.id };
  }
  if (curves.length === 1) {
    const curve = curves[0]!;
    if (curve.type === "line") {
      const point = points[0];
      if (
        points.length === 1 &&
        point &&
        point.id !== curve.a &&
        point.id !== curve.b
      ) {
        return { kind: "pointLineDistance", point: point.id, line: curve.id };
      }
      if (points.length === 0) {
        return { kind: "distance", a: curve.a, b: curve.b };
      }
    }
    if (curve.type === "circle" || curve.type === "arc") {
      if (points.length === 0) {
        return radius
          ? { kind: "radius", circle: curve.id }
          : { kind: "diameter", circle: curve.id };
      }
    }
  }
  if (
    curves.length === 2 &&
    points.length === 0 &&
    curves.every((curve) => curve.type === "line")
  ) {
    return {
      kind: "angle",
      a: curves[0]!.id,
      b: curves[1]!.id,
    };
  }
  return null;
}

export interface DimensionPlacement {
  /** Signed perpendicular offset of the dimension line, in mm. */
  offset?: number;
  /** Label position along a linear dimension, 0 = start, 1 = end. */
  along?: number;
  /** Leader angle for a diameter/radius, in degrees. */
  angle?: number;
  /** Leader length beyond the circle edge, in mm. */
  distance?: number;
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
    const a = findSketchPoint(sketch, target.a);
    const b = findSketchPoint(sketch, target.b);
    if (!a || !b) return sketch;

    return upsert(sketch, existing, {
      id: existing?.id ?? newId("dim"),
      type: "distance",
      a: target.a,
      b: target.b,
      value: distance([a.x, a.y], [b.x, b.y]),
      driving,
      offset: placement.offset ?? 12,
      ...(placement.along !== undefined ? { along: placement.along } : {}),
    });
  }

  if (target.kind === "pointLineDistance") {
    const point = findSketchPoint(sketch, target.point);
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
      ...(placement.along !== undefined ? { along: placement.along } : {}),
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
    ...(placement.distance !== undefined
      ? { distance: placement.distance }
      : {}),
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

/** Change an existing dimension between driving and reference. */
export function setDimensionDriving(
  sketch: Sketch,
  id: string,
  driving: boolean,
): Sketch {
  let changed = false;
  const constraints = sketch.constraints.map((constraint) => {
    if (constraint.id !== id) return constraint;
    // Dimensions omit `driving` when driving; only reference sets it to false.
    // Do not use `"driving" in constraint` here: that treats every ordinary
    // dimension as non-toggleable and silently drops the kind change.
    if (
      constraint.type !== "distance" &&
      constraint.type !== "pointLineDistance" &&
      constraint.type !== "diameter" &&
      constraint.type !== "angle"
    ) {
      return constraint;
    }
    const currentlyDriving = constraint.driving !== false;
    if (currentlyDriving === driving) return constraint;
    changed = true;
    return { ...constraint, driving };
  });
  return changed ? { ...sketch, constraints } : sketch;
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
        const offset =
          placement.offset !== undefined ? placement.offset : constraint.offset;
        const along =
          placement.along !== undefined ? placement.along : constraint.along;
        if (offset === constraint.offset && along === constraint.along) {
          return constraint;
        }
        return { ...constraint, offset, along };
      }
      if (constraint.type === "diameter") {
        const angle =
          placement.angle !== undefined ? placement.angle : constraint.angle;
        const distance =
          placement.distance !== undefined
            ? placement.distance
            : constraint.distance;
        if (
          angle === constraint.angle &&
          distance === constraint.distance
        ) {
          return constraint;
        }
        return { ...constraint, angle, distance };
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
  const line = findSketchCurve(sketch, id);
  return line?.type === "line" ? line : null;
}

function linePoints(
  sketch: Sketch,
  line: SketchLine,
): { a: Vec2; b: Vec2 } | null {
  const a = findSketchPoint(sketch, line.a);
  const b = findSketchPoint(sketch, line.b);
  return a && b ? { a: [a.x, a.y], b: [b.x, b.y] } : null;
}

/** Unsigned perpendicular distance from a point to an infinite line. */
export function pointLineDistance(
  sketch: Sketch,
  pointId: string,
  lineId: string,
): number | null {
  const point = findSketchPoint(sketch, pointId);
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
