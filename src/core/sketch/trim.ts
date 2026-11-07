import type { Vec2 } from "../types";
import { newId } from "./create";
import { deleteEntities, pruneSketch } from "./edit";
import {
  curveParameterAtPoint,
  pieceDistance,
  planarArrangement,
  pointAt,
  type CurveRecord,
  type PlanarArrangement,
  type PlanarPiece,
} from "./arrangement";
import {
  allCurves,
  type Sketch,
  type SketchArc,
  type SketchConstraint,
  type SketchCurve,
  type SketchLine,
} from "./types";

export interface TrimResult {
  sketch: Sketch;
  /** True when the click removed at least one segment. */
  removed: boolean;
  /** Constraints that could not be carried over to the trimmed geometry. */
  droppedConstraints: number;
}

const EPS = 1e-6;

/**
 * Trim the clicked line/arc segment between its neighbouring intersections or
 * boundaries. The document is only rewritten for the curve being trimmed; all
 * other curves stay exactly as drawn.
 */
export function trimCurveAt(
  sketch: Sketch,
  curveId: string,
  click: Vec2,
): TrimResult {
  const source = sketch.curves.find((curve) => curve.id === curveId);
  if (!source || source.type === "circle" || source.construction) {
    return { sketch, removed: false, droppedConstraints: 0 };
  }

  const arrangement = planarArrangement(sketch);
  const record = arrangement.records.get(curveId);
  const pieces = arrangement.bySource.get(curveId);
  if (!record || !pieces || pieces.length === 0) {
    return { sketch, removed: false, droppedConstraints: 0 };
  }

  const target = pickPiece(arrangement, source, pieces, click);
  if (!target) return { sketch, removed: false, droppedConstraints: 0 };

  // A single unsplit segment: trim removes the whole curve.
  if (target.t0 <= EPS && target.t1 >= 1 - EPS) {
    const next = deleteEntities(sketch, [curveId]);
    if (next === sketch) {
      return { sketch, removed: false, droppedConstraints: 0 };
    }
    return { sketch: next, removed: true, droppedConstraints: 0 };
  }

  const points = [...sketch.points];
  const cutStart =
    target.t0 > EPS
      ? resolveCutPoint(record, target.t0, target.start, sketch, points)
      : null;
  const cutEnd =
    target.t1 < 1 - EPS
      ? resolveCutPoint(record, target.t1, target.end, sketch, points)
      : null;

  const startPoint = record.kind === "line" ? record.curve.a : record.curve.start;
  const endPoint = record.kind === "line" ? record.curve.b : record.curve.end;

  const kept: { a: number; b: number; aId: string; bId: string }[] = [];
  if (target.t0 > EPS) {
    kept.push({
      a: 0,
      b: target.t0,
      aId: startPoint,
      bId: cutStart!.id,
    });
  }
  if (target.t1 < 1 - EPS) {
    kept.push({
      a: target.t1,
      b: 1,
      aId: cutEnd!.id,
      bId: endPoint,
    });
  }

  const newCurves: SketchCurve[] = [];
  for (const interval of kept) {
    if (interval.aId === interval.bId) continue;
    if (source.type === "line") {
      newCurves.push({
        id: newId("l"),
        type: "line",
        a: interval.aId,
        b: interval.bId,
      } satisfies SketchLine);
    } else {
      newCurves.push({
        id: newId("a"),
        type: "arc",
        center: source.center,
        start: interval.aId,
        end: interval.bId,
      } satisfies SketchArc);
    }
  }
  if (newCurves.length === 0) {
    return { sketch, removed: false, droppedConstraints: 0 };
  }

  const constraints: SketchConstraint[] = [];
  const primary = newCurves[0]!;
  let droppedConstraints = 0;

  for (const constraint of sketch.constraints) {
    const remapped = remapConstraint(constraint, curveId, primary, newCurves, sketch);
    if (remapped) constraints.push(remapped);
    else if (referencesCurve(constraint, curveId)) droppedConstraints += 1;
  }

  // Two kept line pieces must stay collinear. They share the cut point, so a
  // parallel constraint is exactly collinearity. Arcs need no extra constraint:
  // both pieces share their centre and an endpoint, and the arc entity enforces
  // equal radius within each piece.
  if (newCurves.length === 2) {
    const first = newCurves[0]!;
    const second = newCurves[1]!;
    if (first.type === "line" && second.type === "line") {
      constraints.push({
        id: newId("c"),
        type: "parallel",
        a: first.id,
        b: second.id,
      });
    } else if (first.type === "arc" && second.type === "arc") {
      // The pieces share a centre but not an endpoint. Keep both endpoints of
      // the second piece on the first piece's circle so the radii stay equal.
      for (const point of [second.start, second.end]) {
        constraints.push({
          id: newId("c"),
          type: "pointOnCircle",
          point,
          circle: first.id,
        });
      }
    }
  }

  // Cut points are real intersections. Keep them on the other curve(s) they
  // crossed, unless the point is already that curve's endpoint.
  for (const cut of [cutStart, cutEnd]) {
    if (!cut) continue;
    addIntersectionConstraints(
      constraints,
      sketch,
      arrangement,
      curveId,
      cut.id,
      cut.point,
    );
  }

  const curves = sketch.curves.flatMap((curve) =>
    curve.id === curveId ? newCurves : [curve],
  );
  const next = pruneSketch({ ...sketch, points, curves, constraints });

  return { sketch: next, removed: true, droppedConstraints };
}

function pickPiece(
  arrangement: PlanarArrangement,
  source: SketchLine | SketchArc,
  pieces: PlanarPiece[],
  click: Vec2,
): PlanarPiece | null {
  const record = arrangement.records.get(source.id);
  if (!record) return null;
  const clickT = curveParameterAtPoint(record, click);
  const splitCurveById = new Map(
    arrangement.sketch.curves.map((curve) => [curve.id, curve] as const),
  );

  const containing =
    clickT === null
      ? []
      : pieces.filter(
          (piece) => clickT >= piece.t0 - 1e-9 && clickT <= piece.t1 + 1e-9,
        );
  const candidates = containing.length > 0 ? containing : pieces;
  const split = (piece: PlanarPiece) => {
    const curve = splitCurveById.get(piece.id);
    return curve && curve.type !== "circle"
      ? pieceDistance(piece, curve, arrangement.nodes, click)
      : Infinity;
  };

  let best: PlanarPiece | null = null;
  let bestDistance = Infinity;
  for (const piece of candidates) {
    const distance = split(piece);
    if (distance < bestDistance - 1e-12) {
      best = piece;
      bestDistance = distance;
    }
  }
  return best;
}

interface CutPoint {
  id: string;
  point: Vec2;
}

function resolveCutPoint(
  record: CurveRecord,
  t: number,
  preferredId: string,
  sketch: Sketch,
  points: Sketch["points"],
): CutPoint {
  const point = pointAt(record, t);
  const preferred = sketch.points.find((candidate) => candidate.id === preferredId);
  if (preferred) return { id: preferred.id, point };

  const existing = sketch.points.find(
    (candidate) =>
      Math.hypot(candidate.x - point[0], candidate.y - point[1]) < 1e-5,
  );
  if (existing) return { id: existing.id, point };

  points.push({ id: preferredId, x: point[0], y: point[1] });
  return { id: preferredId, point };
}

function addIntersectionConstraints(
  constraints: SketchConstraint[],
  sketch: Sketch,
  arrangement: PlanarArrangement,
  sourceId: string,
  pointId: string,
  point: Vec2,
): void {
  const add = (type: "pointOnLine" | "pointOnCircle", target: string): void => {
    const duplicate = constraints.some((constraint) => {
      if (type === "pointOnLine" && constraint.type === "pointOnLine") {
        return constraint.point === pointId && constraint.line === target;
      }
      if (type === "pointOnCircle" && constraint.type === "pointOnCircle") {
        return constraint.point === pointId && constraint.circle === target;
      }
      return false;
    });
    if (duplicate) return;
    constraints.push(
      type === "pointOnLine"
        ? { id: newId("c"), type, point: pointId, line: target }
        : { id: newId("c"), type, point: pointId, circle: target },
    );
  };

  for (const record of arrangement.records.values()) {
    if (record.curve.id === sourceId) continue;
    const t = curveParameterAtPoint(record, point);
    if (t === null || t <= 1e-6 || t >= 1 - 1e-6) continue;
    if (record.kind === "line") add("pointOnLine", record.curve.id);
    else add("pointOnCircle", record.curve.id);
  }

  for (const curve of sketch.curves) {
    if (curve.type !== "circle") continue;
    const center = sketch.points.find((candidate) => candidate.id === curve.center);
    if (!center) continue;
    if (Math.abs(Math.hypot(point[0] - center.x, point[1] - center.y) - curve.radius) < 1e-5) {
      add("pointOnCircle", curve.id);
    }
  }
}

function referencesCurve(
  constraint: SketchConstraint,
  curveId: string,
): boolean {
  switch (constraint.type) {
    case "horizontal":
    case "vertical":
      return constraint.line === curveId;
    case "parallel":
    case "perpendicular":
    case "collinear":
    case "equal":
    case "angle":
    case "tangent":
      return constraint.a === curveId || constraint.b === curveId;
    case "symmetric":
      return constraint.about === curveId;
    case "pointOnLine":
    case "pointLineDistance":
      return constraint.line === curveId;
    case "pointOnCircle":
    case "diameter":
      return constraint.circle === curveId;
    case "midpoint":
      return constraint.line === curveId;
    case "coincident":
    case "distance":
    case "fix":
      return false;
  }
}

function remapConstraint(
  constraint: SketchConstraint,
  oldId: string,
  primary: SketchCurve,
  kept: SketchCurve[],
  sketch: Sketch,
): SketchConstraint | null {
  const primaryLine = primary.type === "line";
  const primaryCircle = primary.type !== "line";
  const other = (id: string) => (id === oldId ? primary.id : id);

  switch (constraint.type) {
    case "horizontal":
    case "vertical":
      if (constraint.line !== oldId) return constraint;
      return primaryLine ? { ...constraint, line: primary.id } : null;

    case "parallel":
    case "perpendicular":
    case "collinear":
      if (constraint.a !== oldId && constraint.b !== oldId) return constraint;
      if (!primaryLine) return null;
      if (
        !isLine(other(constraint.a), primary, sketch) ||
        !isLine(other(constraint.b), primary, sketch)
      ) {
        return null;
      }
      return { ...constraint, a: other(constraint.a), b: other(constraint.b) };

    case "equal":
      // Splitting changes the length/radius of either side; an equality
      // constraint can no longer describe the original curve.
      return constraint.a === oldId || constraint.b === oldId ? null : constraint;

    case "angle":
      if (constraint.a !== oldId && constraint.b !== oldId) return constraint;
      if (!primaryLine) return null;
      if (
        !isLine(other(constraint.a), primary, sketch) ||
        !isLine(other(constraint.b), primary, sketch)
      ) {
        return null;
      }
      return { ...constraint, a: other(constraint.a), b: other(constraint.b) };

    case "tangent":
      if (constraint.a !== oldId && constraint.b !== oldId) return constraint;
      return remapTangent(constraint, oldId, kept, sketch);

    case "symmetric":
      if (constraint.about !== oldId) return constraint;
      return primaryLine ? { ...constraint, about: primary.id } : null;

    case "pointOnLine":
    case "pointLineDistance":
      if (constraint.line !== oldId) return constraint;
      return primaryLine ? { ...constraint, line: primary.id } : null;

    case "pointOnCircle":
      if (constraint.circle !== oldId) return constraint;
      return primaryCircle ? { ...constraint, circle: primary.id } : null;

    case "midpoint":
      // The old midpoint is no longer a midpoint of a kept piece.
      return constraint.line === oldId ? null : constraint;

    case "diameter":
      if (constraint.circle !== oldId) return constraint;
      return primaryCircle ? { ...constraint, circle: primary.id } : null;

    case "coincident":
    case "distance":
    case "fix":
      return constraint;
  }
}

function remapTangent(
  constraint: Extract<SketchConstraint, { type: "tangent" }>,
  oldId: string,
  kept: SketchCurve[],
  sketch: Sketch,
): SketchConstraint | null {
  const oldArc = sketch.curves.find(
    (curve): curve is SketchArc => curve.type === "arc" && curve.id === constraint.a,
  );
  const oldLine = sketch.curves.find(
    (curve): curve is SketchLine => curve.type === "line" && curve.id === constraint.b,
  );
  if (!oldArc || !oldLine) return null;
  const shared = [oldArc.start, oldArc.end].find(
    (id) => id === oldLine.a || id === oldLine.b,
  );
  if (!shared) return null;

  const arcPiece = kept.find(
    (curve): curve is SketchArc =>
      curve.type === "arc" && (curve.start === shared || curve.end === shared),
  );
  const linePiece = kept.find(
    (curve): curve is SketchLine =>
      curve.type === "line" && (curve.a === shared || curve.b === shared),
  );
  if (constraint.a === oldId) {
    return arcPiece ? { ...constraint, a: arcPiece.id, b: oldLine.id } : null;
  }
  return linePiece ? { ...constraint, a: oldArc.id, b: linePiece.id } : null;
}

function isLine(id: string, primary: SketchCurve, sketch: Sketch): boolean {
  if (id === primary.id) return primary.type === "line";
  return allCurves(sketch).some((curve) => curve.id === id && curve.type === "line");
}
