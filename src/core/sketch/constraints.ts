import { newId } from "./create";
import { allCurves, allPoints, type Sketch, type SketchArc, type SketchConstraint, type SketchCurve, type SketchPoint } from "./types";

export type ConstraintType =
  | "horizontal"
  | "vertical"
  | "parallel"
  | "perpendicular"
  | "collinear"
  | "equal"
  | "pointOnLine"
  | "pointOnCircle"
  | "tangent"
  | "symmetric"
  | "midpoint"
  | "coincident"
  | "fix";

export interface ConstraintAction {
  type: ConstraintType;
  label: string;
  /** Present for constraints already on the selected geometry. */
  id?: string;
  applied?: boolean;
}

export type ConstructionState = "none" | "mixed" | "all" | null;

const DIMENSION_LABELS: Record<string, string> = {
  distance: "Distance",
  pointLineDistance: "Point-line distance",
  diameter: "Diameter",
  angle: "Angle",
};

/** Human label for an applied constraint, shared by chips and mark selection. */
export function constraintLabel(type: SketchConstraint["type"]): string {
  return DIMENSION_LABELS[type] ?? LABELS[type as ConstraintType] ?? type;
}

const LABELS: Record<ConstraintType, string> = {
  horizontal: "Horizontal",
  vertical: "Vertical",
  parallel: "Parallel",
  perpendicular: "Perpendicular",
  collinear: "Collinear",
  equal: "Equal",
  pointOnLine: "Point on line",
  pointOnCircle: "Point on circle",
  tangent: "Tangent",
  symmetric: "Symmetric",
  midpoint: "Midpoint",
  coincident: "Coincident",
  fix: "Fix",
};

interface Selection {
  curves: SketchCurve[];
  lines: Extract<SketchCurve, { type: "line" }>[];
  circles: Extract<SketchCurve, { type: "circle" }>[];
  arcs: SketchArc[];
  points: SketchPoint[];
}

function isFreePoint(point: SketchPoint): boolean {
  return !point.fixed && !point.reference;
}

function isReferenceCurve(curve: SketchCurve): boolean {
  return curve.type === "line" && curve.reference === true;
}

function isProjectedLine(curve: SketchCurve): boolean {
  return curve.type === "line" && curve.projectionId !== undefined;
}

function isToggleableCurve(curve: SketchCurve): boolean {
  return !isReferenceCurve(curve) || isProjectedLine(curve);
}

function inspect(sketch: Sketch, ids: readonly string[]): Selection {
  const wanted = new Set(ids);
  const curves = allCurves(sketch).filter((curve) => wanted.has(curve.id));
  const points = allPoints(sketch).filter(
    (point) =>
      wanted.has(point.id) &&
      (!point.construction || point.projectionId !== undefined) &&
      (!point.fixed || point.reference),
  );
  return {
    curves,
    lines: curves.filter((curve) => curve.type === "line"),
    circles: curves.filter((curve) => curve.type === "circle"),
    arcs: curves.filter((curve): curve is SketchArc => curve.type === "arc"),
    points,
  };
}

/**
 * Which constraints make sense for the current selection? Only exact,
 * non-redundant combinations are offered; already-applied constraints are
 * hidden. Keeping this pure makes the floating constraint bar trivial.
 */
export function applicableConstraints(
  sketch: Sketch,
  ids: readonly string[],
): ConstraintAction[] {
  const selection = inspect(sketch, ids);
  const actions: ConstraintAction[] = appliedConstraints(sketch, ids);
  const push = (type: ConstraintType): void => {
    if (!hasConstraint(sketch, type, selection, ids)) {
      actions.push({ type, label: LABELS[type] });
    }
  };

  const line = selection.lines[0];
  const point = selection.points[0];
  if (
    selection.curves.length === 1 &&
    selection.lines.length === 1 &&
    selection.points.length === 0 &&
    !line?.reference
  ) {
    push("horizontal");
    push("vertical");
  }
  if (
    selection.curves.length === 2 &&
    selection.points.length === 0 &&
    selection.lines.length === 2 &&
    selection.lines.some((candidate) => !candidate.reference)
  ) {
    push("parallel");
    push("perpendicular");
    if (selection.lines.every((candidate) => !candidate.reference)) push("equal");
    if (selection.lines.some((candidate) => !candidate.reference)) {
      push("collinear");
    }
  }
  if (
    selection.curves.length === 2 &&
    selection.points.length === 0 &&
    selection.circles.length === 2
  ) {
    push("equal");
  }
  if (
    selection.curves.length === 1 &&
    selection.lines.length === 1 &&
    selection.points.length === 1 &&
    !(point?.fixed && line?.reference)
  ) {
    push("pointOnLine");
    if (
      point &&
      line &&
      isFreePoint(point) &&
      !line.reference &&
      point.id !== line.a &&
      point.id !== line.b
    ) {
      push("midpoint");
    }
  }
  if (
    selection.curves.length === 1 &&
    selection.circles.length + selection.arcs.length === 1 &&
    selection.points.length === 1
  ) {
    push("pointOnCircle");
  }
  if (
    selection.curves.length === 0 &&
    selection.points.length === 1 &&
    isFreePoint(selection.points[0]!)
  ) {
    push("fix");
  }
  if (
    selection.curves.length === 0 &&
    selection.points.length === 2 &&
    selection.points.some(isFreePoint)
  ) {
    push("coincident");
  }
  if (
    selection.curves.length === 3 &&
    selection.lines.length === 3 &&
    selection.points.length === 0 &&
    selection.lines.filter((line) => !line.reference).length >= 2
  ) {
    push("symmetric");
  }
  if (
    selection.curves.length === 1 &&
    selection.lines.length === 1 &&
    selection.points.length === 2
  ) {
    push("symmetric");
  }
  if (
    selection.curves.length === 2 &&
    selection.lines.length === 1 &&
    selection.arcs.length === 1 &&
    selection.points.length === 0 &&
    !selection.lines[0]?.reference
  ) {
    push("tangent");
  }
  return actions;
}

/**
 * Constraints already attached to exactly the selected entities. The selection
 * popover shows these as active chips; clicking one removes it, which is the
 * ordinary way to release an H/V or parallel constraint.
 */
export function appliedConstraints(
  sketch: Sketch,
  ids: readonly string[],
): ConstraintAction[] {
  const wanted = new Set(ids);
  const actions: ConstraintAction[] = [];
  for (const constraint of sketch.constraints) {
    if (isDimensionConstraint(constraint)) continue;
    let applies = false;
    switch (constraint.type) {
      case "horizontal":
      case "vertical":
        applies = wanted.has(constraint.line);
        break;
      case "parallel":
      case "perpendicular":
      case "collinear":
      case "equal":
      case "tangent":
      case "coincident":
        applies = wanted.has(constraint.a) && wanted.has(constraint.b);
        break;
      case "pointOnLine":
      case "midpoint":
        applies = wanted.has(constraint.point) && wanted.has(constraint.line);
        break;
      case "pointOnCircle":
        applies = wanted.has(constraint.point) && wanted.has(constraint.circle);
        break;
      case "symmetric":
        applies =
          wanted.has(constraint.a) &&
          wanted.has(constraint.b) &&
          wanted.has(constraint.about);
        break;
      case "fix":
        applies = wanted.has(constraint.point);
        break;
    }
    if (applies) {
      actions.push({
        id: constraint.id,
        type: constraint.type,
        label: LABELS[constraint.type],
        applied: true,
      });
    }
  }
  return actions;
}

function isDimensionConstraint(
  constraint: SketchConstraint,
): constraint is Extract<
  SketchConstraint,
  { type: "distance" | "pointLineDistance" | "diameter" | "angle" }
> {
  return (
    constraint.type === "distance" ||
    constraint.type === "pointLineDistance" ||
    constraint.type === "diameter" ||
    constraint.type === "angle"
  );
}

export function applyConstraint(
  sketch: Sketch,
  type: ConstraintType,
  ids: readonly string[],
): Sketch {
  const selection = inspect(sketch, ids);
  if (hasConstraint(sketch, type, selection, ids)) return sketch;
  if (!isApplicable(selection, type)) return sketch;

  let constraint: SketchConstraint | null = null;
  if (type === "horizontal" || type === "vertical") {
    if (selection.lines[0]!.reference) return sketch;
    constraint = { id: newId("c"), type, line: selection.lines[0]!.id };
  } else if (
    type === "parallel" ||
    type === "perpendicular" ||
    type === "collinear" ||
    type === "equal"
  ) {
    constraint = {
      id: newId("c"),
      type,
      a: selection.curves[0]!.id,
      b: selection.curves[1]!.id,
    };
  } else if (type === "pointOnLine") {
    constraint = {
      id: newId("c"),
      type,
      point: selection.points[0]!.id,
      line: selection.lines[0]!.id,
    };
  } else if (type === "pointOnCircle") {
    constraint = {
      id: newId("c"),
      type,
      point: selection.points[0]!.id,
      circle: selection.curves[0]!.id,
    };
  } else if (type === "midpoint") {
    constraint = {
      id: newId("c"),
      type,
      point: selection.points[0]!.id,
      line: selection.lines[0]!.id,
    };
  } else if (type === "coincident") {
    constraint = {
      id: newId("c"),
      type,
      a: selection.points[0]!.id,
      b: selection.points[1]!.id,
    };
  } else if (type === "fix") {
    constraint = { id: newId("c"), type, point: selection.points[0]!.id };
  } else if (type === "symmetric") {
    // Two edges + an axis become two point-pair symmetric constraints. The
    // axis is the selected reference line, otherwise the last selected line.
    const linePair = symmetricLinePair(sketch, selection, ids);
    if (linePair) {
      const additions = linePair.pairs
        .filter(
          ([a, b]) =>
            !sketch.constraints.some(
              (candidate) =>
                candidate.type === "symmetric" &&
                candidate.a === a &&
                candidate.b === b &&
                candidate.about === linePair.axis.id,
            ),
        )
        .map(([a, b]) => ({
          id: newId("c"),
          type: "symmetric" as const,
          a,
          b,
          about: linePair.axis.id,
        }));
      if (additions.length === 0) return sketch;
      return { ...sketch, constraints: [...sketch.constraints, ...additions] };
    }
    // Two points and the line/axis they mirror across.
    const about = selection.lines[0];
    const a = selection.points[0];
    const b = selection.points[1];
    if (!about || !a || !b) return sketch;
    constraint = { id: newId("c"), type, a: a.id, b: b.id, about: about.id };
  } else if (type === "tangent") {
    const arc = selection.arcs[0]!;
    const line = selection.lines[0]!;
    const shared = [arc.start, arc.end].find((id) => id === line.a || id === line.b);
    if (!shared) return sketch;
    constraint = { id: newId("c"), type, a: arc.id, b: line.id };
  }

  if (!constraint) return sketch;
  return { ...sketch, constraints: [...sketch.constraints, constraint] };
}

export function constructionState(
  sketch: Sketch,
  ids: readonly string[],
): ConstructionState {
  const wanted = new Set(ids);
  const curves = allCurves(sketch).filter(
    (curve) => wanted.has(curve.id) && isToggleableCurve(curve),
  );
  if (curves.length === 0) return null;
  const count = curves.filter((curve) => curve.construction).length;
  if (count === 0) return "none";
  return count === curves.length ? "all" : "mixed";
}

/** Toggle construction on the selected curves; all become construction if any are normal. */
export function toggleConstruction(sketch: Sketch, ids: readonly string[]): Sketch {
  const state = constructionState(sketch, ids);
  if (state === null) return sketch;
  const wanted = new Set(ids);
  const makeConstruction = state !== "all";
  return {
    ...sketch,
    curves: sketch.curves.map((curve) =>
      wanted.has(curve.id) && isToggleableCurve(curve)
        ? { ...curve, construction: makeConstruction }
        : curve,
    ),
    ...(sketch.references
      ? {
          references: {
            ...sketch.references,
            lines: sketch.references.lines.map((line) =>
              wanted.has(line.id) && line.projectionId !== undefined
                ? { ...line, construction: makeConstruction }
                : line,
            ),
            circles: (sketch.references.circles ?? []).map((circle) =>
              wanted.has(circle.id) && circle.projectionId !== undefined
                ? { ...circle, construction: makeConstruction }
                : circle,
            ),
          },
        }
      : {}),
  };
}

type SketchLine = Extract<SketchCurve, { type: "line" }>;

/**
 * Two edges + an axis: the axis is the selected reference line when there is
 * one, otherwise the last selected line. Reflecting one edge's endpoints maps
 * them onto the other edge's endpoints, which yields the two point pairs a
 * symmetric constraint can express.
 */
function symmetricLinePair(
  sketch: Sketch,
  selection: Selection,
  ids: readonly string[],
): { axis: SketchLine; pairs: Array<[string, string]> } | null {
  if (selection.lines.length !== 3) return null;
  const reference = selection.lines.find((line) => line.reference);
  const ordered = ids
    .map((id) => selection.lines.find((line) => line.id === id))
    .filter((line): line is SketchLine => Boolean(line));
  const axis =
    reference ?? ordered[ordered.length - 1] ?? selection.lines[selection.lines.length - 1];
  if (!axis) return null;
  const edges = selection.lines.filter((line) => line.id !== axis.id);
  if (edges.length !== 2) return null;
  const points = new Map(allPoints(sketch).map((point) => [point.id, point]));
  const axisA = points.get(axis.a);
  const axisB = points.get(axis.b);
  if (!axisA || !axisB) return null;
  const dx = axisB.x - axisA.x;
  const dy = axisB.y - axisA.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq < 1e-12) return null;
  const reflect = (point: SketchPoint): { x: number; y: number } => {
    const t = ((point.x - axisA.x) * dx + (point.y - axisA.y) * dy) / lengthSq;
    const foot = { x: axisA.x + t * dx, y: axisA.y + t * dy };
    return { x: 2 * foot.x - point.x, y: 2 * foot.y - point.y };
  };
  const endpoints = (line: SketchLine): SketchPoint[] =>
    [line.a, line.b]
      .map((id) => points.get(id))
      .filter((point): point is SketchPoint => Boolean(point));
  const [left, right] = edges;
  const leftPoints = endpoints(left!);
  const rightPoints = endpoints(right!);
  if (leftPoints.length !== 2 || rightPoints.length !== 2) return null;
  const used = new Set<string>();
  const pairs: Array<[string, string]> = [];
  for (const rightPoint of rightPoints) {
    const mirrored = reflect(rightPoint);
    let best: SketchPoint | null = null;
    let bestDistance = Infinity;
    for (const leftPoint of leftPoints) {
      if (used.has(leftPoint.id)) continue;
      const distance = Math.hypot(
        leftPoint.x - mirrored.x,
        leftPoint.y - mirrored.y,
      );
      if (distance < bestDistance) {
        bestDistance = distance;
        best = leftPoint;
      }
    }
    if (!best) return null;
    used.add(best.id);
    pairs.push([best.id, rightPoint.id]);
  }
  return pairs.length === 2 ? { axis, pairs } : null;
}

function isApplicable(selection: Selection, type: ConstraintType): boolean {
  switch (type) {
    case "horizontal":
    case "vertical":
      return (
        selection.curves.length === 1 &&
        selection.lines.length === 1 &&
        !selection.lines[0]?.reference
      );
    case "parallel":
    case "perpendicular":
    case "collinear":
      return (
        selection.curves.length === 2 &&
        selection.lines.length === 2 &&
        selection.lines.some((candidate) => !candidate.reference)
      );
    case "equal":
      return (
        selection.curves.length === 2 &&
        ((selection.lines.length === 2 &&
          selection.lines.every((candidate) => !candidate.reference)) ||
          selection.circles.length === 2)
      );
    case "pointOnLine": {
      const line = selection.lines[0];
      const point = selection.points[0];
      return (
        selection.curves.length === 1 &&
        selection.lines.length === 1 &&
        selection.points.length === 1 &&
        !(point?.fixed && line?.reference)
      );
    }
    case "pointOnCircle":
      return (
        selection.curves.length === 1 &&
        selection.circles.length + selection.arcs.length === 1 &&
        selection.points.length === 1
      );
    case "midpoint": {
      const point = selection.points[0];
      const line = selection.lines[0];
      return (
        selection.curves.length === 1 &&
        selection.lines.length === 1 &&
        selection.points.length === 1 &&
        Boolean(
          point &&
            line &&
            isFreePoint(point) &&
            !line.reference &&
            point.id !== line.a &&
            point.id !== line.b,
        )
      );
    }
    case "coincident":
      return (
        selection.curves.length === 0 &&
        selection.points.length === 2 &&
        selection.points.some(isFreePoint)
      );
    case "fix":
      return (
        selection.curves.length === 0 &&
        selection.points.length === 1 &&
        isFreePoint(selection.points[0]!)
      );
    case "symmetric":
      if (
        selection.curves.length === 3 &&
        selection.lines.length === 3 &&
        selection.points.length === 0
      ) {
        return selection.lines.filter((line) => !line.reference).length >= 2;
      }
      return (
        selection.curves.length === 1 &&
        selection.lines.length === 1 &&
        selection.points.length === 2
      );
    case "tangent":
      return (
        selection.curves.length === 2 &&
        selection.lines.length === 1 &&
        selection.arcs.length === 1 &&
        selection.points.length === 0 &&
        !selection.lines[0]?.reference
      );
  }
}

function hasConstraint(
  sketch: Sketch,
  type: ConstraintType,
  selection: Selection,
  ids: readonly string[] = [],
): boolean {
  if ((type === "horizontal" || type === "vertical") && selection.lines[0]) {
    return sketch.constraints.some(
      (constraint) =>
        constraint.type === type && constraint.line === selection.lines[0]!.id,
    );
  }
  if (
    (type === "parallel" ||
      type === "perpendicular" ||
      type === "collinear" ||
      type === "equal") &&
    selection.curves.length === 2
  ) {
    const [a, b] = [selection.curves[0]!.id, selection.curves[1]!.id];
    const existing = sketch.constraints.some(
      (constraint) =>
        (constraint.type === type ||
          // Collinear already implies parallel, so do not offer a redundant
          // parallel chip on top of it.
          (type === "parallel" && constraint.type === "collinear")) &&
        ((constraint.a === a && constraint.b === b) ||
          (constraint.a === b && constraint.b === a)),
    );
    if (existing) return true;
    // Parallel lines that already share an endpoint are collinear; offering a
    // second chip would only add a redundant constraint.
    if (type === "collinear" && selection.lines.length === 2) {
      const [lineA, lineB] = selection.lines;
      const shared = [lineA!.a, lineA!.b].some(
        (point) => point === lineB!.a || point === lineB!.b,
      );
      return (
        shared &&
        sketch.constraints.some(
          (constraint) =>
            constraint.type === "parallel" &&
            ((constraint.a === a && constraint.b === b) ||
              (constraint.a === b && constraint.b === a)),
        )
      );
    }
  }
  if (type === "pointOnLine" && selection.points[0] && selection.lines[0]) {
    return sketch.constraints.some(
      (constraint) =>
        constraint.type === "pointOnLine" &&
        constraint.point === selection.points[0]!.id &&
        constraint.line === selection.lines[0]!.id,
    );
  }
  if (type === "pointOnCircle" && selection.points[0] && selection.curves[0]) {
    return sketch.constraints.some(
      (constraint) =>
        constraint.type === "pointOnCircle" &&
        constraint.point === selection.points[0]!.id &&
        constraint.circle === selection.curves[0]!.id,
    );
  }
  if (type === "midpoint" && selection.points[0] && selection.lines[0]) {
    return sketch.constraints.some(
      (constraint) =>
        constraint.type === "midpoint" &&
        constraint.point === selection.points[0]!.id &&
        constraint.line === selection.lines[0]!.id,
    );
  }
  if (type === "coincident" && selection.points.length === 2) {
    const [a, b] = [selection.points[0]!.id, selection.points[1]!.id];
    return sketch.constraints.some(
      (constraint) =>
        constraint.type === "coincident" &&
        ((constraint.a === a && constraint.b === b) ||
          (constraint.a === b && constraint.b === a)),
    );
  }
  if (type === "fix" && selection.points[0]) {
    return sketch.constraints.some(
      (constraint) =>
        constraint.type === "fix" && constraint.point === selection.points[0]!.id,
    );
  }
  if (type === "symmetric" && selection.lines.length === 3) {
    const linePair = symmetricLinePair(sketch, selection, ids);
    if (!linePair) return false;
    return linePair.pairs.every(([a, b]) =>
      sketch.constraints.some(
        (constraint) =>
          constraint.type === "symmetric" &&
          constraint.a === a &&
          constraint.b === b &&
          constraint.about === linePair.axis.id,
      ),
    );
  }
  if (type === "symmetric" && selection.points.length === 2 && selection.lines[0]) {
    const [a, b] = [selection.points[0]!.id, selection.points[1]!.id];
    return sketch.constraints.some(
      (constraint) =>
        constraint.type === "symmetric" &&
        ((constraint.a === a && constraint.b === b) ||
          (constraint.a === b && constraint.b === a)) &&
        constraint.about === selection.lines[0]!.id,
    );
  }
  if (type === "tangent" && selection.arcs[0] && selection.lines[0]) {
    const arc = selection.arcs[0].id;
    const line = selection.lines[0].id;
    return sketch.constraints.some(
      (constraint) =>
        constraint.type === "tangent" &&
        ((constraint.a === arc && constraint.b === line) ||
          (constraint.a === line && constraint.b === arc)),
    );
  }
  return false;
}
