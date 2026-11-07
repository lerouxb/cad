import { beforeAll, describe, expect, it } from "vitest";
import { addCircle, addPolyline, emptySketch } from "./create";
import {
  applicableConstraints,
  appliedConstraints,
  applyConstraint,
  constructionState,
  toggleConstruction,
} from "./constraints";
import { initSolver, solveDrag, solveSketch } from "./solver";
import type { Sketch } from "./types";

function twoLines(): Sketch {
  const first = addPolyline(
    emptySketch(),
    [{ point: [0, 0] }, { point: [40, 10] }],
    false,
  );
  return addPolyline(first, [{ point: [0, 20] }, { point: [40, 28] }], false);
}

function lineIds(sketch: Sketch): [string, string] {
  const ids = sketch.curves
    .filter((curve) => curve.type === "line")
    .map((curve) => curve.id);
  return [ids[0]!, ids[1]!];
}

describe("constraint applicability", () => {
  it("reports an applied horizontal constraint with its id", () => {
    const sketch = addPolyline(
      emptySketch(),
      [{ point: [0, 0] }, { point: [40, 0] }],
      false,
    );
    const line = sketch.curves[0]!;
    const applied = appliedConstraints(sketch, [line.id]);
    expect(applied).toHaveLength(1);
    expect(applied[0]).toMatchObject({
      type: "horizontal",
      applied: true,
      id: sketch.constraints[0]!.id,
    });
    expect(
      applicableConstraints(sketch, [line.id]).map((action) => action.type),
    ).toEqual(["horizontal", "vertical"]);
  });

  it("offers horizontal/vertical for one line", () => {
    const sketch = addPolyline(
      emptySketch(),
      [{ point: [0, 0] }, { point: [40, 10] }],
      false,
    );
    const types = applicableConstraints(sketch, [sketch.curves[0]!.id]).map(
      (action) => action.type,
    );

    expect(types).toEqual(["horizontal", "vertical"]);
  });

  it("offers parallel, perpendicular and equal for two lines", () => {
    const sketch = twoLines();
    const [a, b] = lineIds(sketch);
    const types = applicableConstraints(sketch, [a, b]).map((action) => action.type);

    expect(types).toEqual(["parallel", "perpendicular", "equal", "collinear"]);
  });

  it("offers equal for two circles", () => {
    const first = addCircle(emptySketch(), { point: [0, 0] }, 10);
    const sketch = addCircle(first, { point: [40, 0] }, 6);
    const ids = sketch.curves.map((curve) => curve.id);

    expect(applicableConstraints(sketch, ids).map((action) => action.type)).toEqual([
      "equal",
    ]);
  });

  it("offers point-on-line for a point and a line", () => {
    const sketch: Sketch = {
      points: [
        { id: "a", x: 0, y: 0 },
        { id: "b", x: 40, y: 0 },
        { id: "p", x: 20, y: 10 },
      ],
      curves: [{ id: "l", type: "line", a: "a", b: "b" }],
      constraints: [],
    };

    expect(
      applicableConstraints(sketch, ["p", "l"]).map((action) => action.type),
    ).toEqual(["pointOnLine", "midpoint"]);
  });

  it("keeps applied constraints visible and hides duplicate actions", () => {
    const sketch = twoLines();
    const [a, b] = lineIds(sketch);
    const withParallel = applyConstraint(sketch, "parallel", [a, b]);
    const actions = applicableConstraints(withParallel, [a, b]);

    expect(actions.map((action) => action.type)).toEqual([
      "parallel",
      "perpendicular",
      "equal",
      "collinear",
    ]);
    expect(
      actions.find((action) => action.type === "parallel"),
    ).toMatchObject({ applied: true });
  });
});

describe("applying constraints", () => {
  it("adds a parallel constraint exactly once", () => {
    const sketch = twoLines();
    const [a, b] = lineIds(sketch);
    const once = applyConstraint(sketch, "parallel", [a, b]);
    const twice = applyConstraint(once, "parallel", [b, a]);

    expect(once.constraints.filter((c) => c.type === "parallel")).toHaveLength(1);
    expect(twice).toBe(once);
  });

  it("adds equal for circles", () => {
    const first = addCircle(emptySketch(), { point: [0, 0] }, 10);
    const sketch = addCircle(first, { point: [40, 0] }, 6);
    const ids = sketch.curves.map((curve) => curve.id);
    const next = applyConstraint(sketch, "equal", ids);

    expect(next.constraints.find((c) => c.type === "equal")).toMatchObject({
      type: "equal",
      a: ids[0],
      b: ids[1],
    });
  });

  it("ignores inapplicable combinations", () => {
    const sketch = twoLines();
    const [a] = lineIds(sketch);
    expect(applyConstraint(sketch, "parallel", [a])).toBe(sketch);
    expect(applyConstraint(sketch, "pointOnLine", [a])).toBe(sketch);
  });
});

describe("collinear", () => {
  beforeAll(async () => {
    await initSolver();
  });

  function linePair(shared: boolean): Sketch {
    const first = addPolyline(
      emptySketch(),
      [{ point: [0, 0] }, { point: [40, 0] }],
      false,
    );
    return addPolyline(
      first,
      shared
        ? [{ point: [40, 0] }, { point: [80, 30] }]
        : [{ point: [20, 8] }, { point: [60, 14] }],
      false,
    );
  }

  function direction(sketch: Sketch, id: string): [number, number] {
    const curve = sketch.curves.find((candidate) => candidate.id === id);
    if (!curve || curve.type !== "line") throw new Error("missing line");
    const a = sketch.points.find((point) => point.id === curve.a)!;
    const b = sketch.points.find((point) => point.id === curve.b)!;
    return [b.x - a.x, b.y - a.y];
  }

  function assertCollinear(sketch: Sketch): void {
    const solved = solveSketch(sketch);
    expect(solved.ok).toBe(true);
    const applied: Sketch = {
      ...sketch,
      points: sketch.points.map((point) => ({
        ...point,
        ...(solved.points[point.id]
          ? { x: solved.points[point.id]![0], y: solved.points[point.id]![1] }
          : {}),
      })),
    };
    const [a, b] = lineIds(applied);
    const [ax, ay] = direction(applied, a);
    const [bx, by] = direction(applied, b);
    expect(ax * by - ay * bx).toBeCloseTo(0, 4);
    const lineA = applied.curves.find((curve) => curve.id === a);
    const lineB = applied.curves.find((curve) => curve.id === b);
    if (!lineA || lineA.type !== "line" || !lineB || lineB.type !== "line") {
      throw new Error("missing lines");
    }
    const origin = applied.points.find((point) => point.id === lineA.a)!;
    const end = applied.points.find((point) => point.id === lineA.b)!;
    const probe = applied.points.find((point) => point.id === lineB.a)!;
    const cross = (end.x - origin.x) * (probe.y - origin.y) -
      (end.y - origin.y) * (probe.x - origin.x);
    expect(cross).toBeCloseTo(0, 3);
  }

  it("applies one chip and disappears once active", () => {
    const sketch = linePair(false);
    const [a, b] = lineIds(sketch);
    const next = applyConstraint(sketch, "collinear", [a, b]);
    expect(next.constraints.filter((c) => c.type === "collinear")).toHaveLength(1);
    const actions = applicableConstraints(next, [a, b]);
    expect(actions.find((action) => action.type === "collinear")).toMatchObject({
      applied: true,
    });
    assertCollinear(next);
  });

  it("is exact for two lines that do not share an endpoint", () => {
    const sketch = linePair(false);
    const [a, b] = lineIds(sketch);
    const before = solveSketch(sketch);
    const after = solveSketch(applyConstraint(sketch, "collinear", [a, b]));
    // Parallel + point-on-line remove two DOF.
    expect(before.dof - after.dof).toBe(2);
    assertCollinear(applyConstraint(sketch, "collinear", [a, b]));
  });

  it("keeps the lines on one line while dragging", () => {
    const sketch = linePair(false);
    const [a, b] = lineIds(sketch);
    const withConstraint = applyConstraint(sketch, "collinear", [a, b]);
    const lineB = withConstraint.curves.find((curve) => curve.id === b);
    if (!lineB || lineB.type !== "line") throw new Error("missing line");
    const dragged = solveDrag(withConstraint, {
      pointId: lineB.a,
      x: 20,
      y: 30,
    });
    expect(dragged).not.toBeNull();
    const applied: Sketch = {
      ...withConstraint,
      points: withConstraint.points.map((point) => {
        const solved = dragged!.points[point.id];
        return solved ? { ...point, x: solved[0], y: solved[1] } : point;
      }),
    };
    const [ax, ay] = direction(applied, a);
    const [bx, by] = direction(applied, b);
    expect(ax * by - ay * bx).toBeCloseTo(0, 3);
    const lineA = applied.curves.find((curve) => curve.id === a);
    if (!lineA || lineA.type !== "line") throw new Error("missing line");
    const origin = applied.points.find((point) => point.id === lineA.a)!;
    const end = applied.points.find((point) => point.id === lineA.b)!;
    const probe = applied.points.find((point) => point.id === lineB.a)!;
    const cross =
      (end.x - origin.x) * (probe.y - origin.y) -
      (end.y - origin.y) * (probe.x - origin.x);
    expect(cross).toBeCloseTo(0, 2);
  });

  it("needs only parallelism when the lines share an endpoint", () => {
    const sketch = linePair(true);
    const [a, b] = lineIds(sketch);
    const before = solveSketch(sketch);
    const next = applyConstraint(sketch, "collinear", [a, b]);
    const after = solveSketch(next);
    expect(before.dof - after.dof).toBe(1);
    // The shared endpoint + parallel already mean collinear: no extra chip.
    expect(
      applicableConstraints(next, [a, b]).find(
        (action) => action.type === "collinear",
      ),
    ).toMatchObject({ applied: true });
    assertCollinear(next);
  });
});

describe("construction geometry", () => {
  it("toggles selected curves and reports state", () => {
    const sketch = twoLines();
    const [a, b] = lineIds(sketch);
    expect(constructionState(sketch, [a])).toBe("none");
    expect(constructionState(sketch, [])).toBeNull();

    const on = toggleConstruction(sketch, [a, b]);
    expect(constructionState(on, [a, b])).toBe("all");
    expect(on.curves.find((curve) => curve.id === a)?.construction).toBe(true);

    const off = toggleConstruction(on, [a]);
    expect(constructionState(off, [a])).toBe("none");
    expect(constructionState(off, [a, b])).toBe("mixed");
  });
});
