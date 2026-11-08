import type { Vec2 } from "../core/types";
import {
  allCurves,
  type Sketch,
  type SketchConstraint,
  type SketchCurve,
} from "../core/sketch/types";

/**
 * The derived mark layer for sketch constraints. See
 * `docs/showcase/CONSTRAINTS.md`.
 *
 * Nothing here is document state: the marks are recomputed from the sketch and
 * the solved geometry. Sizes are in sketch units, already multiplied by `px`
 * (sketch units per screen pixel), so the drawing stays screen-space constant.
 */

export type MarkStyle = "quiet" | "hover" | "active";

interface MarkBase {
  key: string;
  /** The constraint this mark belongs to. */
  id: string;
  type: ConstraintType;
  style: MarkStyle;
}

type ConstraintType = SketchConstraint["type"];

export type ConstraintMark =
  | (MarkBase & { kind: "badge"; x: number; y: number; label: string })
  | (MarkBase & {
      kind: "tick";
      x: number;
      y: number;
      /** Direction of the tick line, radians. */
      angle: number;
      count: number;
      /** Half-length in screen pixels; defaults to 4. */
      size?: number;
    })
  | (MarkBase & { kind: "ring"; x: number; y: number; r: number })
  | (MarkBase & { kind: "dot"; x: number; y: number; r: number })
  | (MarkBase & { kind: "halfDot"; x: number; y: number; r: number })
  | (MarkBase & {
      kind: "segment";
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      dashed?: boolean;
    })
  | (MarkBase & { kind: "path"; points: Vec2[]; closed?: boolean })
  | (MarkBase & { kind: "pin"; x: number; y: number })
  | (MarkBase & { kind: "chevron"; x: number; y: number; angle: number })
  | (MarkBase & { kind: "diamond"; x: number; y: number; r: number })
  | (MarkBase & {
      kind: "axis";
      x1: number;
      y1: number;
      x2: number;
      y2: number;
    });

export interface MarkContext {
  points: Record<string, Vec2>;
  selected: ReadonlySet<string>;
  hoveredCurveId: string | null;
  hoveredPointId: string | null;
  /** The constraint selected by its mark, if any. */
  selectedConstraintId?: string | null;
  /** The constraint whose mark is under the pointer. */
  hoveredConstraintId?: string | null;
  /** Sketch units per screen pixel. */
  px: number;
}

type LineCurve = Extract<SketchCurve, { type: "line" }>;
type ArcCurve = Extract<SketchCurve, { type: "arc" }>;

const MARK = 12;
const RING = 5.2;

function length(a: Vec2, b: Vec2): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

function midpoint(a: Vec2, b: Vec2): Vec2 {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

function at(a: Vec2, b: Vec2, t: number): Vec2 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function unit(dx: number, dy: number): Vec2 {
  const length = Math.hypot(dx, dy);
  return length > 1e-9 ? [dx / length, dy / length] : [1, 0];
}

function normal(a: Vec2, b: Vec2): Vec2 {
  const direction = unit(b[0] - a[0], b[1] - a[1]);
  return [-direction[1], direction[0]];
}

function dot(a: Vec2, b: Vec2): number {
  return a[0] * b[0] + a[1] * b[1];
}

/** Mostly a test seam: equal constraints group into one, two, ... ticks. */
export function equalGroupIndexes(sketch: Sketch): Map<string, number> {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    const up = parent.get(id);
    if (!up || up === id) {
      parent.set(id, id);
      return id;
    }
    const root = find(up);
    parent.set(id, root);
    return root;
  };
  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const constraint of sketch.constraints) {
    if (constraint.type === "equal") union(constraint.a, constraint.b);
  }
  const groupOfRoot = new Map<string, number>();
  const result = new Map<string, number>();
  for (const constraint of sketch.constraints) {
    if (constraint.type !== "equal") continue;
    const root = find(constraint.a);
    if (!groupOfRoot.has(root)) groupOfRoot.set(root, groupOfRoot.size + 1);
    result.set(constraint.id, groupOfRoot.get(root)!);
  }
  return result;
}

/**
 * Chevron tips for a symmetric pair. The connector runs between the two
 * participants; the chevrons sit on it, either side of where it crosses the
 * axis, and point back toward the axis. That is why a vertical axis gives
 * left/right chevrons and a horizontal axis gives up/down chevrons.
 *
 * Exported for orientation tests. `offset` is in sketch units.
 */
export function symmetricChevrons(
  a: Vec2,
  b: Vec2,
  axisA: Vec2,
  axisB: Vec2,
  offset = 6,
): { a: { x: number; y: number; angle: number }; b: { x: number; y: number; angle: number } } {
  const direction = unit(b[0] - a[0], b[1] - a[1]);
  const span = length(a, b);
  if (span < 1e-9) {
    return {
      a: { x: a[0], y: a[1], angle: 0 },
      b: { x: b[0], y: b[1], angle: Math.PI },
    };
  }
  const adx = axisB[0] - axisA[0];
  const ady = axisB[1] - axisA[1];
  // Cross the connector with the infinite axis. When they are parallel the
  // chevrons fall back to the connector midpoint.
  const denominator = direction[0] * ady - direction[1] * adx;
  let pivot = span / 2;
  if (Math.abs(denominator) > 1e-9) {
    const t =
      ((axisA[0] - a[0]) * ady - (axisA[1] - a[1]) * adx) / denominator;
    if (t > 0 && t < span) pivot = t;
  }
  const step = Math.min(offset, Math.max(1, span / 2 - 1));
  const from = Math.max(0.5, pivot - step);
  const to = Math.min(span - 0.5, pivot + step);
  return {
    a: {
      x: a[0] + direction[0] * from,
      y: a[1] + direction[1] * from,
      // Point toward the axis crossing (the +direction side).
      angle: Math.atan2(direction[1], direction[0]),
    },
    b: {
      x: a[0] + direction[0] * to,
      y: a[1] + direction[1] * to,
      // Point toward the axis crossing (the -direction side).
      angle: Math.atan2(-direction[1], -direction[0]),
    },
  };
}

/** The right-angle square when two lines actually meet on their segments. */
export function perpendicularCorner(
  lineA: LineCurve,
  lineB: LineCurve,
  points: Record<string, Vec2>,
  size: number,
): Vec2[] | null {
  const a1 = points[lineA.a];
  const a2 = points[lineA.b];
  const b1 = points[lineB.a];
  const b2 = points[lineB.b];
  if (!a1 || !a2 || !b1 || !b2) return null;
  const dax = a2[0] - a1[0];
  const day = a2[1] - a1[1];
  const dbx = b2[0] - b1[0];
  const dby = b2[1] - b1[1];
  const denominator = dax * dby - day * dbx;
  if (Math.abs(denominator) < 1e-9) return null;
  const ex = b1[0] - a1[0];
  const ey = b1[1] - a1[1];
  const t = (ex * dby - ey * dbx) / denominator;
  const u = (ex * day - ey * dax) / denominator;
  if (t < -1e-6 || t > 1 + 1e-6 || u < -1e-6 || u > 1 + 1e-6) {
    return null;
  }
  const corner: Vec2 = [a1[0] + dax * t, a1[1] + day * t];
  // Point each arm toward the longer remaining part of its segment.
  const arm = (from: Vec2, one: Vec2, two: Vec2): Vec2 => {
    const target = length(from, one) >= length(from, two) ? one : two;
    return unit(target[0] - from[0], target[1] - from[1]);
  };
  const ua = arm(corner, a1, a2);
  const ub = arm(corner, b1, b2);
  // The study draws an L-shaped right-angle mark offset from the corner, not a
  // closed square: the corner itself is the geometry, the mark sits inside it.
  return [
    [corner[0] + ua[0] * size, corner[1] + ua[1] * size],
    [
      corner[0] + (ua[0] + ub[0]) * size,
      corner[1] + (ua[1] + ub[1]) * size,
    ],
    [corner[0] + ub[0] * size, corner[1] + ub[1] * size],
  ];
}

/** The shared contact of a tangent line/arc pair, or null (fallback T badges). */
export function tangentContact(
  arc: ArcCurve,
  line: LineCurve,
  points: Record<string, Vec2>,
): Vec2 | null {
  const shared = [arc.start, arc.end].find(
    (id) => id === line.a || id === line.b,
  );
  return shared ? points[shared] ?? null : null;
}

/** The geometry a constraint links, for hover and selection highlighting. */
export function constraintParticipants(
  sketch: Sketch,
  constraintId: string,
): string[] {
  const constraint = sketch.constraints.find(
    (candidate) => candidate.id === constraintId,
  );
  if (!constraint) return [];
  switch (constraint.type) {
    case "horizontal":
    case "vertical":
      return [constraint.line];
    case "parallel":
    case "perpendicular":
    case "collinear":
    case "equal":
    case "tangent":
    case "coincident":
      return [constraint.a, constraint.b];
    case "pointOnLine":
    case "midpoint":
      return [constraint.point, constraint.line];
    case "pointOnCircle":
      return [constraint.point, constraint.circle];
    case "symmetric":
      return [constraint.a, constraint.b, constraint.about];
    case "fix":
      return [constraint.point];
    default:
      return [];
  }
}

/** "2 curves", "1 point + 1 curve", ... for the tooltip and popover. */
export function constraintParticipantSummary(
  sketch: Sketch,
  constraintId: string,
): string {
  const participants = constraintParticipants(sketch, constraintId);
  const curveIds = new Set([
    ...sketch.curves.map((curve) => curve.id),
    ...(sketch.references?.lines.map((line) => line.id) ?? []),
    ...(sketch.references?.circles?.map((circle) => circle.id) ?? []),
  ]);
  const curves = participants.filter((id) => curveIds.has(id)).length;
  const points = participants.length - curves;
  const parts: string[] = [];
  if (curves > 0) parts.push(`${curves} curve${curves === 1 ? "" : "s"}`);
  if (points > 0) parts.push(`${points} point${points === 1 ? "" : "s"}`);
  return parts.join(" + ") || "constraint";
}

export function constraintMarks(
  sketch: Sketch,
  context: MarkContext,
): ConstraintMark[] {
  const {
    points,
    hoveredCurveId,
    hoveredPointId,
    selectedConstraintId,
    hoveredConstraintId,
    px,
  } = context;
  // Reference axes participate in constraints (symmetric about X/Y,
  // point-on-line to an axis). Connector marks are non-interactive in the
  // renderer so an axis/symmetric tie cannot steal a geometry click.
  const curves = new Map(allCurves(sketch).map((curve) => [curve.id, curve]));
  const marks: ConstraintMark[] = [];
  type MarkDraft = ConstraintMark extends infer T
    ? T extends ConstraintMark
      ? Omit<T, "key"> & { key?: string }
      : never
    : never;
  const push = (mark: MarkDraft): void => {
    marks.push({
      ...mark,
      key: mark.key ?? `${mark.id}:${mark.kind}:${marks.length}`,
    } as ConstraintMark);
  };
  const styleFor = (ids: readonly string[]): MarkStyle => {
    // Selecting geometry does not restyle its constraints. Only the mark's
    // own selection (post-processed below) activates it; hovering a
    // participant is a preview.
    if (
      ids.some(
        (id) =>
          id === hoveredCurveId ||
          id === hoveredPointId,
      )
    ) {
      return "hover";
    }
    return "quiet";
  };
  const line = (id: string): LineCurve | null => {
    const curve = curves.get(id);
    return curve?.type === "line" ? curve : null;
  };
  const radiusOf = (curve: SketchCurve): number | null => {
    if (curve.type === "circle") return curve.radius;
    if (curve.type !== "arc") return null;
    const center = points[curve.center];
    const start = points[curve.start];
    return center && start ? length(center, start) : null;
  };
  const lineBase = (
    curve: LineCurve,
  ): { a: Vec2; b: Vec2; mid: Vec2; direction: Vec2; normal: Vec2 } | null => {
    const a = points[curve.a];
    const b = points[curve.b];
    if (!a || !b || length(a, b) < 1e-9) return null;
    return {
      a,
      b,
      mid: midpoint(a, b),
      direction: unit(b[0] - a[0], b[1] - a[1]),
      normal: normal(a, b),
    };
  };
  const outward = (
    point: Vec2,
    normalVector: Vec2,
    away: Vec2,
  ): Vec2 => {
    const side = dot(normalVector, [away[0] - point[0], away[1] - point[1]]);
    return side >= 0
      ? [point[0] - normalVector[0] * MARK * px, point[1] - normalVector[1] * MARK * px]
      : [point[0] + normalVector[0] * MARK * px, point[1] + normalVector[1] * MARK * px];
  };
  const badge = (
    id: string,
    type: ConstraintType,
    point: Vec2,
    label: string,
    style: MarkStyle,
  ): void => {
    push({
      kind: "badge",
      id,
      type,
      style,
      x: point[0],
      y: point[1],
      label,
    });
  };
  const statedPoint = (id: string): Vec2 | null => points[id] ?? null;

  const equalGroups = equalGroupIndexes(sketch);
  const activeAxes = new Map<string, string>();
  const drawnAxes = new Set<string>();

  for (const constraint of sketch.constraints) {
    switch (constraint.type) {
      case "horizontal":
      case "vertical": {
        const curve = line(constraint.line);
        const base = curve ? lineBase(curve) : null;
        if (!curve || !base) break;
        // A single-participant badge sits on the line at its midpoint; its
        // paper fill interrupts the line (CONSTRAINTS.md C21).
        const point = base.mid;
        badge(
          constraint.id,
          constraint.type,
          point,
          constraint.type === "horizontal" ? "H" : "V",
          styleFor([curve.id]),
        );
        break;
      }
      case "parallel": {
        const a = line(constraint.a);
        const b = line(constraint.b);
        const ba = a ? lineBase(a) : null;
        const bb = b ? lineBase(b) : null;
        if (!a || !b || !ba || !bb) break;
        const style = styleFor([a.id, b.id]);
        const p1 = outward(at(ba.a, ba.b, 0.7), ba.normal, bb.mid);
        const p2 = outward(at(bb.a, bb.b, 0.7), bb.normal, ba.mid);
        badge(constraint.id, constraint.type, p1, "∥", style);
        badge(constraint.id, constraint.type, p2, "∥", style);
        if (style !== "quiet") {
          push({
            kind: "segment",
            id: constraint.id,
            type: constraint.type,
            style,
            x1: ba.mid[0],
            y1: ba.mid[1],
            x2: bb.mid[0],
            y2: bb.mid[1],
            dashed: true,
          });
        }
        break;
      }
      case "perpendicular": {
        const a = line(constraint.a);
        const b = line(constraint.b);
        const ba = a ? lineBase(a) : null;
        const bb = b ? lineBase(b) : null;
        if (!a || !b || !ba || !bb) break;
        const style = styleFor([a.id, b.id]);
        const square = perpendicularCorner(a, b, points, MARK * px);
        if (square) {
          push({
            kind: "path",
            id: constraint.id,
            type: constraint.type,
            style,
            points: square,
          });
        } else {
          badge(
            constraint.id,
            constraint.type,
            outward(at(ba.a, ba.b, 0.55), ba.normal, bb.mid),
            "⊥",
            style,
          );
          badge(
            constraint.id,
            constraint.type,
            outward(at(bb.a, bb.b, 0.55), bb.normal, ba.mid),
            "⊥",
            style,
          );
          push({
            kind: "segment",
            id: constraint.id,
            type: constraint.type,
            style,
            x1: at(ba.a, ba.b, 0.55)[0],
            y1: at(ba.a, ba.b, 0.55)[1],
            x2: at(bb.a, bb.b, 0.55)[0],
            y2: at(bb.a, bb.b, 0.55)[1],
            dashed: true,
          });
        }
        break;
      }
      case "collinear": {
        const a = line(constraint.a);
        const b = line(constraint.b);
        const ba = a ? lineBase(a) : null;
        const bb = b ? lineBase(b) : null;
        if (!a || !b || !ba || !bb) break;
        const style = styleFor([a.id, b.id]);
        const shared = [a.a, a.b].find((id) => id === b.a || id === b.b);
        if (shared) {
          const p = statedPoint(shared);
          if (!p) break;
          badge(
            constraint.id,
            constraint.type,
            [
              p[0] + ba.normal[0] * MARK * px,
              p[1] + ba.normal[1] * MARK * px,
            ],
            "≡",
            style,
          );
          break;
        }
        const endsA = [ba.a, ba.b];
        const endsB = [bb.a, bb.b];
        let nearest: { a: Vec2; b: Vec2; distance: number } | null = null;
        for (const from of endsA) {
          for (const to of endsB) {
            const distance = length(from, to);
            if (!nearest || distance < nearest.distance) {
              nearest = { a: from, b: to, distance };
            }
          }
        }
        if (!nearest) break;
        const gapMid = midpoint(nearest.a, nearest.b);
        push({
          kind: "segment",
          id: constraint.id,
          type: constraint.type,
          style,
          x1: nearest.a[0],
          y1: nearest.a[1],
          x2: nearest.b[0],
          y2: nearest.b[1],
          dashed: true,
        });
        badge(
          constraint.id,
          constraint.type,
          [
            gapMid[0] + ba.normal[0] * MARK * px,
            gapMid[1] + ba.normal[1] * MARK * px,
          ],
          "≡",
          style,
        );
        break;
      }
      case "equal": {
        const count = equalGroups.get(constraint.id) ?? 1;
        const style = styleFor([constraint.a, constraint.b]);
        const addTicks = (curve: SketchCurve): void => {
          if (curve.type === "line") {
            const base = lineBase(curve);
            if (!base) return;
            const point = at(base.a, base.b, 0.3);
            push({
              kind: "tick",
              id: constraint.id,
              type: constraint.type,
              style,
              x: point[0],
              y: point[1],
              angle: Math.atan2(base.normal[1], base.normal[0]),
              count,
            });
            return;
          }
          if (curve.type === "circle" || curve.type === "arc") {
            const center = points[curve.center];
            const radius = radiusOf(curve);
            if (!center || radius === null) return;
            const point: Vec2 = [center[0], center[1] - radius];
            push({
              kind: "tick",
              id: constraint.id,
              type: constraint.type,
              style,
              x: point[0],
              y: point[1],
              angle: Math.PI / 2,
              count,
            });
          }
        };
        const a = curves.get(constraint.a);
        const b = curves.get(constraint.b);
        if (a) addTicks(a);
        if (b) addTicks(b);
        break;
      }
      case "pointOnLine": {
        const curve = line(constraint.line);
        const base = curve ? lineBase(curve) : null;
        const p = statedPoint(constraint.point);
        if (!curve || !base || !p) break;
        if (constraint.point === curve.a || constraint.point === curve.b) break;
        const style = styleFor([constraint.point, curve.id]);
        push({
          kind: "ring",
          id: constraint.id,
          type: constraint.type,
          style,
          x: p[0],
          y: p[1],
          r: RING * px,
        });
        push({
          kind: "tick",
          id: constraint.id,
          type: constraint.type,
          style,
          x: p[0],
          y: p[1],
          angle: Math.atan2(base.normal[1], base.normal[0]),
          count: 1,
          size: 7,
        });
        break;
      }
      case "pointOnCircle": {
        const curve = curves.get(constraint.circle);
        const center =
          curve && (curve.type === "circle" || curve.type === "arc")
            ? points[curve.center]
            : null;
        const p = statedPoint(constraint.point);
        if (!curve || !center || !p) break;
        const style = styleFor([constraint.point, curve.id]);
        push({
          kind: "ring",
          id: constraint.id,
          type: constraint.type,
          style,
          x: p[0],
          y: p[1],
          r: RING * px,
        });
        push({
          kind: "tick",
          id: constraint.id,
          type: constraint.type,
          style,
          x: p[0],
          y: p[1],
          angle: Math.atan2(p[1] - center[1], p[0] - center[0]),
          count: 1,
        });
        break;
      }
      case "tangent": {
        const a = curves.get(constraint.a);
        const b = curves.get(constraint.b);
        const arc =
          a?.type === "arc" ? a : b?.type === "arc" ? b : null;
        const curve =
          a?.type === "line" ? a : b?.type === "line" ? b : null;
        if (!arc || !curve || curve.type !== "line") break;
        const style = styleFor([arc.id, curve.id]);
        const contact = tangentContact(arc, curve, points);
        const base = lineBase(curve);
        if (contact && base) {
          push({
            kind: "diamond",
            id: constraint.id,
            type: constraint.type,
            style,
            x: contact[0],
            y: contact[1],
            r: 4.2 * px,
          });
          push({
            kind: "tick",
            id: constraint.id,
            type: constraint.type,
            style,
            x: contact[0],
            y: contact[1],
            angle: Math.atan2(base.direction[1], base.direction[0]),
            count: 1,
            size: 6,
          });
          break;
        }
        const arcMid = arcGeometryPoint(arc, points);
        if (arcMid) {
          badge(constraint.id, constraint.type, arcMid, "T", style);
        }
        if (base) {
          badge(constraint.id, constraint.type, base.mid, "T", style);
        }
        break;
      }
      case "symmetric": {
        const a = statedPoint(constraint.a);
        const b = statedPoint(constraint.b);
        const axis = line(constraint.about);
        const axisBase = axis ? lineBase(axis) : null;
        if (!a || !b || !axis || !axisBase) break;
        const style = styleFor([constraint.a, constraint.b, axis.id]);
        push({
          kind: "segment",
          id: constraint.id,
          type: constraint.type,
          style,
          x1: a[0],
          y1: a[1],
          x2: b[0],
          y2: b[1],
          dashed: true,
        });
        const chevrons = symmetricChevrons(
          a,
          b,
          axisBase.a,
          axisBase.b,
          6 * px,
        );
        push({
          kind: "chevron",
          id: constraint.id,
          type: constraint.type,
          style,
          x: chevrons.a.x,
          y: chevrons.a.y,
          angle: chevrons.a.angle,
        });
        push({
          kind: "chevron",
          id: constraint.id,
          type: constraint.type,
          style,
          x: chevrons.b.x,
          y: chevrons.b.y,
          angle: chevrons.b.angle,
        });
        if (
          (style !== "quiet" ||
            selectedConstraintId === constraint.id ||
            hoveredConstraintId === constraint.id) &&
          !activeAxes.has(axis.id)
        ) {
          activeAxes.set(axis.id, constraint.id);
        }
        break;
      }
      case "midpoint": {
        const curve = line(constraint.line);
        const base = curve ? lineBase(curve) : null;
        const p = statedPoint(constraint.point);
        if (!curve || !base || !p) break;
        const style = styleFor([constraint.point, curve.id]);
        push({
          kind: "tick",
          id: constraint.id,
          type: constraint.type,
          style,
          x: p[0],
          y: p[1],
          angle: Math.atan2(base.normal[1], base.normal[0]),
          count: 1,
          size: 6,
        });
        push({
          kind: "halfDot",
          id: constraint.id,
          type: constraint.type,
          style,
          x: p[0],
          y: p[1],
          r: 3.4 * px,
        });
        break;
      }
      case "coincident": {
        const a = statedPoint(constraint.a);
        if (!a || constraint.a === constraint.b) break;
        const style = styleFor([constraint.a, constraint.b]);
        push({
          kind: "ring",
          id: constraint.id,
          type: constraint.type,
          style,
          x: a[0],
          y: a[1],
          r: 6 * px,
        });
        push({
          kind: "dot",
          id: constraint.id,
          type: constraint.type,
          style,
          x: a[0],
          y: a[1],
          r: 3 * px,
        });
        break;
      }
      case "fix": {
        const p = statedPoint(constraint.point);
        if (!p) break;
        const style = styleFor([constraint.point]);
        // The pin sits above the point on a short stem, so the point stays the
        // visible evidence and the lock does not read as a filled dot.
        push({
          kind: "segment",
          id: constraint.id,
          type: constraint.type,
          style,
          x1: p[0],
          y1: p[1],
          x2: p[0],
          y2: p[1] - 9 * px,
        });
        push({
          kind: "pin",
          id: constraint.id,
          type: constraint.type,
          style,
          x: p[0],
          y: p[1] - 13 * px,
        });
        break;
      }
      default:
        break;
    }
  }

  for (const [axisId, constraintId] of activeAxes) {
    if (drawnAxes.has(axisId)) continue;
    drawnAxes.add(axisId);
    const axis = line(axisId);
    const base = axis ? lineBase(axis) : null;
    if (!axis || !base) continue;
    // Keep a reference axis from spanning the whole sketch: centre the visible
    // dash-dot segment on the pair.
    const pair: Vec2[] = [];
    for (const constraint of sketch.constraints) {
      if (
        constraint.type === "symmetric" &&
        constraint.about === axisId
      ) {
        const a = statedPoint(constraint.a);
        const b = statedPoint(constraint.b);
        if (a) pair.push(a);
        if (b) pair.push(b);
      }
    }
    let span = length(base.a, base.b);
    if (pair.length > 0) {
      const along = pair
        .map((point) => dot([point[0] - base.a[0], point[1] - base.a[1]], base.direction))
        .sort((a, b) => a - b);
      const pad = 24 * px;
      const from = along[0]! - pad;
      const to = along[along.length - 1]! + pad;
      span = Math.min(span, Math.max(to - from, pad * 2));
      const center = (from + to) / 2;
      push({
        kind: "axis",
        id: constraintId,
        type: "symmetric",
        style: "active",
        x1: base.a[0] + base.direction[0] * (center - span / 2),
        y1: base.a[1] + base.direction[1] * (center - span / 2),
        x2: base.a[0] + base.direction[0] * (center + span / 2),
        y2: base.a[1] + base.direction[1] * (center + span / 2),
      });
    } else {
      push({
        kind: "axis",
        id: constraintId,
        type: "symmetric",
        style: "active",
        x1: base.a[0],
        y1: base.a[1],
        x2: base.b[0],
        y2: base.b[1],
      });
    }
  }

  for (const mark of marks) {
    if (selectedConstraintId && mark.id === selectedConstraintId) {
      mark.style = "active";
    } else if (
      hoveredConstraintId &&
      mark.id === hoveredConstraintId &&
      mark.style !== "active"
    ) {
      mark.style = "hover";
    }
  }

  return marks;
}

function arcGeometryPoint(
  arc: ArcCurve,
  points: Record<string, Vec2>,
): Vec2 | null {
  const center = points[arc.center];
  const start = points[arc.start];
  const end = points[arc.end];
  if (!center || !start || !end) return null;
  const radius = length(center, start);
  const startAngle = Math.atan2(start[1] - center[1], start[0] - center[0]);
  const endAngle = Math.atan2(end[1] - center[1], end[0] - center[0]);
  let sweep = endAngle - startAngle;
  while (sweep <= 0) sweep += Math.PI * 2;
  const middle = startAngle + sweep / 2;
  return [
    center[0] + radius * Math.cos(middle),
    center[1] + radius * Math.sin(middle),
  ];
}
