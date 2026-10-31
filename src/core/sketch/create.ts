import type { Vec2 } from "../types";
import { circumcenter, normalizeAngle, updateConstraintValue } from "./geometry";
import type { Sketch, SketchConstraint, SketchPoint } from "./types";

/**
 * Pure sketch edits used by the drawing tools. Keeping them here (instead of
 * inside the canvas) makes them unit-testable and keeps the UI dumb.
 */

let counter = 0;
const session = Math.random().toString(36).slice(2, 7);

export function newId(prefix: string): string {
  counter += 1;
  return `${prefix}-${session}${counter.toString(36)}`;
}

export interface DraftVertex {
  point: Vec2;
  /** Reuse this document point (snapped to existing geometry). */
  existingPointId?: string;
}

/** Add a polyline, optionally closing it back to the first vertex. */
export function addPolyline(
  sketch: Sketch,
  vertices: DraftVertex[],
  closed: boolean,
): Sketch {
  if (vertices.length < 2) return sketch;

  const points = [...sketch.points];
  const curves = [...sketch.curves];
  const constraints = [...sketch.constraints];
  const ids: string[] = [];

  for (const vertex of vertices) {
    if (vertex.existingPointId) {
      ids.push(vertex.existingPointId);
      continue;
    }
    // Reuse a point at the same position (e.g. the user clicked the start
    // point again to close a chain). Topology, not just coordinates, matters
    // for loop detection.
    const existing = points.find(
      (point) =>
        Math.hypot(point.x - vertex.point[0], point.y - vertex.point[1]) < 1e-6,
    );
    if (existing) {
      ids.push(existing.id);
      continue;
    }
    const id = newId("p");
    ids.push(id);
    points.push({ id, x: vertex.point[0], y: vertex.point[1] });
  }

  const segments: [string, string][] = [];
  for (let i = 0; i < ids.length - 1; i++) segments.push([ids[i]!, ids[i + 1]!]);
  if (closed && ids.length >= 3) {
    segments.push([ids[ids.length - 1]!, ids[0]!]);
  }

  const byId = new Map(points.map((point) => [point.id, point]));
  for (const [a, b] of segments) {
    if (a === b) continue;
    const pa = byId.get(a)!;
    const pb = byId.get(b)!;
    if (Math.hypot(pb.x - pa.x, pb.y - pa.y) < 1e-6) continue;

    curves.push({ id: newId("l"), type: "line", a, b });
    if (Math.abs(pb.y - pa.y) < 1e-6) {
      constraints.push({ id: newId("c"), type: "horizontal", line: curves[curves.length - 1]!.id });
    } else if (Math.abs(pb.x - pa.x) < 1e-6) {
      constraints.push({ id: newId("c"), type: "vertical", line: curves[curves.length - 1]!.id });
    }
  }

  return { ...sketch, points, curves, constraints };
}

export function addRectangle(sketch: Sketch, a: Vec2, b: Vec2): Sketch {
  const x0 = Math.min(a[0], b[0]);
  const x1 = Math.max(a[0], b[0]);
  const y0 = Math.min(a[1], b[1]);
  const y1 = Math.max(a[1], b[1]);
  if (x1 - x0 < 1 || y1 - y0 < 1) return sketch;

  const ids = Array.from({ length: 4 }, () => newId("p"));
  const points = [
    ...sketch.points,
    { id: ids[0]!, x: x0, y: y0 },
    { id: ids[1]!, x: x1, y: y0 },
    { id: ids[2]!, x: x1, y: y1 },
    { id: ids[3]!, x: x0, y: y1 },
  ];

  const lineIds = Array.from({ length: 4 }, () => newId("l"));
  const curves = [
    ...sketch.curves,
    { id: lineIds[0]!, type: "line" as const, a: ids[0]!, b: ids[1]! },
    { id: lineIds[1]!, type: "line" as const, a: ids[1]!, b: ids[2]! },
    { id: lineIds[2]!, type: "line" as const, a: ids[2]!, b: ids[3]! },
    { id: lineIds[3]!, type: "line" as const, a: ids[3]!, b: ids[0]! },
  ];

  const constraints: SketchConstraint[] = [
    ...sketch.constraints,
    { id: newId("c"), type: "horizontal", line: lineIds[0]! },
    { id: newId("c"), type: "vertical", line: lineIds[1]! },
    { id: newId("c"), type: "horizontal", line: lineIds[2]! },
    { id: newId("c"), type: "vertical", line: lineIds[3]! },
  ];

  return { ...sketch, points, curves, constraints };
}

/**
 * Create a circular arc through `start`, `through` and `end`. The stored
 * direction is always counter-clockwise from start to end; the endpoints are
 * swapped when needed so the arc actually passes through `through`.
 */
export function addArc(
  sketch: Sketch,
  startVertex: DraftVertex,
  endVertex: DraftVertex,
  through: Vec2,
): Sketch {
  const points = [...sketch.points];
  const startId = resolveDraftPoint(points, startVertex);
  const endId = resolveDraftPoint(points, endVertex);
  if (startId === endId) return sketch;

  const start = points.find((point) => point.id === startId)!;
  const end = points.find((point) => point.id === endId)!;
  const center = circumcenter([start.x, start.y], [end.x, end.y], through);
  if (!center) return sketch;

  const radius = Math.hypot(start.x - center[0], start.y - center[1]);
  if (radius < 0.5) return sketch;

  let from = startId;
  let to = endId;
  const startAngle = normalizeAngle(Math.atan2(start.y - center[1], start.x - center[0]));
  const endAngle = normalizeAngle(Math.atan2(end.y - center[1], end.x - center[0]));
  const throughAngle = normalizeAngle(
    Math.atan2(through[1] - center[1], through[0] - center[0]),
  );
  let sweep = endAngle - startAngle;
  if (sweep <= 1e-9) sweep += Math.PI * 2;
  const throughOffset = normalizeAngle(throughAngle - startAngle);
  // `through` must lie on the CCW start -> end sweep; otherwise the arc we want
  // is the complement, which is the same two endpoints in the other order.
  if (throughOffset > sweep + 1e-9) {
    [from, to] = [to, from];
  }

  const centerId = newId("p");
  points.push({ id: centerId, x: center[0], y: center[1] });
  return {
    ...sketch,
    points,
    curves: [
      ...sketch.curves,
      { id: newId("a"), type: "arc", center: centerId, start: from, end: to },
    ],
  };
}

/**
 * Round the corner shared by two lines with a tangent arc. The lines are
 * shortened to the tangent points and an arc joins them; tangent constraints
 * and a driving diameter keep the fillet parametric.
 */
export function addFillet(
  sketch: Sketch,
  lineIdA: string,
  lineIdB: string,
  radius = 5,
): Sketch {
  const lineA = sketch.curves.find(
    (curve): curve is Extract<typeof curve, { type: "line" }> =>
      curve.id === lineIdA && curve.type === "line",
  );
  const lineB = sketch.curves.find(
    (curve): curve is Extract<typeof curve, { type: "line" }> =>
      curve.id === lineIdB && curve.type === "line",
  );
  if (!lineA || !lineB || lineA.id === lineB.id) return sketch;

  const shared = [lineA.a, lineA.b].find((id) => id === lineB.a || id === lineB.b);
  if (!shared) return sketch;

  const byId = new Map(sketch.points.map((point) => [point.id, point]));
  const corner = byId.get(shared);
  const farA = byId.get(lineA.a === shared ? lineA.b : lineA.a);
  const farB = byId.get(lineB.a === shared ? lineB.b : lineB.a);
  if (!corner || !farA || !farB) return sketch;

  const ax = farA.x - corner.x;
  const ay = farA.y - corner.y;
  const bx = farB.x - corner.x;
  const by = farB.y - corner.y;
  const lenA = Math.hypot(ax, ay);
  const lenB = Math.hypot(bx, by);
  if (lenA < 1e-6 || lenB < 1e-6) return sketch;

  const ux = ax / lenA;
  const uy = ay / lenA;
  const vx = bx / lenB;
  const vy = by / lenB;
  const cos = Math.max(-1, Math.min(1, ux * vx + uy * vy));
  const angle = Math.acos(cos);
  if (angle < 1e-3 || Math.PI - angle < 1e-3) return sketch;

  const maxDistance = Math.min(lenA, lenB) * 0.95;
  let filletRadius = radius;
  let tangentDistance = filletRadius / Math.tan(angle / 2);
  if (tangentDistance > maxDistance) {
    tangentDistance = maxDistance;
    filletRadius = tangentDistance * Math.tan(angle / 2);
  }
  if (filletRadius < 0.1) return sketch;

  const t1: Vec2 = [corner.x + ux * tangentDistance, corner.y + uy * tangentDistance];
  const t2: Vec2 = [corner.x + vx * tangentDistance, corner.y + vy * tangentDistance];

  // The centre lies on the interior angle bisector.
  const bisectorX = ux + vx;
  const bisectorY = uy + vy;
  const bisectorLength = Math.hypot(bisectorX, bisectorY);
  if (bisectorLength < 1e-9) return sketch;
  const centerDistance = filletRadius / Math.sin(angle / 2);
  const center: Vec2 = [
    corner.x + (bisectorX / bisectorLength) * centerDistance,
    corner.y + (bisectorY / bisectorLength) * centerDistance,
  ];

  const points = [...sketch.points];
  const t1Id = newId("p");
  const t2Id = newId("p");
  const centerId = newId("p");
  points.push(
    { id: t1Id, x: t1[0], y: t1[1] },
    { id: t2Id, x: t2[0], y: t2[1] },
    { id: centerId, x: center[0], y: center[1] },
  );

  const replaceCorner = (
    line: typeof lineA,
    endpoint: string,
  ): typeof lineA => ({
    ...line,
    a: line.a === shared ? endpoint : line.a,
    b: line.b === shared ? endpoint : line.b,
  });
  const curves = sketch.curves.map((curve) => {
    if (curve.id === lineA.id) return replaceCorner(lineA, t1Id);
    if (curve.id === lineB.id) return replaceCorner(lineB, t2Id);
    return curve;
  });

  // Choose the CCW order whose midpoint is closer to the old corner: that is
  // the arc inside the corner, not the one wrapping around the outside.
  const startAngle = Math.atan2(t1[1] - center[1], t1[0] - center[0]);
  const endAngle = Math.atan2(t2[1] - center[1], t2[0] - center[0]);
  const sweep = normalizeAngle(endAngle - startAngle);
  const midAngle = startAngle + sweep / 2;
  const near: Vec2 = [
    center[0] + Math.cos(midAngle) * filletRadius,
    center[1] + Math.sin(midAngle) * filletRadius,
  ];
  const far: Vec2 = [
    center[0] - Math.cos(midAngle) * filletRadius,
    center[1] - Math.sin(midAngle) * filletRadius,
  ];
  const swap =
    Math.hypot(near[0] - corner.x, near[1] - corner.y) >
    Math.hypot(far[0] - corner.x, far[1] - corner.y);
  const arcId = newId("a");
  curves.push({
    id: arcId,
    type: "arc",
    center: centerId,
    start: swap ? t2Id : t1Id,
    end: swap ? t1Id : t2Id,
  });

  // Put the dimension leader on the visible arc: the midpoint of the stored
  // (near) arc, not the default 45° point on the full circle.
  const arcMidAngle = normalizeAngle(swap ? midAngle + Math.PI : midAngle);
  const used = new Set<string>();
  for (const curve of curves) {
    if (curve.type === "line") {
      used.add(curve.a);
      used.add(curve.b);
    } else if (curve.type === "circle") {
      used.add(curve.center);
    } else {
      used.add(curve.center);
      used.add(curve.start);
      used.add(curve.end);
    }
  }
  const cornerUsed = used.has(shared);

  // If another curve (e.g. the demo's construction diagonal) still uses the
  // old corner, do not leave it stranded at the sharp corner. Keep the point
  // and put it on the new arc, so attached geometry follows the rounded
  // boundary. Constraints that would contradict that move (a fix, or
  // point-on-line against either trimmed line) are dropped.
  const constraints: SketchConstraint[] = sketch.constraints.filter((constraint) => {
    if (!referencesPoint(constraint, shared)) return true;
    if (!cornerUsed) return false;
    if (constraint.type === "fix") return false;
    if (constraint.type === "pointOnLine") {
      return constraint.line !== lineA.id && constraint.line !== lineB.id;
    }
    if (constraint.type === "coincident") {
      const other = constraint.a === shared ? constraint.b : constraint.a;
      return !byId.get(other)?.fixed;
    }
    return true;
  });
  if (cornerUsed) {
    constraints.push({
      id: newId("c"),
      type: "pointOnCircle",
      point: shared,
      circle: arcId,
    });
  }
  constraints.push(
    { id: newId("c"), type: "tangent", a: arcId, b: lineA.id },
    { id: newId("c"), type: "tangent", a: arcId, b: lineB.id },
    {
      id: newId("c"),
      type: "diameter",
      circle: arcId,
      value: filletRadius * 2,
      angle: (arcMidAngle * 180) / Math.PI,
    },
  );

  const keptPoints = points.filter((point) => point.id !== shared || cornerUsed);

  return { points: keptPoints, curves, constraints };
}

export function addCircle(
  sketch: Sketch,
  center: DraftVertex,
  radius: number,
): Sketch {
  if (radius < 0.5) return sketch;

  const centerId = center.existingPointId ?? newId("p");
  const points = center.existingPointId
    ? [...sketch.points]
    : [...sketch.points, { id: centerId, x: center.point[0], y: center.point[1] }];

  const curveId = newId("l");
  return {
    ...sketch,
    points,
    curves: [
      ...sketch.curves,
      { id: curveId, type: "circle", center: centerId, radius },
    ],
    constraints: [
      ...sketch.constraints,
      {
        id: newId("c"),
        type: "diameter",
        circle: curveId,
        value: radius * 2,
      },
    ],
  };
}

export function emptySketch(): Sketch {
  return { points: [], curves: [], constraints: [] };
}

export function isSketchEmpty(sketch: Sketch): boolean {
  return sketch.points.length === 0 && sketch.curves.length === 0;
}

/** Set the diameter of a circle, creating the driving constraint if needed. */
export function setCircleDiameter(
  sketch: Sketch,
  circleId: string,
  diameter: number,
): Sketch {
  const constraint = sketch.constraints.find(
    (candidate) => candidate.type === "diameter" && candidate.circle === circleId,
  );
  if (constraint) return updateConstraintValue(sketch, constraint.id, diameter);

  return {
    ...sketch,
    constraints: [
      ...sketch.constraints,
      { id: newId("c"), type: "diameter", circle: circleId, value: diameter },
    ],
  };
}

/** Reuse a snapped point, an existing point at the same place, or make one. */
function resolveDraftPoint(points: SketchPoint[], vertex: DraftVertex): string {
  if (vertex.existingPointId && points.some((point) => point.id === vertex.existingPointId)) {
    return vertex.existingPointId;
  }
  const existing = points.find(
    (point) =>
      Math.hypot(point.x - vertex.point[0], point.y - vertex.point[1]) < 1e-6,
  );
  if (existing) return existing.id;
  const id = newId("p");
  points.push({ id, x: vertex.point[0], y: vertex.point[1] });
  return id;
}

function referencesPoint(constraint: SketchConstraint, point: string): boolean {
  switch (constraint.type) {
    case "coincident":
    case "distance":
    case "symmetric":
      return constraint.a === point || constraint.b === point;
    case "pointOnLine":
    case "pointOnCircle":
    case "pointLineDistance":
    case "midpoint":
    case "fix":
      return constraint.point === point;
    default:
      return false;
  }
}
