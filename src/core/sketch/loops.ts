import type { Vec2 } from "../types";
import type { Sketch } from "./types";

/**
 * Extract closed loops from a sketch's line segments.
 *
 * This is deliberately a simple cycle enumeration, not a full planar
 * arrangement: it is exact for the shapes the sketcher can currently draw
 * (rectangles, polylines, holes made of circles) and it is easy to test. M2
 * replaces it with face extraction when arcs and intersecting segments land.
 */

export interface SketchProfile {
  outer: { kind: "polygon"; points: Vec2[] };
  holes: { kind: "circle"; center: Vec2; radius: number }[];
  loop: SketchLoop;
}

export interface SketchLoop {
  /** Curve ids in traversal order. */
  curves: string[];
  /** Point ids in traversal order. */
  points: string[];
  /** Closed polygon, in sketch coordinates. */
  polygon: Vec2[];
  /** Absolute area in mm². */
  area: number;
}

const MAX_DEPTH = 24;
const MAX_LOOPS = 500;

export function findLoops(sketch: Sketch): SketchLoop[] {
  const position = new Map(sketch.points.map((point) => [point.id, point]));

  // Undirected adjacency over profile lines. Construction geometry and circles
  // are not part of a polyline loop.
  const adjacency = new Map<string, { curve: string; other: string }[]>();
  for (const curve of sketch.curves) {
    if (curve.type !== "line" || curve.construction) continue;
    if (!position.has(curve.a) || !position.has(curve.b)) continue;
    addEdge(adjacency, curve.id, curve.a, curve.b);
    addEdge(adjacency, curve.id, curve.b, curve.a);
  }

  const loops = new Map<string, SketchLoop>();

  const walk = (
    start: string,
    current: string,
    visited: Set<string>,
    pointPath: string[],
    curvePath: string[],
  ): void => {
    if (loops.size >= MAX_LOOPS || curvePath.length >= MAX_DEPTH) return;

    for (const edge of adjacency.get(current) ?? []) {
      if (curvePath.includes(edge.curve)) continue;

      if (edge.other === start) {
        if (curvePath.length + 1 < 3) continue;
        recordLoop(loops, pointPath, [...curvePath, edge.curve], position);
        continue;
      }

      if (visited.has(edge.other)) continue;
      visited.add(edge.other);
      pointPath.push(edge.other);
      curvePath.push(edge.curve);
      walk(start, edge.other, visited, pointPath, curvePath);
      curvePath.pop();
      pointPath.pop();
      visited.delete(edge.other);
    }
  };

  for (const start of adjacency.keys()) {
    walk(start, start, new Set([start]), [start], []);
  }

  return [...loops.values()].sort((a, b) => b.area - a.area);
}

/** The largest closed profile plus every circle contained inside it. */
export function profileFromSketch(sketch: Sketch): SketchProfile | null {
  const loops = findLoops(sketch);
  const outer = loops[0];
  if (!outer) return null;

  const polygon = outer.polygon;
  const circles = sketch.curves.flatMap((curve) =>
    curve.type === "circle" ? [curve] : [],
  );

  // Circles whose centre is inside the outer loop are holes. Clearance is
  // validated by the kernel worker, which reports a crossing hole instead of
  // silently dropping it.
  const holes = circles.flatMap((circle) => {
    const center = sketch.points.find((point) => point.id === circle.center);
    if (!center) return [];
    if (!pointInPolygon([center.x, center.y], polygon)) return [];
    return [
      {
        kind: "circle" as const,
        center: [center.x, center.y] as Vec2,
        radius: circle.radius,
      },
    ];
  });

  return {
    outer: { kind: "polygon" as const, points: outer.polygon },
    holes,
    loop: outer,
  };
}

function addEdge(
  adjacency: Map<string, { curve: string; other: string }[]>,
  curve: string,
  from: string,
  to: string,
): void {
  const list = adjacency.get(from) ?? [];
  list.push({ curve, other: to });
  adjacency.set(from, list);
}

function recordLoop(
  loops: Map<string, SketchLoop>,
  pointPath: string[],
  curvePath: string[],
  position: Map<string, { x: number; y: number }>,
): void {
  const key = [...curvePath].sort().join("|");
  if (loops.has(key)) return;

  const polygon = pointPath.flatMap((id) => {
    const point = position.get(id);
    return point ? ([[point.x, point.y] as Vec2] satisfies Vec2[]) : [];
  });
  if (polygon.length < 3) return;

  loops.set(key, {
    curves: [...curvePath],
    points: [...pointPath],
    polygon,
    area: Math.abs(signedArea(polygon)),
  });
}

function signedArea(points: readonly Vec2[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const current = points[i]!;
    const next = points[(i + 1) % points.length]!;
    area += current[0] * next[1] - next[0] * current[1];
  }
  return area / 2;
}

function pointInPolygon(point: Vec2, polygon: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    const crosses =
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0];
    if (crosses) inside = !inside;
  }
  return inside;
}

export { pointInPolygon as pointInSketchPolygon };
