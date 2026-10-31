import type { ProfileLoop, ProfileSegment, Vec2 } from "../types";
import { arcGeometry, arcPointAt } from "./geometry";
import { allPoints, type Sketch } from "./types";

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
  /** Point ids at curve junctions, in traversal order. */
  points: string[];
  /** Closed polygon (arcs sampled), in sketch coordinates. */
  polygon: Vec2[];
  /** Exact line/arc edges when the loop contains arcs. */
  segments: ProfileSegment[] | null;
  /** Absolute area in mm² (approximate for arcs). */
  area: number;
}

const MAX_DEPTH = 24;
const MAX_LOOPS = 500;

export function findLoops(sketch: Sketch): SketchLoop[] {
  const all = allPoints(sketch);
  const position = new Map(all.map((point) => [point.id, point]));
  const pointRecord: Record<string, Vec2> = Object.fromEntries(
    all.map((point) => [point.id, [point.x, point.y] as Vec2]),
  );
  const curvesById = new Map(
    sketch.curves.map((curve) => [curve.id, curve] as const),
  );

  // Undirected adjacency over profile lines and arcs. Construction geometry and
  // circles are not part of a path loop.
  const adjacency = new Map<string, { curve: string; other: string }[]>();
  for (const curve of sketch.curves) {
    if (curve.construction) continue;
    if (curve.type === "line") {
      if (!position.has(curve.a) || !position.has(curve.b)) continue;
      addEdge(adjacency, curve.id, curve.a, curve.b);
      addEdge(adjacency, curve.id, curve.b, curve.a);
    } else if (curve.type === "arc") {
      if (!position.has(curve.start) || !position.has(curve.end)) continue;
      addEdge(adjacency, curve.id, curve.start, curve.end);
      addEdge(adjacency, curve.id, curve.end, curve.start);
    }
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
        recordLoop(
          loops,
          pointPath,
          [...curvePath, edge.curve],
          position,
          pointRecord,
          curvesById,
        );
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
    const center = allPoints(sketch).find((point) => point.id === circle.center);
    if (center) circleCenters.set(circle.id, [center.x, center.y]);
  }

  const candidates: Candidate[] = findLoops(sketch).map((loop) => ({
    outer: loop.segments
      ? { kind: "path", points: loop.polygon, segments: loop.segments }
      : { kind: "polygon", points: loop.polygon },
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
  if (inner.kind === "polygon" || inner.kind === "path") {
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
  if (loop.kind === "polygon" || loop.kind === "path") {
    return pointInPolygon(point, loop.points);
  }
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
  pointRecord: Record<string, Vec2>,
  curvesById: Map<string, Sketch["curves"][number]>,
): void {
  const key = [...curvePath].sort().join("|");
  if (loops.has(key)) return;

  const polygon: Vec2[] = [];
  const segments: ProfileSegment[] = [];
  let hasArc = false;

  for (let i = 0; i < curvePath.length; i++) {
    const from = pointPath[i];
    const to = i + 1 < pointPath.length ? pointPath[i + 1] : pointPath[0];
    if (!from || !to) return;
    const start = position.get(from);
    const end = position.get(to);
    if (!start || !end) return;
    const curve = curvePath[i];
    if (!curve) return;
    const definition = curvesById.get(curve);
    if (!definition) return;

    if (definition.type === "line") {
      polygon.push([start.x, start.y]);
      segments.push({
        kind: "line",
        a: [start.x, start.y],
        b: [end.x, end.y],
      });
      continue;
    }

    if (definition.type === "arc") {
      hasArc = true;
      const geometry = arcGeometry(definition, pointRecord);
      if (!geometry) return;
      const forward = from === definition.start && to === definition.end;
      const backward = from === definition.end && to === definition.start;
      if (!forward && !backward) return;
      const steps = Math.max(4, Math.ceil(geometry.sweep / (Math.PI / 36)));
      polygon.push([start.x, start.y]);
      for (let step = 1; step < steps; step++) {
        const t = forward ? step / steps : 1 - step / steps;
        polygon.push(arcPointAt(geometry, t));
      }
      const mid = arcPointAt(geometry, 0.5);
      segments.push({
        kind: "arc",
        center: geometry.center,
        radius: geometry.radius,
        start: [start.x, start.y],
        end: [end.x, end.y],
        mid,
      });
    }
  }

  if (polygon.length < 3) return;
  loops.set(key, {
    curves: [...curvePath],
    points: [...pointPath],
    polygon,
    segments: hasArc ? segments : null,
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
