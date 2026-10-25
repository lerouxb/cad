import { newId } from "./create";
import type { Sketch, SketchConstraint, SketchCurve, SketchPoint } from "./types";

export type ConstraintType =
  | "horizontal"
  | "vertical"
  | "parallel"
  | "perpendicular"
  | "equal"
  | "pointOnLine"
  | "coincident";

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
  coincident: "Coincident",
};

interface Selection {
  curves: SketchCurve[];
  lines: Extract<SketchCurve, { type: "line" }>[];
  circles: Extract<SketchCurve, { type: "circle" }>[];
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
  }
  if (selection.curves.length === 0 && selection.points.length === 2) {
    push("coincident");
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
  } else if (type === "coincident") {
    constraint = {
      id: newId("c"),
      type,
      a: selection.points[0]!.id,
      b: selection.points[1]!.id,
    };
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
    case "coincident":
      return selection.curves.length === 0 && selection.points.length === 2;
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
  if (type === "coincident" && selection.points.length === 2) {
    const [a, b] = [selection.points[0]!.id, selection.points[1]!.id];
    return sketch.constraints.some(
      (constraint) =>
        constraint.type === "coincident" &&
        ((constraint.a === a && constraint.b === b) ||
          (constraint.a === b && constraint.b === a)),
    );
  }
  return false;
}
