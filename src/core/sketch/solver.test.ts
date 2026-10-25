import { beforeAll, describe, expect, it } from "vitest";
import { addPolyline, emptySketch } from "./create";
import { applyConstraint } from "./constraints";
import { DEMO_DEFAULTS, createDemoModel } from "./demo";
import { applySolution, updateConstraintValue } from "./geometry";
import { initSolver, solveDrag, solveSketch, type SolveOutcome } from "./solver";
import type { Sketch } from "./types";
import type { Vec2 } from "../types";

function at(outcome: SolveOutcome, id: string): Vec2 {
  const point = outcome.points[id];
  if (!point) throw new Error(`No point "${id}" in solve result`);
  return point;
}

function radius(outcome: SolveOutcome, id: string): number {
  const value = outcome.radii[id];
  if (value === undefined) throw new Error(`No radius "${id}" in solve result`);
  return value;
}

describe("slvs adapter", () => {
  beforeAll(async () => {
    await initSolver();
  });

  it("solves the demo rectangle and reports its real in-plane DOF", () => {
    const { sketch } = createDemoModel();
    const outcome = solveSketch(sketch);

    expect(outcome.ok).toBe(true);
    expect(outcome.status).toBe("ok");
    // width + height are still free; translation/rotation are pinned by h/v
    // constraints and the fixed origin.
    expect(outcome.dof).toBe(2);
    expect(at(outcome, "p0")).toEqual([0, 0]);
    expect(at(outcome, "p1")).toEqual([60, 0]);
    expect(at(outcome, "p2")).toEqual([60, 40]);
  });

  it("becomes fully constrained when driving dimensions are added", () => {
    const { sketch } = createDemoModel({ ...DEMO_DEFAULTS, constrained: true });
    const outcome = solveSketch(sketch);

    expect(outcome.ok).toBe(true);
    expect(outcome.dof).toBe(0);
  });

  it("drives geometry from a dimension value", () => {
    const { sketch } = createDemoModel({ ...DEMO_DEFAULTS, constrained: true });
    const widened = updateConstraintValue(sketch, "dim-width", 85);
    const outcome = solveSketch(widened);

    expect(outcome.ok).toBe(true);
    expect(at(outcome, "p1")[0]).toBeCloseTo(85, 6);
    expect(at(outcome, "p1")[1]).toBeCloseTo(0, 6);
    expect(at(outcome, "p2")[0]).toBeCloseTo(85, 6);
    expect(at(outcome, "p2")[1]).toBeCloseTo(40, 6);
  });

  it("keeps the hole circular and driven by its diameter", () => {
    const { sketch } = createDemoModel({ ...DEMO_DEFAULTS, holeDiameter: 22 });
    const outcome = solveSketch(sketch);

    expect(outcome.ok).toBe(true);
    expect(radius(outcome, "hole")).toBeCloseTo(11, 6);
  });

  it("keeps a dragged corner rectangular instead of free-floating", () => {
    const { sketch } = createDemoModel();
    const outcome = solveDrag(sketch, { pointId: "p1", x: 75, y: 12 });

    expect(outcome).not.toBeNull();
    expect(outcome!.ok).toBe(true);
    expect(at(outcome!, "p1")[0]).toBeCloseTo(75, 5);
    // The bottom edge is horizontal, so the drag's y component is rejected.
    expect(at(outcome!, "p1")[1]).toBeCloseTo(0, 5);
    // The rectangle follows: p2 keeps the same x as p1.
    expect(at(outcome!, "p2")[0]).toBeCloseTo(75, 5);
    expect(outcome!.dof).toBe(2);
  });

  it("refuses to move a fully constrained sketch", () => {
    const { sketch } = createDemoModel({ ...DEMO_DEFAULTS, constrained: true });
    expect(solveDrag(sketch, { pointId: "p1", x: 100, y: 25 })).toBeNull();
  });

  it("slides a point along a circular constraint instead of rejecting the drag", () => {
    // A rod of length 50 anchored at the origin: the free end can only move on
    // a circle. A diagonal drag must become a tangential one.
    const pendulum: Sketch = {
      points: [
        { id: "origin", x: 0, y: 0, fixed: true },
        { id: "b", x: 50, y: 0 },
      ],
      curves: [],
      constraints: [{ id: "rod", type: "distance", a: "origin", b: "b", value: 50 }],
    };

    const outcome = solveDrag(pendulum, { pointId: "b", x: 60, y: 10 });

    expect(outcome).not.toBeNull();
    const b = at(outcome!, "b");
    expect(Math.hypot(b[0], b[1])).toBeCloseTo(50, 4);
    expect(b[1]).toBeGreaterThan(5);
    expect(b[0]).toBeLessThan(55);
  });

  it("treats reference dimensions as annotations, not constraints", () => {
    const pendulum: Sketch = {
      points: [
        { id: "origin", x: 0, y: 0, fixed: true },
        { id: "b", x: 50, y: 0 },
      ],
      curves: [],
      constraints: [
        { id: "ref", type: "distance", a: "origin", b: "b", value: 50, driving: false },
      ],
    };

    const solved = solveSketch(pendulum);
    expect(solved.dof).toBe(2);

    const dragged = solveDrag(pendulum, { pointId: "b", x: 60, y: 10 });
    expect(dragged).not.toBeNull();
    expect(at(dragged!, "b")[0]).toBeCloseTo(60, 4);
    expect(at(dragged!, "b")[1]).toBeCloseTo(10, 4);
  });

  it("solves parallel and perpendicular constraints", () => {
    const first = addPolyline(
      emptySketch(),
      [{ point: [0, 0] }, { point: [40, 0] }],
      false,
    );
    const sketch = addPolyline(first, [{ point: [0, 20] }, { point: [40, 28] }], false);
    const lines = sketch.curves.filter((curve) => curve.type === "line");
    const [a, b] = [lines[0]!, lines[1]!];

    const parallel = solveSketch(applyConstraint(sketch, "parallel", [a.id, b.id]));
    const direction = (line: typeof a, solved: typeof parallel) => {
      const p = at(solved, line.a);
      const q = at(solved, line.b);
      return [q[0] - p[0], q[1] - p[1]] as const;
    };
    const [pa, pb] = [direction(a, parallel), direction(b, parallel)];
    expect(pa[0] * pb[1] - pa[1] * pb[0]).toBeCloseTo(0, 5);

    const perpendicular = solveSketch(
      applyConstraint(sketch, "perpendicular", [a.id, b.id]),
    );
    const [qa, qb] = [direction(a, perpendicular), direction(b, perpendicular)];
    expect(qa[0] * qb[0] + qa[1] * qb[1]).toBeCloseTo(0, 4);
  });

  it("solves equal length and equal radius constraints", () => {
    const first = addPolyline(
      emptySketch(),
      [{ point: [0, 0] }, { point: [40, 0] }],
      false,
    );
    const lines = addPolyline(first, [{ point: [0, 20] }, { point: [70, 20] }], false);
    const [a, b] = lines.curves.filter((curve) => curve.type === "line");
    const solvedLines = solveSketch(applyConstraint(lines, "equal", [a!.id, b!.id]));
    const length = (line: typeof a, solved: typeof solvedLines) => {
      const p = at(solved, line!.a);
      const q = at(solved, line!.b);
      return Math.hypot(q[0] - p[0], q[1] - p[1]);
    };
    expect(length(a, solvedLines)).toBeCloseTo(length(b, solvedLines), 5);

    const circles: Sketch = {
      points: [
        { id: "c1", x: 0, y: 0 },
        { id: "c2", x: 60, y: 0 },
      ],
      curves: [
        { id: "o1", type: "circle", center: "c1", radius: 10 },
        { id: "o2", type: "circle", center: "c2", radius: 6 },
      ],
      constraints: [],
    };
    const solvedCircles = solveSketch(
      applyConstraint(circles, "equal", ["o1", "o2"]),
    );
    expect(solvedCircles.radii.o1).toBeCloseTo(solvedCircles.radii.o2!, 5);
  });

  it("keeps a point on a line, including while dragging", () => {
    const sketch: Sketch = {
      points: [
        { id: "a", x: 0, y: 0, fixed: true },
        { id: "b", x: 100, y: 0, fixed: true },
        { id: "p", x: 50, y: 0 },
      ],
      curves: [{ id: "l", type: "line", a: "a", b: "b" }],
      constraints: [],
    };
    const constrained = applyConstraint(sketch, "pointOnLine", ["p", "l"]);
    const solved = solveSketch(constrained);
    expect(at(solved, "p")[1]).toBeCloseTo(0, 6);

    const dragged = solveDrag(applySolution(constrained, solved), {
      pointId: "p",
      x: 70,
      y: 20,
    });
    expect(dragged).not.toBeNull();
    expect(at(dragged!, "p")[0]).toBeCloseTo(70, 1);
    expect(at(dragged!, "p")[1]).toBeCloseTo(0, 4);
  });

  it("keeps lines parallel while dragging an endpoint", () => {
    const first = addPolyline(
      emptySketch(),
      [{ point: [0, 0] }, { point: [40, 0] }],
      false,
    );
    const sketch = addPolyline(first, [{ point: [0, 20] }, { point: [40, 28] }], false);
    const lines = sketch.curves.filter((curve) => curve.type === "line");
    const [a, b] = [lines[0]!, lines[1]!];
    const constrained = applyConstraint(sketch, "parallel", [a.id, b.id]);
    const solved = solveSketch(constrained);
    const settled = applySolution(constrained, solved);

    const dragged = solveDrag(settled, { pointId: b.b, x: 40, y: 30 });
    expect(dragged).not.toBeNull();
    const p = at(dragged!, b.a);
    const q = at(dragged!, b.b);
    expect(q[1] - p[1]).toBeCloseTo(0, 3);
  });

  it("does not drag fixed reference geometry", () => {
    const pendulum: Sketch = {
      points: [{ id: "origin", x: 0, y: 0, fixed: true }],
      curves: [],
      constraints: [],
    };
    expect(solveDrag(pendulum, { pointId: "origin", x: 10, y: 10 })).toBeNull();
  });
});
