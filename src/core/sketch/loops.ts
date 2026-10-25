import type { ProfileLoop, Vec2 } from "../types";
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
  outer: ProfileLoop;
  /** Closed regions strictly inside the outer loop. */
  holes: ProfileLoop[];
  /** The line loop, when the outer profile is a polygon. */
  loop: SketchLoop | null;
  /** Set when the outer profile came from a circle. */
  outerCircleId?: string;
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

interface Candidate {
  outer: ProfileLoop;
  area: number;
  loop: SketchLoop | null;
  circleId?: string;
}

/**
 * Pick the largest closed region as the outer profile, then every circle whose
 * centre lies inside it as a hole.
 *
 * A circle is itself a closed region, so a lone circle extrudes to a cylinder;
 * two concentric circles make a tube. Line loops and circles compete by area.
 * M2 replaces this with explicit region selection.
 */
export function profileFromSketch(sketch: Sketch): SketchProfile | null {
  const circles = sketch.curves.flatMap((curve) =>
    curve.type === "circle" && !curve.construction ? [curve] : [],
  );
  const circleCenters = new Map<string, Vec2>();
  for (const circle of circles) {
    const center = sketch.points.find((point) => point.id === circle.center);
    if (center) circleCenters.set(circle.id, [center.x, center.y]);
  }

  const candidates: Candidate[] = findLoops(sketch).map((loop) => ({
    outer: { kind: "polygon", points: loop.polygon },
    area: loop.area,
    loop,
  }));

  for (const circle of circles) {
    const center = circleCenters.get(circle.id);
    if (!center) continue;
    candidates.push({
      outer: { kind: "circle", center, radius: circle.radius },
      area: Math.PI * circle.radius * circle.radius,
      loop: null,
      circleId: circle.id,
    });
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.area - a.area);
  const winner = candidates[0]!;

  // Every other closed region strictly inside the winner becomes a hole:
  // circles and line loops alike. A loop that shares edges with the outer is a
  // subdivision of it, not a hole (think rectangle + diagonal).
  const holeCandidates = candidates
    .filter((candidate) => candidate !== winner)
    .filter((candidate) => regionInside(candidate.outer, winner.outer))
    .filter(
      (candidate) =>
        !(winner.loop && candidate.loop && sharesCurve(winner.loop, candidate.loop)),
    )
    .sort((a, b) => b.area - a.area);

  // Only one level of nesting: an island inside a hole is ignored rather than
  // subtracted twice.
  const holes: ProfileLoop[] = [];
  for (const candidate of holeCandidates) {
    if (holes.some((hole) => regionInside(candidate.outer, hole))) continue;
    holes.push(candidate.outer);
  }

  return {
    outer: winner.outer,
    holes,
    loop: winner.loop,
    ...(winner.circleId ? { outerCircleId: winner.circleId } : {}),
  };
}

/** Is `inner` strictly contained by `outer`? */
function regionInside(inner: ProfileLoop, outer: ProfileLoop): boolean {
  if (inner.kind === "polygon") {
    if (inner.points.length < 3) return false;
    return inner.points.every((point) => containsPoint(outer, point));
  }

  if (outer.kind === "circle") {
    const gap = Math.hypot(
      inner.center[0] - outer.center[0],
      inner.center[1] - outer.center[1],
    );
    return gap + inner.radius < outer.radius - 1e-9;
  }
  return containsPoint(outer, inner.center);
}

function sharesCurve(a: SketchLoop, b: SketchLoop): boolean {
  return a.curves.some((curve) => b.curves.includes(curve));
}

function containsPoint(loop: ProfileLoop, point: Vec2): boolean {
  if (loop.kind === "polygon") return pointInPolygon(point, loop.points);
  return (
    Math.hypot(point[0] - loop.center[0], point[1] - loop.center[1]) < loop.radius
  );
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
