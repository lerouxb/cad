import { newId } from "./create";
import type { Sketch, SketchArc, SketchConstraint, SketchCurve, SketchPoint } from "./types";

export type ConstraintType =
  | "horizontal"
  | "vertical"
  | "parallel"
  | "perpendicular"
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
}

export type ConstructionState = "none" | "mixed" | "all" | null;

const LABELS: Record<ConstraintType, string> = {
  horizontal: "Horizontal",
  vertical: "Vertical",
  parallel: "Parallel",
  perpendicular: "Perpendicular",
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

function inspect(sketch: Sketch, ids: readonly string[]): Selection {
  const wanted = new Set(ids);
  const curves = sketch.curves.filter((curve) => wanted.has(curve.id));
  const points = sketch.points.filter(
    (point) => wanted.has(point.id) && !point.fixed && !point.construction,
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
  const actions: ConstraintAction[] = [];
  const push = (type: ConstraintType): void => {
    if (!hasConstraint(sketch, type, selection)) {
      actions.push({ type, label: LABELS[type] });
    }
  };

  if (
    selection.curves.length === 1 &&
    selection.lines.length === 1 &&
    selection.points.length === 0
  ) {
    push("horizontal");
    push("vertical");
  }
  if (
    selection.curves.length === 2 &&
    selection.points.length === 0 &&
    selection.lines.length === 2
  ) {
    push("parallel");
    push("perpendicular");
    push("equal");
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
    selection.points.length === 1
  ) {
    push("pointOnLine");
    const point = selection.points[0]!;
    const line = selection.lines[0]!;
    if (point.id !== line.a && point.id !== line.b) push("midpoint");
  }
  if (
    selection.curves.length === 1 &&
    selection.circles.length + selection.arcs.length === 1 &&
    selection.points.length === 1
  ) {
    push("pointOnCircle");
  }
  if (selection.curves.length === 0 && selection.points.length === 1) {
    push("fix");
  }
  if (selection.curves.length === 0 && selection.points.length === 2) {
    push("coincident");
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
    selection.points.length === 0
  ) {
    push("tangent");
  }
  return actions;
}

export function applyConstraint(
  sketch: Sketch,
  type: ConstraintType,
  ids: readonly string[],
): Sketch {
  const selection = inspect(sketch, ids);
  if (hasConstraint(sketch, type, selection)) return sketch;
  if (!isApplicable(selection, type)) return sketch;

  let constraint: SketchConstraint | null = null;
  if (type === "horizontal" || type === "vertical") {
    constraint = { id: newId("c"), type, line: selection.lines[0]!.id };
  } else if (type === "parallel" || type === "perpendicular" || type === "equal") {
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
  const curves = sketch.curves.filter((curve) => wanted.has(curve.id));
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
      wanted.has(curve.id) ? { ...curve, construction: makeConstruction } : curve,
    ),
  };
}

function isApplicable(selection: Selection, type: ConstraintType): boolean {
  switch (type) {
    case "horizontal":
    case "vertical":
      return selection.curves.length === 1 && selection.lines.length === 1;
    case "parallel":
    case "perpendicular":
      return selection.curves.length === 2 && selection.lines.length === 2;
    case "equal":
      return (
        selection.curves.length === 2 &&
        (selection.lines.length === 2 || selection.circles.length === 2)
      );
    case "pointOnLine":
      return (
        selection.curves.length === 1 &&
        selection.lines.length === 1 &&
        selection.points.length === 1
      );
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
        Boolean(point && line && point.id !== line.a && point.id !== line.b)
      );
    }
    case "coincident":
      return selection.curves.length === 0 && selection.points.length === 2;
    case "fix":
      return selection.curves.length === 0 && selection.points.length === 1;
    case "symmetric":
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
        selection.points.length === 0
      );
  }
}

function hasConstraint(sketch: Sketch, type: ConstraintType, selection: Selection): boolean {
  if ((type === "horizontal" || type === "vertical") && selection.lines[0]) {
    return sketch.constraints.some(
      (constraint) =>
        constraint.type === type && constraint.line === selection.lines[0]!.id,
    );
  }
  if (
    (type === "parallel" || type === "perpendicular" || type === "equal") &&
    selection.curves.length === 2
  ) {
    const [a, b] = [selection.curves[0]!.id, selection.curves[1]!.id];
    return sketch.constraints.some(
      (constraint) =>
        constraint.type === type &&
        ((constraint.a === a && constraint.b === b) ||
          (constraint.a === b && constraint.b === a)),
    );
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
