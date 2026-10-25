import type { Vec2 } from "../types";
import { updateConstraintValue } from "./geometry";
import type { Sketch, SketchConstraint } from "./types";

/**
 * Pure sketch edits used by the drawing tools. Keeping them here (instead of
 * inside the canvas) makes them unit-testable and keeps the UI dumb.
 */

let counter = 0;
const session = Math.random().toString(36).slice(2, 7);

function nextId(prefix: string): string {
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
    const id = nextId("p");
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

    curves.push({ id: nextId("l"), type: "line", a, b });
    if (Math.abs(pb.y - pa.y) < 1e-6) {
      constraints.push({ id: nextId("c"), type: "horizontal", line: curves[curves.length - 1]!.id });
    } else if (Math.abs(pb.x - pa.x) < 1e-6) {
      constraints.push({ id: nextId("c"), type: "vertical", line: curves[curves.length - 1]!.id });
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

  const ids = Array.from({ length: 4 }, () => nextId("p"));
  const points = [
    ...sketch.points,
    { id: ids[0]!, x: x0, y: y0 },
    { id: ids[1]!, x: x1, y: y0 },
    { id: ids[2]!, x: x1, y: y1 },
    { id: ids[3]!, x: x0, y: y1 },
  ];

  const lineIds = Array.from({ length: 4 }, () => nextId("l"));
  const curves = [
    ...sketch.curves,
    { id: lineIds[0]!, type: "line" as const, a: ids[0]!, b: ids[1]! },
    { id: lineIds[1]!, type: "line" as const, a: ids[1]!, b: ids[2]! },
    { id: lineIds[2]!, type: "line" as const, a: ids[2]!, b: ids[3]! },
    { id: lineIds[3]!, type: "line" as const, a: ids[3]!, b: ids[0]! },
  ];

  const constraints: SketchConstraint[] = [
    ...sketch.constraints,
    { id: nextId("c"), type: "horizontal", line: lineIds[0]! },
    { id: nextId("c"), type: "vertical", line: lineIds[1]! },
    { id: nextId("c"), type: "horizontal", line: lineIds[2]! },
    { id: nextId("c"), type: "vertical", line: lineIds[3]! },
  ];

  return { ...sketch, points, curves, constraints };
}

export function addCircle(
  sketch: Sketch,
  center: DraftVertex,
  radius: number,
): Sketch {
  if (radius < 0.5) return sketch;

  const centerId = center.existingPointId ?? nextId("p");
  const points = center.existingPointId
    ? [...sketch.points]
    : [...sketch.points, { id: centerId, x: center.point[0], y: center.point[1] }];

  const curveId = nextId("l");
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
        id: nextId("c"),
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
      { id: nextId("c"), type: "diameter", circle: circleId, value: diameter },
    ],
  };
}
