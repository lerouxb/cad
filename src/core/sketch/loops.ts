import type { ProfileLoop, ProfileSegment, Vec2 } from "../types";
import { arcGeometry, arcPointAt, normalizeAngle } from "./geometry";
import { allPoints, type Sketch } from "./types";
import { planarArrangement, type PlanarArrangement } from "./arrangement";

/**
 * Closed faces of the planar arrangement's line/arc graph.
 *
 * A half-edge walk is used instead of enumerating simple cycles: it naturally
 * produces faces that share an edge (a plate split by a line through its hole)
 * and does not mistake the outer cycle of a subdivided face for another face.
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

/**
 * A selectable profile: an outer boundary plus its direct hole loops.
 *
 * Every containment face is selectable, not just the even-depth "material"
 * ones. A circle nested in a rectangle is both a hole of the rectangle and a
 * valid disk-shaped profile; which one the user wants is an operation choice,
 * not a property of the sketch. `kind` records the containment parity so the
 * UI can default to material and style/label voids, but both are extrusions.
 */
export interface SketchRegion {
  id: string;
  outer: ProfileLoop;
  holes: ProfileLoop[];
  /** The line/arc loop, when the outer boundary is not a circle. */
  loop: SketchLoop | null;
  outerCircleId?: string;
  depth: number;
  /** Even depth is material; odd depth is negative space of its parent. */
  kind: "material" | "void";
  /** Net area: outer minus direct holes. */
  area: number;
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

const MAX_FACE_EDGES = 4096;
const MAX_FACES = 500;

interface HalfEdge {
  curveId: string;
  from: string;
  to: string;
  /** Outgoing tangent angle at `from`, in [0, 2π). */
  angle: number;
  reverse: HalfEdge;
  /** Previous edge in the destination node's angular order. */
  prevOut: HalfEdge;
  /** Next edge in the face on the left of this edge. */
  next: HalfEdge;
  visited: boolean;
}

/**
 * Extract closed loops from the planar arrangement using a half-edge walk.
 * The document is untouched; trim materializes cuts only when the user keeps
 * them.
 */
export function findLoops(sketch: Sketch): SketchLoop[] {
  return findFacesFromArrangement(planarArrangement(sketch));
}

function findFacesFromArrangement(
  arrangement: PlanarArrangement,
): SketchLoop[] {
  const arranged = arrangement.sketch;
  const position = new Map(arranged.points.map((point) => [point.id, point]));
  const pointRecord: Record<string, Vec2> = Object.fromEntries(
    arranged.points.map((point) => [point.id, [point.x, point.y] as Vec2]),
  );
  const curvesById = new Map(
    arranged.curves.map((curve) => [curve.id, curve] as const),
  );

  const outgoing = new Map<string, HalfEdge[]>();
  const halfEdges: HalfEdge[] = [];

  const make = (
    curveId: string,
    from: string,
    to: string,
    angle: number,
  ): HalfEdge => {
    const edge: HalfEdge = {
      curveId,
      from,
      to,
      angle: normalizeAngle(angle),
      reverse: undefined as unknown as HalfEdge,
      prevOut: undefined as unknown as HalfEdge,
      next: undefined as unknown as HalfEdge,
      visited: false,
    };
    halfEdges.push(edge);
    const list = outgoing.get(from) ?? [];
    list.push(edge);
    outgoing.set(from, list);
    return edge;
  };

  for (const curve of arranged.curves) {
    if (curve.construction) continue;
    if (curve.type === "line") {
      const a = position.get(curve.a);
      const b = position.get(curve.b);
      if (!a || !b) continue;
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      const forward = make(curve.id, curve.a, curve.b, angle);
      const reverse = make(
        curve.id,
        curve.b,
        curve.a,
        angle + Math.PI,
      );
      forward.reverse = reverse;
      reverse.reverse = forward;
      continue;
    }
    if (curve.type === "arc") {
      const geometry = arcGeometry(curve, pointRecord);
      if (!geometry || !position.has(curve.start) || !position.has(curve.end)) {
        continue;
      }
      // CCW arc tangent is the radius rotated +90 degrees.
      const forward = make(
        curve.id,
        curve.start,
        curve.end,
        geometry.startAngle + Math.PI / 2,
      );
      const reverse = make(
        curve.id,
        curve.end,
        curve.start,
        geometry.endAngle - Math.PI / 2,
      );
      forward.reverse = reverse;
      reverse.reverse = forward;
    }
  }

  for (const list of outgoing.values()) {
    list.sort(
      (a, b) =>
        a.angle - b.angle ||
        (a.curveId < b.curveId ? -1 : a.curveId > b.curveId ? 1 : 0),
    );
    const count = list.length;
    for (let i = 0; i < count; i++) {
      list[i]!.prevOut = list[(i - 1 + count) % count]!;
    }
  }

  for (const edge of halfEdges) {
    if (!edge.reverse?.prevOut) continue;
    edge.next = edge.reverse.prevOut;
  }

  const loops: SketchLoop[] = [];
  for (const start of halfEdges) {
    if (start.visited || !start.next || loops.length >= MAX_FACES) continue;
    const path: HalfEdge[] = [];
    let edge: HalfEdge | null = start;
    let guard = 0;
    do {
      if (!edge || edge.visited) {
        edge = null;
        break;
      }
      edge.visited = true;
      path.push(edge);
      edge = edge.next;
      guard += 1;
    } while (edge !== start && guard < MAX_FACE_EDGES);
    if (edge !== start) continue;

    const loop = faceToLoop(path, position, pointRecord, curvesById);
    if (loop) loops.push(loop);
  }

  return loops.sort((a, b) => b.area - a.area);
}

function faceToLoop(
  path: readonly HalfEdge[],
  position: Map<string, { id: string; x: number; y: number }>,
  pointRecord: Record<string, Vec2>,
  curvesById: Map<string, Sketch["curves"][number]>,
): SketchLoop | null {
  const polygon: Vec2[] = [];
  const segments: ProfileSegment[] = [];
  const curves: string[] = [];
  const points: string[] = [];
  let hasArc = false;

  for (const edge of path) {
    const from = position.get(edge.from);
    const to = position.get(edge.to);
    const definition = curvesById.get(edge.curveId);
    if (!from || !to || !definition) return null;

    curves.push(edge.curveId);
    points.push(edge.from);

    if (definition.type === "line") {
      polygon.push([from.x, from.y]);
      segments.push({
        kind: "line",
        a: [from.x, from.y],
        b: [to.x, to.y],
      });
      continue;
    }

    if (definition.type !== "arc") return null;
    hasArc = true;
    const geometry = arcGeometry(definition, pointRecord);
    if (!geometry) return null;
    const forward =
      edge.from === definition.start && edge.to === definition.end;
    const backward =
      edge.from === definition.end && edge.to === definition.start;
    if (!forward && !backward) return null;

    const steps = Math.max(4, Math.ceil(geometry.sweep / (Math.PI / 36)));
    polygon.push([from.x, from.y]);
    for (let step = 1; step < steps; step++) {
      const t = forward ? step / steps : 1 - step / steps;
      polygon.push(arcPointAt(geometry, t));
    }
    const mid = arcPointAt(geometry, 0.5);
    segments.push({
      kind: "arc",
      center: geometry.center,
      radius: geometry.radius,
      start: [from.x, from.y],
      end: [to.x, to.y],
      mid,
    });
  }

  if (polygon.length < 3) return null;
  const area = signedArea(polygon);
  // The half-edge walk keeps the face on the left. Bounded faces are CCW;
  // the unbounded outside of each component is CW and is discarded.
  if (area <= 1e-6) return null;

  return {
    curves,
    points,
    polygon,
    segments: hasArc ? segments : null,
    area,
  };
}

interface Candidate {
  outer: ProfileLoop;
  area: number;
  loop: SketchLoop | null;
  circleId?: string;
}

/**
 * Legacy largest-face helper: pick the largest closed face, then every circle
 * whose centre lies inside it as a hole.
 */
export function profileFromSketch(sketch: Sketch): SketchProfile | null {
  const arrangement = planarArrangement(sketch);
  const circles = [
    ...sketch.curves,
    ...(sketch.references?.circles ?? []),
  ].flatMap((curve) =>
    curve.type === "circle" &&
    !curve.construction &&
    (!("reference" in curve) || curve.projectionId !== undefined)
      ? [curve]
      : [],
  );
  const circleCenters = new Map<string, Vec2>();
  for (const circle of circles) {
    const center = allPoints(sketch).find((point) => point.id === circle.center);
    if (center) circleCenters.set(circle.id, [center.x, center.y]);
  }

  const candidates: Candidate[] = findFacesFromArrangement(arrangement).map(
    (loop) => ({
      outer: loop.segments
        ? { kind: "path", points: loop.polygon, segments: loop.segments }
        : { kind: "polygon", points: loop.polygon },
      area: loop.area,
      loop,
    }),
  );

  for (const circle of circles) {
    if (arrangement.splitCircleIds.has(circle.id)) continue;
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

  const holeCandidates = candidates
    .filter((candidate) => candidate !== winner)
    .filter((candidate) => regionInside(candidate.outer, winner.outer))
    .sort((a, b) => b.area - a.area);

  // Only one level of nesting in the legacy helper; the app uses regions.
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

interface RegionCandidate {
  outer: ProfileLoop;
  area: number;
  loop: SketchLoop | null;
  circleId?: string;
  curves: string[];
  parent: number | null;
  depth: number;
}

/**
 * Extract selectable regions from the sketch.
 *
 * The half-edge walk returns the actual faces of the arrangement, including
 * faces that share an edge: a line through a circular hole yields the two
 * plate pieces and the two void half-disks, not one circle plus a dropped
 * material face.
 *
 * Disconnected loops (a circle inside a rectangle) are nested into a
 * containment tree. Even depths are material; odd depths are negative space.
 * *All* faces are returned, because the user may extrude either side of the
 * boundary. Each region's direct children are its holes.
 *
 * Region ids hash the outer and direct-hole curve ids, so a selection survives
 * dimension/constraint edits and invalidates when the boundary itself changes.
 */
export function regionsFromSketch(sketch: Sketch): SketchRegion[] {
  const arrangement = planarArrangement(sketch);
  const loops = findFacesFromArrangement(arrangement);
  const loopProfiles = new Map<SketchLoop, ProfileLoop>();
  for (const loop of loops) {
    loopProfiles.set(
      loop,
      loop.segments
        ? { kind: "path", points: loop.polygon, segments: loop.segments }
        : { kind: "polygon", points: loop.polygon },
    );
  }

  const candidates: RegionCandidate[] = loops.map((loop) => ({
    outer: loopProfiles.get(loop)!,
    area: loop.area,
    loop,
    curves: loop.curves,
    parent: null,
    depth: 0,
  }));

  const circles = [
    ...sketch.curves,
    ...(sketch.references?.circles ?? []),
  ].flatMap((curve) =>
    curve.type === "circle" &&
    !curve.construction &&
    (!("reference" in curve) || curve.projectionId !== undefined)
      ? [curve]
      : [],
  );
  for (const circle of circles) {
    if (arrangement.splitCircleIds.has(circle.id)) continue;
    const center = allPoints(sketch).find((point) => point.id === circle.center);
    if (!center) continue;
    candidates.push({
      outer: { kind: "circle", center: [center.x, center.y], radius: circle.radius },
      area: Math.PI * circle.radius * circle.radius,
      loop: null,
      circleId: circle.id,
      curves: [circle.id],
      parent: null,
      depth: 0,
    });
  }

  candidates.sort((a, b) => b.area - a.area);
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i]!;
    let parent: number | null = null;
    let parentArea = Infinity;
    for (let j = 0; j < candidates.length; j++) {
      const container = candidates[j];
      if (!container || i === j) continue;
      if (container.area <= candidate.area + 1e-9) continue;
      if (container.area >= parentArea) continue;
      if (!regionInside(candidate.outer, container.outer)) continue;
      parent = j;
      parentArea = container.area;
    }
    candidate.parent = parent;
    candidate.depth = parent === null ? 0 : candidates[parent]!.depth + 1;
  }

  const regions: SketchRegion[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i]!;
    const children = candidates.filter(
      (child) => child.parent === i && child.depth === candidate.depth + 1,
    );
    const curveIds = [
      ...candidate.curves,
      ...children.flatMap((child) => child.curves),
    ].sort();
    regions.push({
      id: `reg-${hashKey(curveIds.join("|"))}`,
      outer: candidate.outer,
      holes: children.map((child) => child.outer),
      loop: candidate.loop,
      ...(candidate.circleId ? { outerCircleId: candidate.circleId } : {}),
      depth: candidate.depth,
      kind: candidate.depth % 2 === 0 ? "material" : "void",
      area: Math.max(
        0,
        candidate.area - children.reduce((sum, child) => sum + child.area, 0),
      ),
    });
  }

  return regions.sort((a, b) => b.area - a.area);
}

export interface SketchBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Regions whose entire outer boundary lies inside the box. This is the v1 box
 * selection rule ("fully inside"); crossing selection is a separate decision.
 */
export function regionsFullyInside(
  regions: readonly SketchRegion[],
  box: SketchBox,
): SketchRegion[] {
  return regions.filter((region) => loopFullyInside(region.outer, box));
}

function loopFullyInside(loop: ProfileLoop, box: SketchBox): boolean {
  const eps = 1e-6;
  const inside = (x: number, y: number): boolean =>
    x >= box.minX - eps &&
    x <= box.maxX + eps &&
    y >= box.minY - eps &&
    y <= box.maxY + eps;
  if (loop.kind === "circle") {
    const [cx, cy] = loop.center;
    return (
      inside(cx - loop.radius, cy - loop.radius) &&
      inside(cx + loop.radius, cy + loop.radius)
    );
  }
  return loop.points.every(([x, y]) => inside(x, y));
}

/** Regions whose entire outer boundary lies insides a freehand lasso polygon. */
export function regionsFullyInsidePolygon(
  regions: readonly SketchRegion[],
  polygon: readonly Vec2[],
): SketchRegion[] {
  if (polygon.length < 3) return [];
  return regions.filter((region) =>
    loopFullyInsidePolygon(region.outer, polygon),
  );
}

function loopFullyInsidePolygon(
  loop: ProfileLoop,
  polygon: readonly Vec2[],
): boolean {
  if (loop.kind === "circle") {
    const [cx, cy] = loop.center;
    const samples = 32;
    for (let i = 0; i < samples; i++) {
      const angle = (i / samples) * Math.PI * 2;
      if (
        !pointInPolygon(
          [cx + Math.cos(angle) * loop.radius, cy + Math.sin(angle) * loop.radius],
          polygon,
        )
      ) {
        return false;
      }
    }
    return true;
  }
  return loop.points.every((point) => pointInPolygon(point, polygon));
}

/**
 * Regions touched by a freehand lasso. Unlike the box's fully-inside rule, a
 * lasso selects a profile when it crosses or encloses any of its material (a
 * corner loop around a profile is a selection, not an empty gesture). A lasso
 * entirely inside a hole does not select the parent material.
 */
export function regionsIntersectingPolygon(
  regions: readonly SketchRegion[],
  polygon: readonly Vec2[],
): SketchRegion[] {
  if (polygon.length < 3) return [];
  return regions.filter((region) => regionIntersectsPolygon(region, polygon));
}

function regionIntersectsPolygon(
  region: SketchRegion,
  polygon: readonly Vec2[],
): boolean {
  const outer = loopPolygon(region.outer);
  if (polygonsCross(polygon, outer)) return true;
  for (const hole of region.holes) {
    if (polygonsCross(polygon, loopPolygon(hole))) return true;
  }
  if (polygon.some((point) => regionFilledContains(region, point))) return true;
  // The lasso can also enclose the whole region without containing its
  // boundary vertices in the material check above.
  return outer.some((point) => pointInPolygon(point, polygon));
}

function regionFilledContains(region: SketchRegion, point: Vec2): boolean {
  if (!loopContainsPoint(region.outer, point)) return false;
  return !region.holes.some((hole) => loopContainsPoint(hole, point));
}

function loopContainsPoint(loop: ProfileLoop, point: Vec2): boolean {
  if (loop.kind === "circle") {
    return (
      Math.hypot(point[0] - loop.center[0], point[1] - loop.center[1]) <
      loop.radius
    );
  }
  return pointInPolygon(point, loop.points);
}

function loopPolygon(loop: ProfileLoop): Vec2[] {
  if (loop.kind === "circle") {
    const [cx, cy] = loop.center;
    return Array.from({ length: 32 }, (_, index): Vec2 => {
      const angle = (index / 32) * Math.PI * 2;
      return [
        cx + Math.cos(angle) * loop.radius,
        cy + Math.sin(angle) * loop.radius,
      ];
    });
  }
  return loop.points;
}

/** True when any edge of the two closed polygons crosses or touches. */
function polygonsCross(a: readonly Vec2[], b: readonly Vec2[]): boolean {
  for (let i = 0; i < a.length; i++) {
    const a0 = a[i]!;
    const a1 = a[(i + 1) % a.length]!;
    for (let j = 0; j < b.length; j++) {
      if (segmentsIntersect(a0, a1, b[j]!, b[(j + 1) % b.length]!)) return true;
    }
  }
  return false;
}

function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const cross = (p: Vec2, q: Vec2, r: Vec2): number =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  if (
    ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
    ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
  ) {
    return true;
  }
  const eps = 1e-9;
  const onSegment = (p: Vec2, q: Vec2, r: Vec2): boolean =>
    Math.abs(cross(p, q, r)) < eps &&
    r[0] >= Math.min(p[0], q[0]) - eps &&
    r[0] <= Math.max(p[0], q[0]) + eps &&
    r[1] >= Math.min(p[1], q[1]) - eps &&
    r[1] <= Math.max(p[1], q[1]) + eps;
  return (
    onSegment(c, d, a) ||
    onSegment(c, d, b) ||
    onSegment(a, b, c) ||
    onSegment(a, b, d)
  );
}

function hashKey(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
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

function containsPoint(loop: ProfileLoop, point: Vec2): boolean {
  if (loop.kind === "polygon" || loop.kind === "path") {
    return pointInPolygon(point, loop.points);
  }
  return (
    Math.hypot(point[0] - loop.center[0], point[1] - loop.center[1]) < loop.radius
  );
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

/** Ray-casting point-in-polygon test; boundary cases are not important here. */
export function pointInPolygon(point: Vec2, polygon: readonly Vec2[]): boolean {
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
