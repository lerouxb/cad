import type { Vec2 } from "../types";
import { arcGeometry, arcPointAt } from "./geometry";
import {
  allCurves,
  type Sketch,
  type SketchConstraint,
  type SketchCurve,
} from "./types";

export type SketchMarquee =
  | { kind: "box"; minX: number; minY: number; maxX: number; maxY: number }
  | { kind: "lasso"; points: readonly Vec2[] };

export type SketchSelectFilter = "all" | "points" | "curves" | "dimensions";

function inBox(point: Vec2, box: Extract<SketchMarquee, { kind: "box" }>): boolean {
  return (
    point[0] >= box.minX &&
    point[0] <= box.maxX &&
    point[1] >= box.minY &&
    point[1] <= box.maxY
  );
}

function inPolygon(point: Vec2, polygon: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    const intersects =
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] <
        ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1] || 1e-12) + a[0];
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointHits(point: Vec2, marquee: SketchMarquee): boolean {
  return marquee.kind === "box"
    ? inBox(point, marquee)
    : inPolygon(point, marquee.points);
}

function segmentsCross(
  a: Vec2,
  b: Vec2,
  c: Vec2,
  d: Vec2,
): boolean {
  const cross = (p: Vec2, q: Vec2, r: Vec2): number =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return d1 * d2 <= 0 && d3 * d4 <= 0;
}

function polygonEdges(polygon: readonly Vec2[]): Array<[Vec2, Vec2]> {
  const edges: Array<[Vec2, Vec2]> = [];
  for (let i = 0; i < polygon.length; i++) {
    edges.push([polygon[i]!, polygon[(i + 1) % polygon.length]!]);
  }
  return edges;
}

function segmentHits(
  a: Vec2,
  b: Vec2,
  marquee: SketchMarquee,
): boolean {
  if (marquee.kind === "box") {
    return pointHits(a, marquee) && pointHits(b, marquee);
  }
  if (pointHits(a, marquee) || pointHits(b, marquee)) return true;
  return segmentCrossesPolygon(a, b, marquee.points);
}

function segmentCrossesPolygon(
  a: Vec2,
  b: Vec2,
  polygon: readonly Vec2[],
): boolean {
  return polygonEdges(polygon).some(([c, d]) => segmentsCross(a, b, c, d));
}

function sampledCurve(curve: SketchCurve, points: Record<string, Vec2>, radii: Record<string, number>): Vec2[] {
  if (curve.type === "circle") {
    const center = points[curve.center];
    const radius = radii[curve.id] ?? curve.radius;
    if (!center) return [];
    return Array.from({ length: 16 }, (_, index) => {
      const angle = (index / 16) * Math.PI * 2;
      return [
        center[0] + Math.cos(angle) * radius,
        center[1] + Math.sin(angle) * radius,
      ] as Vec2;
    });
  }
  if (curve.type === "arc") {
    const geometry = arcGeometry(curve, points);
    if (!geometry) return [];
    return Array.from({ length: 16 }, (_, index) =>
      arcPointAt(geometry, index / 16),
    );
  }
  return [];
}

function curveSelected(
  curve: SketchCurve,
  points: Record<string, Vec2>,
  radii: Record<string, number>,
  marquee: SketchMarquee,
): boolean {
  if (curve.type === "line") {
    const a = points[curve.a];
    const b = points[curve.b];
    return Boolean(a && b && segmentHits(a, b, marquee));
  }
  const samples = sampledCurve(curve, points, radii);
  if (samples.length === 0) return false;
  if (marquee.kind === "box") {
    return samples.every((point) => pointHits(point, marquee));
  }
  return samples.some((point, index) => {
    const next = samples[(index + 1) % samples.length]!;
    return (
      pointHits(point, marquee) ||
      segmentCrossesPolygon(point, next, marquee.points)
    );
  });
}

function dimensionParticipants(constraint: SketchConstraint): string[] {
  switch (constraint.type) {
    case "distance":
    case "angle":
      return [constraint.a, constraint.b];
    case "pointLineDistance":
      return [constraint.point, constraint.line];
    case "diameter":
      return [constraint.circle];
    default:
      return [];
  }
}

/**
 * Box/lasso selection in normal sketch select. Profile mode uses the region
 * marquee instead (SELECTION.md §3).
 */
export function marqueeSketchSelection(
  sketch: Sketch,
  points: Record<string, Vec2>,
  radii: Record<string, number>,
  marquee: SketchMarquee,
  filter: SketchSelectFilter,
): string[] {
  if (marquee.kind === "lasso" && marquee.points.length < 3) return [];
  const selectedPoints = new Set<string>();
  const selectedCurves = new Set<string>();

  if (filter === "all" || filter === "points") {
    const projectedPoints =
      sketch.references?.points.filter(
        (point) => point.projectionId !== undefined,
      ) ?? [];
    for (const point of [...sketch.points, ...projectedPoints]) {
      // Projected references are fixed but selectable; the fixed axes/origin
      // are not.
      if (point.projectionId === undefined && (point.fixed || point.construction)) {
        continue;
      }
      const position = points[point.id] ?? [point.x, point.y];
      if (pointHits(position, marquee)) selectedPoints.add(point.id);
    }
  }
  if (filter === "all" || filter === "curves") {
    const projectedCurves = [
      ...(sketch.references?.lines.filter(
        (line) => line.projectionId !== undefined,
      ) ?? []),
      ...(sketch.references?.circles?.filter(
        (circle) => circle.projectionId !== undefined,
      ) ?? []),
    ];
    for (const curve of [...sketch.curves, ...projectedCurves]) {
      if (curveSelected(curve, points, radii, marquee)) {
        selectedCurves.add(curve.id);
      }
    }
  }

  const ids = new Set<string>();
  if (filter === "all" || filter === "points") {
    for (const id of selectedPoints) ids.add(id);
  }
  if (filter === "all" || filter === "curves") {
    for (const id of selectedCurves) ids.add(id);
  }
  if (filter === "all" || filter === "dimensions") {
    for (const constraint of sketch.constraints) {
      if (
        constraint.type !== "distance" &&
        constraint.type !== "pointLineDistance" &&
        constraint.type !== "diameter" &&
        constraint.type !== "angle"
      ) {
        continue;
      }
      const participants = dimensionParticipants(constraint);
      const hits = participants.filter((id) => {
        if (selectedPoints.has(id) || selectedCurves.has(id)) return true;
        // A dimension can reference a complete line/circle without that
        // entity's endpoints being inside; test the entity itself.
        const curve = allCurves(sketch).find((candidate) => candidate.id === id);
        if (curve) {
          return curveSelected(curve, points, radii, marquee);
        }
        const point = points[id];
        return Boolean(point && pointHits(point, marquee));
      });
      if (
        participants.length > 0 &&
        (marquee.kind === "box"
          ? hits.length === participants.length
          : hits.length > 0)
      ) {
        ids.add(constraint.id);
      }
    }
  }
  return [...ids];
}
