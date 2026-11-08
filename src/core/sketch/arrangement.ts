import type { Vec2 } from "../types";
import {
  arcGeometry,
  normalizeAngle,
  type ArcGeometry,
} from "./geometry";
import { allPoints, type Sketch, type SketchArc, type SketchLine } from "./types";

/**
 * A planar arrangement of the sketch's line and arc segments.
 *
 * The document keeps the curves the user drew. This module derives the split
 * graph: every crossing or T-junction becomes a real node, and each source
 * curve becomes one or more segments between them. Region extraction consumes
 * it, so two crossing diagonals become four faces without rewriting the
 * document or re-solving constraints. Trim uses the same pieces and only
 * materializes the cuts it keeps.
 */
export interface PlanarPiece {
  /** Unique id for this split segment. The source id when no split occurred. */
  id: string;
  /** The line/arc this piece came from. */
  sourceId: string;
  sourceType: "line" | "arc";
  /** Parameter interval on the source curve, both in [0, 1]. */
  t0: number;
  t1: number;
  start: string;
  end: string;
  /** Midpoint, used for hit-testing and trimming. */
  midpoint: Vec2;
}

export interface PlanarArrangement {
  /** A split copy of the sketch: points and line/arc curves only. */
  sketch: Sketch;
  pieces: PlanarPiece[];
  bySource: Map<string, PlanarPiece[]>;
  /** Every node position, keyed by point id. */
  nodes: Map<string, Vec2>;
  /** The resolved source curve records, keyed by original curve id. */
  records: Map<string, CurveRecord>;
  /** Circles that were replaced by arc segments because they were split. */
  splitCircleIds: Set<string>;
}

type ProfileLine = SketchLine;
type ProfileArc = SketchArc;

interface LineRecord {
  kind: "line";
  curve: ProfileLine;
  start: Vec2;
  end: Vec2;
}

interface ArcRecord {
  kind: "arc";
  curve: ProfileArc;
  start: Vec2;
  end: Vec2;
  geometry: ArcGeometry;
}

type CurveRecord = LineRecord | ArcRecord;

interface CircleRecord {
  id: string;
  centerId: string;
  center: Vec2;
  radius: number;
}

interface ParamEntry {
  t: number;
  /** Existing sketch point at this parameter, when there is one. */
  pointId?: string;
}

interface ResolvedParam {
  t: number;
  pointId?: string;
  point: Vec2;
  nodeId: string;
}

const GEOM_EPS = 1e-6;
const ON_CURVE_EPS = 1e-5;
const PARAM_EPS = 1e-9;
const KEY_SCALE = 1e6;

/**
 * Build the split arrangement for every non-construction line and arc.
 * Construction geometry is deliberately excluded, like profile extraction.
 */
export function planarArrangement(sketch: Sketch): PlanarArrangement {
  const positions = new Map<string, Vec2>();
  // Include the fixed origin/axes: a line or circle may reuse the origin as a
  // real point, and the arrangement needs its coordinates to connect it.
  for (const point of allPoints(sketch)) {
    positions.set(point.id, [point.x, point.y]);
  }

  const records: CurveRecord[] = [];
  const circles: CircleRecord[] = [];
  const usedPointIds = new Set<string>();
  const centerIds = new Set<string>();

  const profileCurves = [
    ...sketch.curves,
    ...(sketch.references?.lines.filter(
      (line) => line.projectionId !== undefined && !line.construction,
    ) ?? []),
    ...(sketch.references?.circles?.filter(
      (circle) => circle.projectionId !== undefined && !circle.construction,
    ) ?? []),
  ];
  for (const curve of profileCurves) {
    if (curve.construction) continue;
    if (curve.type === "line") {
      const start = positions.get(curve.a);
      const end = positions.get(curve.b);
      if (!start || !end) continue;
      records.push({ kind: "line", curve, start, end });
      usedPointIds.add(curve.a);
      usedPointIds.add(curve.b);
    } else if (curve.type === "arc") {
      const geometry = arcGeometry(curve, Object.fromEntries(positions));
      const start = positions.get(curve.start);
      const end = positions.get(curve.end);
      if (!geometry || !start || !end) continue;
      records.push({ kind: "arc", curve, start, end, geometry });
      usedPointIds.add(curve.start);
      usedPointIds.add(curve.end);
      centerIds.add(curve.center);
    } else {
      const center = positions.get(curve.center);
      if (center) {
        circles.push({
          id: curve.id,
          centerId: curve.center,
          center,
          radius: curve.radius,
        });
        centerIds.add(curve.center);
      }
    }
  }

  const circleSplits = new Map<string, Vec2[]>();
  for (const circle of circles) circleSplits.set(circle.id, []);

  const params = new Map<string, ParamEntry[]>();
  for (const record of records) {
    params.set(record.curve.id, [
      { t: 0, pointId: startId(record) },
      { t: 1, pointId: endId(record) },
    ]);
  }

  const add = (curveId: string, entry: ParamEntry): void => {
    const list = params.get(curveId);
    if (list) list.push(entry);
  };

  for (let i = 0; i < records.length; i++) {
    const a = records[i]!;
    for (let j = i + 1; j < records.length; j++) {
      const b = records[j]!;
      for (const hit of intersectCurves(a, b)) {
        add(a.curve.id, { t: hit.ta });
        add(b.curve.id, { t: hit.tb });
      }
    }
  }

  for (const record of records) {
    for (const circle of circles) {
      for (const t of intersectCurveCircle(record, circle)) {
        add(record.curve.id, { t });
        circleSplits.get(circle.id)?.push(pointAt(record, t));
      }
    }
  }

  // Two circles crossing split each other into arcs (a lens or overlapping
  // disks). Tangency leaves one split point and therefore keeps both circles
  // whole.
  for (let i = 0; i < circles.length; i++) {
    const a = circles[i]!;
    for (let j = i + 1; j < circles.length; j++) {
      const b = circles[j]!;
      for (const point of intersectCircles(a, b)) {
        circleSplits.get(a.id)?.push(point);
        circleSplits.get(b.id)?.push(point);
      }
    }
  }

  // An endpoint sitting on a circle is a T-junction. It only becomes a split
  // when the circle has at least two such/contact points.
  for (const circle of circles) {
    for (const pointId of usedPointIds) {
      const point = positions.get(pointId);
      if (!point) continue;
      if (Math.abs(distance(circle.center, point) - circle.radius) <= ON_CURVE_EPS) {
        circleSplits.get(circle.id)?.push(point);
      }
    }
  }

  // A T-junction is not a curve/curve crossing: one curve ends on the interior
  // of another. Every profile endpoint is a candidate split.
  for (const record of records) {
    for (const pointId of usedPointIds) {
      const point = positions.get(pointId);
      if (!point) continue;
      const t = curveParameterAtPoint(record, point);
      if (t === null) continue;
      if (t > PARAM_EPS && t < 1 - PARAM_EPS) {
        add(record.curve.id, { t, pointId });
      }
    }
  }

  const nodeByKey = new Map<string, string>();
  const nodes = new Map<string, Vec2>();
  // Prefer the user's existing points so shared endpoints stay shared.
  for (const pointId of [...usedPointIds, ...centerIds]) {
    const point = positions.get(pointId);
    if (!point) continue;
    const key = coordinateKey(point);
    if (!nodeByKey.has(key)) nodeByKey.set(key, pointId);
    nodes.set(pointId, point);
  }

  const splitCurves: Sketch["curves"] = [];
  const pieces: PlanarPiece[] = [];
  const bySource = new Map<string, PlanarPiece[]>();

  for (const record of records) {
    const resolved = resolveParams(record, params.get(record.curve.id) ?? []);
    const sourcePieces: PlanarPiece[] = [];
    for (let i = 0; i < resolved.length - 1; i++) {
      const from = resolved[i]!;
      const to = resolved[i + 1]!;
      if (distance(from.point, to.point) < GEOM_EPS) continue;

      const unsplit = resolved.length === 2 && from.t === 0 && to.t === 1;
      const id = unsplit ? record.curve.id : `${record.curve.id}~${i}`;
      if (record.kind === "line") {
        splitCurves.push({
          id,
          type: "line",
          a: from.nodeId,
          b: to.nodeId,
        });
      } else {
        splitCurves.push({
          id,
          type: "arc",
          center: record.curve.center,
          start: from.nodeId,
          end: to.nodeId,
        });
      }
      const piece: PlanarPiece = {
        id,
        sourceId: record.curve.id,
        sourceType: record.kind,
        t0: from.t,
        t1: to.t,
        start: from.nodeId,
        end: to.nodeId,
        midpoint: pointAt(record, (from.t + to.t) / 2),
      };
      pieces.push(piece);
      sourcePieces.push(piece);
    }
    bySource.set(record.curve.id, sourcePieces);
  }

  const splitCircleIds = new Set<string>();

  for (const circle of circles) {
    const splits = dedupeCircleSplits(circle, circleSplits.get(circle.id) ?? []);
    if (splits.length < 2) continue;
    splitCircleIds.add(circle.id);

    const sourcePieces: PlanarPiece[] = [];
    for (let i = 0; i < splits.length; i++) {
      const from = splits[i]!;
      const to = splits[(i + 1) % splits.length]!;
      const sweep = normalizeAngle(to.angle - from.angle) || Math.PI * 2;
      const start = from.point;
      const end = to.point;
      const id = `${circle.id}~${i}`;
      const startNode = nodeForPoint(start);
      const endNode = nodeForPoint(end);
      splitCurves.push({
        id,
        type: "arc",
        center: circle.centerId,
        start: startNode,
        end: endNode,
      });
      const piece: PlanarPiece = {
        id,
        sourceId: circle.id,
        sourceType: "arc",
        t0: from.angle / (Math.PI * 2),
        t1: from.angle / (Math.PI * 2) + sweep / (Math.PI * 2),
        start: startNode,
        end: endNode,
        midpoint: circlePoint(circle, from.angle + sweep / 2),
      };
      pieces.push(piece);
      sourcePieces.push(piece);
    }
    bySource.set(circle.id, sourcePieces);
  }

  return {
    sketch: {
      points: [...nodes].map(([id, point]) => ({ id, x: point[0], y: point[1] })),
      curves: splitCurves,
      constraints: [],
    },
    pieces,
    bySource,
    nodes,
    records: new Map(records.map((record) => [record.curve.id, record])),
    splitCircleIds,
  };

  function nodeForPoint(point: Vec2, preferredId?: string): string {
    const key = coordinateKey(point);
    let nodeId = nodeByKey.get(key);
    if (!nodeId) {
      nodeId = preferredId ?? `arr-${key}`;
      nodeByKey.set(key, nodeId);
    }
    if (!nodes.has(nodeId)) nodes.set(nodeId, point);
    return nodeId;
  }

  function resolveParams(record: CurveRecord, entries: ParamEntry[]): ResolvedParam[] {
    const resolved: ResolvedParam[] = [];
    for (const entry of [...entries].sort((a, b) => a.t - b.t)) {
      const t = clamp01(entry.t);
      const point = pointAt(record, t);
      const previous = resolved[resolved.length - 1];
      if (
        previous &&
        (Math.abs(previous.t - t) < PARAM_EPS ||
          distance(previous.point, point) < GEOM_EPS)
      ) {
        if (!previous.pointId && entry.pointId) previous.pointId = entry.pointId;
        continue;
      }
      resolved.push({ t, pointId: entry.pointId, point, nodeId: "" });
    }
    for (const entry of resolved) {
      const key = coordinateKey(entry.point);
      let nodeId = nodeByKey.get(key);
      if (!nodeId) {
        nodeId = entry.pointId ?? `arr-${key}`;
        nodeByKey.set(key, nodeId);
      }
      entry.nodeId = nodeId;
      if (!nodes.has(nodeId)) nodes.set(nodeId, entry.point);
    }
    return resolved;
  }
}

/** Position on a source line/arc at `t` in [0, 1]. */
export function pointAt(record: CurveRecord, t: number): Vec2 {
  if (record.kind === "line") {
    return [
      record.start[0] + (record.end[0] - record.start[0]) * t,
      record.start[1] + (record.end[1] - record.start[1]) * t,
    ];
  }
  const angle = record.geometry.startAngle + record.geometry.sweep * t;
  return [
    record.geometry.center[0] + Math.cos(angle) * record.geometry.radius,
    record.geometry.center[1] + Math.sin(angle) * record.geometry.radius,
  ];
}

/** Parameter of `point` on a line/arc, or null when it is not on the curve. */
export function curveParameterAtPoint(
  record: CurveRecord,
  point: Vec2,
): number | null {
  if (record.kind === "line") {
    const dx = record.end[0] - record.start[0];
    const dy = record.end[1] - record.start[1];
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared < 1e-18) return null;
    const t =
      ((point[0] - record.start[0]) * dx + (point[1] - record.start[1]) * dy) /
      lengthSquared;
    if (t < -PARAM_EPS || t > 1 + PARAM_EPS) return null;
    const projected: Vec2 = [
      record.start[0] + dx * t,
      record.start[1] + dy * t,
    ];
    return distance(projected, point) <= ON_CURVE_EPS ? clamp01(t) : null;
  }

  const center = record.geometry.center;
  const gap = distance(center, point);
  if (Math.abs(gap - record.geometry.radius) > ON_CURVE_EPS) return null;
  const angle = Math.atan2(point[1] - center[1], point[0] - center[0]);
  const offset = normalizeAngle(angle - record.geometry.startAngle);
  if (offset > record.geometry.sweep + PARAM_EPS) return null;
  return clamp01(offset / record.geometry.sweep);
}

/** Distance from a point to a split piece. Used to pick the trim target. */
export function pieceDistance(
  piece: PlanarPiece,
  curve: SketchLine | SketchArc,
  nodes: Map<string, Vec2>,
  point: Vec2,
): number {
  const start = nodes.get(piece.start);
  const end = nodes.get(piece.end);
  if (!start || !end) return Infinity;
  if (curve.type === "line") {
    return distanceToSegment(point, start, end);
  }
  const geometry = arcGeometry(curve, Object.fromEntries(nodes));
  if (!geometry) return Infinity;
  const angle = Math.atan2(point[1] - geometry.center[1], point[0] - geometry.center[0]);
  const offset = normalizeAngle(angle - geometry.startAngle);
  if (offset <= geometry.sweep) {
    return Math.abs(distance(geometry.center, point) - geometry.radius);
  }
  return Math.min(distance(point, start), distance(point, end));
}

function startId(record: CurveRecord): string {
  return record.kind === "line" ? record.curve.a : record.curve.start;
}

function endId(record: CurveRecord): string {
  return record.kind === "line" ? record.curve.b : record.curve.end;
}

interface CurveHit {
  ta: number;
  tb: number;
}

function intersectCurves(a: CurveRecord, b: CurveRecord): CurveHit[] {
  if (a.kind === "line" && b.kind === "line") {
    const hit = intersectLines(a.start, a.end, b.start, b.end);
    return hit ? [hit] : [];
  }
  if (a.kind === "line" && b.kind === "arc") {
    return intersectLineArc(a.start, a.end, b.geometry).map(({ t, arcT }) => ({
      ta: t,
      tb: arcT,
    }));
  }
  if (a.kind === "arc" && b.kind === "line") {
    return intersectLineArc(b.start, b.end, a.geometry).map(({ t, arcT }) => ({
      ta: arcT,
      tb: t,
    }));
  }
  if (a.kind === "arc" && b.kind === "arc") {
    return intersectArcs(a.geometry, b.geometry).map(({ a: ta, b: tb }) => ({
      ta,
      tb,
    }));
  }
  return [];
}

function intersectLines(
  a0: Vec2,
  a1: Vec2,
  b0: Vec2,
  b1: Vec2,
): CurveHit | null {
  const rx = a1[0] - a0[0];
  const ry = a1[1] - a0[1];
  const sx = b1[0] - b0[0];
  const sy = b1[1] - b0[1];
  const denominator = cross(rx, ry, sx, sy);
  if (Math.abs(denominator) < 1e-12) return null;
  const qx = b0[0] - a0[0];
  const qy = b0[1] - a0[1];
  const ta = cross(qx, qy, sx, sy) / denominator;
  const tb = cross(qx, qy, rx, ry) / denominator;
  if (ta < -PARAM_EPS || ta > 1 + PARAM_EPS) return null;
  if (tb < -PARAM_EPS || tb > 1 + PARAM_EPS) return null;
  return { ta: clamp01(ta), tb: clamp01(tb) };
}

interface LineArcHit {
  t: number;
  arcT: number;
}

function intersectLineArc(
  start: Vec2,
  end: Vec2,
  arc: ArcGeometry,
): LineArcHit[] {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const fx = start[0] - arc.center[0];
  const fy = start[1] - arc.center[1];
  const A = dx * dx + dy * dy;
  if (A < 1e-18) return [];
  const B = 2 * (fx * dx + fy * dy);
  const C = fx * fx + fy * fy - arc.radius * arc.radius;
  const discriminant = B * B - 4 * A * C;
  if (discriminant < -1e-12) return [];
  const root = Math.sqrt(Math.max(0, discriminant));
  const hits: LineArcHit[] = [];
  for (const t of [(-B - root) / (2 * A), (-B + root) / (2 * A)]) {
    if (t < -PARAM_EPS || t > 1 + PARAM_EPS) continue;
    const point: Vec2 = [start[0] + dx * t, start[1] + dy * t];
    const arcT = arcParameterAt(arc, point);
    if (arcT === null) continue;
    hits.push({ t: clamp01(t), arcT });
  }
  return hits;
}

function intersectArcs(
  a: ArcGeometry,
  b: ArcGeometry,
): { a: number; b: number }[] {
  const dx = b.center[0] - a.center[0];
  const dy = b.center[1] - a.center[1];
  const gap = Math.hypot(dx, dy);
  if (gap < 1e-12) return [];
  if (gap > a.radius + b.radius + GEOM_EPS) return [];
  if (gap < Math.abs(a.radius - b.radius) - GEOM_EPS) return [];
  const along = (a.radius * a.radius - b.radius * b.radius + gap * gap) / (2 * gap);
  const heightSquared = a.radius * a.radius - along * along;
  if (heightSquared < -GEOM_EPS) return [];
  const height = Math.sqrt(Math.max(0, heightSquared));
  const mx = a.center[0] + (dx * along) / gap;
  const my = a.center[1] + (dy * along) / gap;
  const ox = (-dy * height) / gap;
  const oy = (dx * height) / gap;
  const hits: { a: number; b: number }[] = [];
  for (const point of [
    [mx + ox, my + oy] as Vec2,
    [mx - ox, my - oy] as Vec2,
  ]) {
    const at = arcParameterAt(a, point);
    const bt = arcParameterAt(b, point);
    if (at === null || bt === null) continue;
    hits.push({ a: at, b: bt });
  }
  return hits;
}

interface CircleSplit {
  point: Vec2;
  angle: number;
}

function dedupeCircleSplits(
  circle: CircleRecord,
  points: readonly Vec2[],
): CircleSplit[] {
  const splits: CircleSplit[] = [];
  for (const point of points) {
    const angle = normalizeAngle(
      Math.atan2(point[1] - circle.center[1], point[0] - circle.center[0]),
    );
    if (splits.some((split) => angleDistance(split.angle, angle) < 1e-6)) {
      continue;
    }
    splits.push({ point: circlePoint(circle, angle), angle });
  }
  return splits.sort((a, b) => a.angle - b.angle);
}

function circlePoint(circle: CircleRecord, angle: number): Vec2 {
  return [
    circle.center[0] + Math.cos(angle) * circle.radius,
    circle.center[1] + Math.sin(angle) * circle.radius,
  ];
}

function angleDistance(a: number, b: number): number {
  const delta = Math.abs(normalizeAngle(a - b));
  return Math.min(delta, Math.PI * 2 - delta);
}

function intersectCircles(a: CircleRecord, b: CircleRecord): Vec2[] {
  const dx = b.center[0] - a.center[0];
  const dy = b.center[1] - a.center[1];
  const gap = Math.hypot(dx, dy);
  if (gap < 1e-12) return [];
  if (gap > a.radius + b.radius + GEOM_EPS) return [];
  if (gap < Math.abs(a.radius - b.radius) - GEOM_EPS) return [];
  const along =
    (a.radius * a.radius - b.radius * b.radius + gap * gap) / (2 * gap);
  const heightSquared = a.radius * a.radius - along * along;
  if (heightSquared < -GEOM_EPS) return [];
  const height = Math.sqrt(Math.max(0, heightSquared));
  const mx = a.center[0] + (dx * along) / gap;
  const my = a.center[1] + (dy * along) / gap;
  const ox = (-dy * height) / gap;
  const oy = (dx * height) / gap;
  return [
    [mx + ox, my + oy] as Vec2,
    [mx - ox, my - oy] as Vec2,
  ];
}

function intersectCurveCircle(record: CurveRecord, circle: CircleRecord): number[] {
  if (record.kind === "line") {
    const dx = record.end[0] - record.start[0];
    const dy = record.end[1] - record.start[1];
    const fx = record.start[0] - circle.center[0];
    const fy = record.start[1] - circle.center[1];
    const A = dx * dx + dy * dy;
    if (A < 1e-18) return [];
    const B = 2 * (fx * dx + fy * dy);
    const C = fx * fx + fy * fy - circle.radius * circle.radius;
    const discriminant = B * B - 4 * A * C;
    if (discriminant < -1e-12) return [];
    const root = Math.sqrt(Math.max(0, discriminant));
    return [(-B - root) / (2 * A), (-B + root) / (2 * A)]
      .filter((t) => t >= -PARAM_EPS && t <= 1 + PARAM_EPS)
      .map(clamp01);
  }

  const dx = circle.center[0] - record.geometry.center[0];
  const dy = circle.center[1] - record.geometry.center[1];
  const gap = Math.hypot(dx, dy);
  if (gap < 1e-12) return [];
  if (gap > record.geometry.radius + circle.radius + GEOM_EPS) return [];
  if (gap < Math.abs(record.geometry.radius - circle.radius) - GEOM_EPS) return [];
  const along =
    (record.geometry.radius * record.geometry.radius -
      circle.radius * circle.radius +
      gap * gap) /
    (2 * gap);
  const heightSquared = record.geometry.radius * record.geometry.radius - along * along;
  if (heightSquared < -GEOM_EPS) return [];
  const height = Math.sqrt(Math.max(0, heightSquared));
  const mx = record.geometry.center[0] + (dx * along) / gap;
  const my = record.geometry.center[1] + (dy * along) / gap;
  const ox = (-dy * height) / gap;
  const oy = (dx * height) / gap;
  return [
    [mx + ox, my + oy] as Vec2,
    [mx - ox, my - oy] as Vec2,
  ]
    .map((point) => arcParameterAt(record.geometry, point))
    .filter((t): t is number => t !== null);
}

function arcParameterAt(arc: ArcGeometry, point: Vec2): number | null {
  const gap = distance(arc.center, point);
  if (Math.abs(gap - arc.radius) > ON_CURVE_EPS) return null;
  const angle = Math.atan2(point[1] - arc.center[1], point[0] - arc.center[0]);
  const offset = normalizeAngle(angle - arc.startAngle);
  if (offset > arc.sweep + PARAM_EPS) return null;
  return clamp01(offset / arc.sweep);
}

function distanceToSegment(point: Vec2, start: Vec2, end: Vec2): number {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < 1e-18) return distance(point, start);
  const t = clamp01(
    ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared,
  );
  return distance(point, [start[0] + dx * t, start[1] + dy * t]);
}

function coordinateKey(point: Vec2): string {
  return `${quantize(point[0])}:${quantize(point[1])}`;
}

function quantize(value: number): number {
  const rounded = Math.round(value * KEY_SCALE);
  return rounded === 0 ? 0 : rounded;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function cross(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx;
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

export type { CurveRecord };
