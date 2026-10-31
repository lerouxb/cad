import type { ProfileLoop, Vec2 } from "../types";
import type { Sketch, SketchArc, SketchConstraint, SketchCurve } from "./types";

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

export interface Bounds2 {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

export function polygonBounds(points: readonly Vec2[]): Bounds2 | null {
  if (points.length === 0) return null;
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

export function loopBounds(loop: ProfileLoop): Bounds2 {
  if (loop.kind === "circle") {
    const [x, y] = loop.center;
    const r = loop.radius;
    return { minX: x - r, minY: y - r, maxX: x + r, maxY: y + r, width: 2 * r, height: 2 * r };
  }
  return polygonBounds(loop.points) ?? { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
}

/** Circumcentre of three points, or null when they are collinear. */
export function circumcenter(a: Vec2, b: Vec2, c: Vec2): Vec2 | null {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(d) < 1e-9) return null;
  const aa = a[0] * a[0] + a[1] * a[1];
  const bb = b[0] * b[0] + b[1] * b[1];
  const cc = c[0] * c[0] + c[1] * c[1];
  return [
    (aa * (b[1] - c[1]) + bb * (c[1] - a[1]) + cc * (a[1] - b[1])) / d,
    (aa * (c[0] - b[0]) + bb * (a[0] - c[0]) + cc * (b[0] - a[0])) / d,
  ];
}

export interface ArcGeometry {
  center: Vec2;
  radius: number;
  startAngle: number;
  endAngle: number;
  /** Counter-clockwise sweep in radians, in (0, 2π]. */
  sweep: number;
}

/** Resolve an arc's centre, radius and CCW angles from the solved points. */
export function arcGeometry(
  arc: Pick<SketchArc, "center" | "start" | "end">,
  points: Record<string, Vec2>,
): ArcGeometry | null {
  const center = points[arc.center];
  const start = points[arc.start];
  const end = points[arc.end];
  if (!center || !start || !end) return null;
  const radius = distance(center, start);
  if (radius < 1e-9) return null;
  const startAngle = normalizeAngle(Math.atan2(start[1] - center[1], start[0] - center[0]));
  const endAngle = normalizeAngle(Math.atan2(end[1] - center[1], end[0] - center[0]));
  let sweep = endAngle - startAngle;
  if (sweep <= 1e-9) sweep += Math.PI * 2;
  return { center, radius, startAngle, endAngle, sweep };
}

/** A point on the arc, `t` in [0, 1] from start to end. */
export function arcPointAt(arc: ArcGeometry, t: number): Vec2 {
  const angle = arc.startAngle + arc.sweep * t;
  return [
    arc.center[0] + Math.cos(angle) * arc.radius,
    arc.center[1] + Math.sin(angle) * arc.radius,
  ];
}

/**
 * Sample an arc from `from` to `to` (both are endpoint ids). The samples include
 * `from` and include `to` only when `includeEnd` is true.
 */
export function sampleArc(
  arc: SketchArc,
  from: string,
  to: string,
  points: Record<string, Vec2>,
  includeEnd: boolean,
  maxStep = Math.PI / 36,
): Vec2[] {
  const geometry = arcGeometry(arc, points);
  if (!geometry) return [];
  const forward = from === arc.start && to === arc.end;
  const backward = from === arc.end && to === arc.start;
  if (!forward && !backward) return [];

  const steps = Math.max(1, Math.ceil(geometry.sweep / maxStep));
  const result: Vec2[] = [];
  const count = includeEnd ? steps : steps - 1;
  for (let i = 0; i <= count; i++) {
    if (i === steps && !includeEnd) break;
    const t = forward ? i / steps : 1 - i / steps;
    result.push(arcPointAt(geometry, t));
  }
  return result;
}

/** Radius of a circle or arc, from the solved geometry. */
export function curveRadius(
  curve: SketchCurve,
  points: Record<string, Vec2>,
  radii: Record<string, number> = {},
): number | null {
  if (curve.type === "circle") return radii[curve.id] ?? curve.radius;
  if (curve.type === "arc") {
    const center = points[curve.center];
    const start = points[curve.start];
    return center && start ? distance(center, start) : null;
  }
  return null;
}

/**
 * Clamp an angle to an arc's visible CCW sweep. Used so a diameter/radius
 * leader always lands on the arc, not on the empty part of its circle.
 */
export function clampAngleToArc(
  angle: number,
  startAngle: number,
  sweep: number,
): number {
  const twoPi = Math.PI * 2;
  if (sweep >= twoPi - 1e-9) return normalizeAngle(angle);
  const start = normalizeAngle(startAngle);
  const offset = normalizeAngle(angle - start);
  if (offset <= sweep + 1e-9) return normalizeAngle(angle);
  const toStart = twoPi - offset;
  const toEnd = offset - sweep;
  return normalizeAngle(toStart <= toEnd ? start : start + sweep);
}

export function normalizeAngle(angle: number): number {
  const twoPi = Math.PI * 2;
  const wrapped = angle % twoPi;
  return wrapped < 0 ? wrapped + twoPi : wrapped;
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
