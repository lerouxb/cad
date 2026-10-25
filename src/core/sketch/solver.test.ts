import { beforeAll, describe, expect, it } from "vitest";
import { DEMO_DEFAULTS, createDemoModel } from "./demo";
import { updateConstraintValue } from "./geometry";
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

  it("does not drag fixed reference geometry", () => {
    const pendulum: Sketch = {
      points: [{ id: "origin", x: 0, y: 0, fixed: true }],
      curves: [],
      constraints: [],
    };
    expect(solveDrag(pendulum, { pointId: "origin", x: 10, y: 10 })).toBeNull();
  });
});
