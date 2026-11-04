import { beforeAll, describe, expect, it } from "vitest";
import { addCircle, addPolyline, emptySketch } from "./create";
import { applicableConstraints, applyConstraint } from "./constraints";
import {
  addDimension,
  setDimensionPlacement,
  setDimensionValue,
} from "./dimensions";
import { applySolution, distance } from "./geometry";
import { initSolver, solveDrag, solveSketch } from "./solver";
import type { Sketch } from "./types";

function point(sketch: Sketch, id: string) {
  const found = sketch.points.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`missing point ${id}`);
  return found;
}

function line(sketch: Sketch, id: string) {
  const found = sketch.curves.find(
    (candidate): candidate is Extract<typeof candidate, { type: "line" }> =>
      candidate.id === id && candidate.type === "line",
  );
  if (!found) throw new Error(`missing line ${id}`);
  return found;
}

function angleBetween(sketch: Sketch, a: string, b: string): number {
  const lineA = line(sketch, a);
  const lineB = line(sketch, b);
  const a1 = point(sketch, lineA.a);
  const a2 = point(sketch, lineA.b);
  const b1 = point(sketch, lineB.a);
  const b2 = point(sketch, lineB.b);
  const dax = a2.x - a1.x;
  const day = a2.y - a1.y;
  const dbx = b2.x - b1.x;
  const dby = b2.y - b1.y;
  return (Math.abs(Math.atan2(dax * dby - day * dbx, dax * dbx + day * dby)) * 180) / Math.PI;
}

describe("M1 constraints", () => {
  beforeAll(async () => {
    await initSolver();
  });

  it("offers and solves a point-on-circle constraint", () => {
    const withCircle = addCircle(emptySketch(), { point: [0, 0] }, 10);
    const sketch: Sketch = withCircle;
    // Fix the centre so the solver cannot translate the whole circle.
    const center = sketch.points.find(
      (p) => withCircle.curves[0]!.type === "circle" && p.id === withCircle.curves[0]!.center,
    )!;
    center.fixed = true;
    const p = { id: "p", x: 14, y: 4 };
    const withPoint: Sketch = { ...sketch, points: [...sketch.points, p] };
    const circle = withPoint.curves[0]!;
    if (circle.type !== "circle") throw new Error("expected a circle");

    expect(
      applicableConstraints(withPoint, ["p", circle.id]).map((a) => a.type),
    ).toContain("pointOnCircle");
    const constrained = applyConstraint(withPoint, "pointOnCircle", ["p", circle.id]);
    const solved = solveSketch(constrained);
    expect(solved.ok).toBe(true);
    expect(distance(solved.points.p!, solved.points[circle.center]!)).toBeCloseTo(10, 4);

    const settled = applySolution(constrained, solved);
    const dragged = solveDrag(settled, { pointId: "p", x: 2, y: 18 });
    expect(dragged).not.toBeNull();
    expect(
      distance(dragged!.points.p!, dragged!.points[circle.center]!),
    ).toBeCloseTo(10, 3);
  });

  it("solves symmetric points about a line", () => {
    const sketch: Sketch = {
      points: [
        { id: "axis-a", x: 0, y: -50, fixed: true },
        { id: "axis-b", x: 0, y: 50, fixed: true },
        { id: "a", x: -10, y: 10 },
        { id: "b", x: 15, y: 20 },
      ],
      curves: [{ id: "axis", type: "line", a: "axis-a", b: "axis-b" }],
      constraints: [],
    };
    expect(applicableConstraints(sketch, ["a", "b", "axis"]).map((a) => a.type)).toEqual([
      "symmetric",
    ]);
    const constrained = applyConstraint(sketch, "symmetric", ["a", "b", "axis"]);
    const solved = solveSketch(constrained);
    expect(solved.ok).toBe(true);
    expect((solved.points.a![0] + solved.points.b![0]) / 2).toBeCloseTo(0, 4);
    expect(solved.points.a![1]).toBeCloseTo(solved.points.b![1], 4);

    const settled = applySolution(constrained, solved);
    const dragged = solveDrag(settled, { pointId: "a", x: -20, y: 18 });
    expect(dragged).not.toBeNull();
    expect((dragged!.points.a![0] + dragged!.points.b![0]) / 2).toBeCloseTo(0, 3);
    expect(dragged!.points.a![1]).toBeCloseTo(dragged!.points.b![1], 3);
  });

  it("solves two edges symmetric about the Y axis", () => {
    const sketch: Sketch = {
      ...emptySketch(),
      points: [
        { id: "lt", x: -20, y: 10 },
        { id: "lb", x: -20, y: -10 },
        { id: "rt", x: 12, y: 10 },
        { id: "rb", x: 12, y: -10 },
      ],
      curves: [
        { id: "left", type: "line", a: "lt", b: "lb" },
        { id: "right", type: "line", a: "rt", b: "rb" },
      ],
      constraints: [],
    };
    const ids = ["left", "right", "axis-y"];
    expect(applicableConstraints(sketch, ids).map((a) => a.type)).toContain(
      "symmetric",
    );
    const constrained = applyConstraint(sketch, "symmetric", ids);
    const pairs = constrained.constraints.filter(
      (constraint) => constraint.type === "symmetric",
    );
    expect(pairs).toHaveLength(2);
    const solved = solveSketch(constrained);
    expect(solved.ok).toBe(true);
    for (const constraint of pairs) {
      if (constraint.type !== "symmetric") continue;
      const a = solved.points[constraint.a]!;
      const b = solved.points[constraint.b]!;
      expect((a[0] + b[0]) / 2).toBeCloseTo(0, 4);
      expect(a[1]).toBeCloseTo(b[1], 4);
    }
    expect(applicableConstraints(constrained, ids).map((a) => a.type)).not.toContain(
      "symmetric",
    );
  });

  it("solves a midpoint constraint", () => {
    const sketch: Sketch = {
      points: [
        { id: "a", x: 0, y: 0, fixed: true },
        { id: "b", x: 40, y: 20, fixed: true },
        { id: "m", x: 10, y: 10 },
      ],
      curves: [{ id: "line", type: "line", a: "a", b: "b" }],
      constraints: [],
    };
    expect(applicableConstraints(sketch, ["m", "line"]).map((a) => a.type)).toContain(
      "midpoint",
    );
    const constrained = applyConstraint(sketch, "midpoint", ["m", "line"]);
    const solved = solveSketch(constrained);
    expect(solved.ok).toBe(true);
    expect(solved.points.m![0]).toBeCloseTo(20, 4);
    expect(solved.points.m![1]).toBeCloseTo(10, 4);

    // The endpoints are fixed, so the midpoint cannot move.
    const settled = applySolution(constrained, solved);
    expect(solveDrag(settled, { pointId: "m", x: 25, y: 15 })).toBeNull();
  });

  it("fixes a point and refuses to drag it", () => {
    const sketch: Sketch = {
      points: [{ id: "p", x: 12, y: 34 }],
      curves: [],
      constraints: [],
    };
    const fixed = applyConstraint(sketch, "fix", ["p"]);
    const solved = solveSketch(fixed);
    expect(solved.ok).toBe(true);
    expect(solved.points.p).toEqual([12, 34]);
    expect(solved.dof).toBe(0);
    expect(solveDrag(fixed, { pointId: "p", x: 20, y: 40 })).toBeNull();
  });

  it("drives a point-to-line distance dimension", () => {
    const sketch: Sketch = {
      points: [
        { id: "a", x: 0, y: 0, fixed: true },
        { id: "b", x: 60, y: 0, fixed: true },
        { id: "p", x: 20, y: 10 },
      ],
      curves: [{ id: "line", type: "line", a: "a", b: "b" }],
      constraints: [],
    };
    const dimensioned = addDimension(
      sketch,
      { kind: "pointLineDistance", point: "p", line: "line" },
      true,
      { offset: 10 },
    );
    expect(dimensioned.constraints.find((c) => c.type === "pointLineDistance")).toMatchObject({
      value: 10,
    });
    const solved = solveSketch(dimensioned);
    expect(solved.ok).toBe(true);
    expect(Math.abs(solved.points.p![1])).toBeCloseTo(10, 4);

    const moved = setDimensionValue(
      dimensioned,
      { kind: "pointLineDistance", point: "p", line: "line" },
      25,
    );
    const solved2 = solveSketch(moved);
    expect(solved2.ok).toBe(true);
    expect(Math.abs(solved2.points.p![1])).toBeCloseTo(25, 4);

    const settled = applySolution(moved, solved2);
    const dragged = solveDrag(settled, { pointId: "p", x: 30, y: 40 });
    expect(dragged).not.toBeNull();
    expect(Math.abs(dragged!.points.p![1])).toBeCloseTo(25, 3);
  });

  it("drives an angle dimension in degrees", () => {
    const first = addPolyline(
      emptySketch(),
      [{ point: [0, 0] }, { point: [60, 0] }],
      false,
    );
    const sketch = addPolyline(first, [{ point: [0, 0] }, { point: [40, 30] }], false);
    const [a, b] = sketch.curves.filter((curve) => curve.type === "line");
    if (!a || !b) throw new Error("expected two lines");
    const dimensioned = addDimension(
      sketch,
      { kind: "angle", a: a.id, b: b.id },
      true,
      { offset: 25 },
    );
    const constraint = dimensioned.constraints.find((c) => c.type === "angle");
    expect(constraint).toMatchObject({ type: "angle" });
    if (!constraint || constraint.type !== "angle") return;
    expect(constraint.value).toBeCloseTo(36.87, 1);

    const solved = solveSketch(dimensioned);
    expect(solved.ok).toBe(true);
    expect(angleBetween(applySolution(dimensioned, solved), a.id, b.id)).toBeCloseTo(36.87, 1);

    const square = setDimensionValue(
      dimensioned,
      { kind: "angle", a: a.id, b: b.id },
      90,
    );
    const solved2 = solveSketch(square);
    expect(solved2.ok).toBe(true);
    expect(angleBetween(applySolution(square, solved2), a.id, b.id)).toBeCloseTo(90, 3);

    const settled = applySolution(square, solved2);
    const dragged = solveDrag(settled, { pointId: b.b, x: 70, y: 10 });
    expect(dragged).not.toBeNull();
    expect(angleBetween(applySolution(settled, dragged!), a.id, b.id)).toBeCloseTo(90, 3);
  });

  it("drives a radius dimension and moves the label", () => {
    const sketch = addCircle(emptySketch(), { point: [0, 0] }, 10);
    const circle = sketch.curves[0]!;
    if (circle.type !== "circle") throw new Error("expected a circle");
    const radius = addDimension(
      sketch,
      { kind: "radius", circle: circle.id },
      true,
      { angle: 30 },
    );
    const constraint = radius.constraints.find((c) => c.type === "diameter");
    expect(constraint).toMatchObject({ radius: true, value: 20 });
    if (!constraint) return;

    const moved = setDimensionPlacement(radius, constraint.id, { angle: 120 });
    expect(moved.constraints.find((c) => c.id === constraint.id)).toMatchObject({
      angle: 120,
    });
    const driven = setDimensionValue(
      radius,
      { kind: "radius", circle: circle.id },
      30,
    );
    const solved = solveSketch(driven);
    expect(solved.ok).toBe(true);
    expect(solved.radii[circle.id]).toBeCloseTo(30, 4);
  });
});
