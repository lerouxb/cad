import { beforeAll, describe, expect, it } from "vitest";
import {
  addCenterArc,
  addCenterRectangle,
  addCircleByDiameter,
  addCircleThroughPoints,
  addOrientedRectangle,
  addPolyline,
  addTangentArc,
  emptySketch,
} from "./create";
import { applySolution, arcGeometry, distance } from "./geometry";
import { initSolver, solveSketch } from "./solver";
import type { Sketch } from "./types";

function solved(sketch: Sketch): Sketch {
  const outcome = solveSketch(sketch);
  expect(outcome.ok).toBe(true);
  return applySolution(sketch, outcome);
}

function pointsById(sketch: Sketch): Record<string, [number, number]> {
  return Object.fromEntries(
    sketch.points.map((point) => [point.id, [point.x, point.y]]),
  );
}

function lineDirection(
  sketch: Sketch,
  id: string,
): [number, number] {
  const line = sketch.curves.find((curve) => curve.id === id);
  if (!line || line.type !== "line") throw new Error("missing line");
  const byId = pointsById(sketch);
  const a = byId[line.a]!;
  const b = byId[line.b]!;
  return [b[0] - a[0], b[1] - a[1]];
}

describe("sketch create variants", () => {
  beforeAll(async () => {
    await initSolver();
  });

  it("draws a rectangle from its centre", () => {
    const sketch = solved(addCenterRectangle(emptySketch(), [0, 0], [10, 5]));
    const xs = sketch.points.map((point) => point.x);
    const ys = sketch.points.map((point) => point.y);
    expect(Math.min(...xs)).toBeCloseTo(-10, 4);
    expect(Math.max(...xs)).toBeCloseTo(10, 4);
    expect(Math.min(...ys)).toBeCloseTo(-5, 4);
    expect(Math.max(...ys)).toBeCloseTo(5, 4);
    expect(sketch.curves).toHaveLength(4);
  });

  it("draws an oriented three-point rectangle", () => {
    const base = addOrientedRectangle(emptySketch(), [0, 0], [10, 10], [5, 15]);
    expect(base.constraints.map((constraint) => constraint.type)).toEqual([
      "parallel",
      "parallel",
      "perpendicular",
    ]);
    const sketch = solved(base);
    const lines = sketch.curves.filter((curve) => curve.type === "line");
    expect(lines).toHaveLength(4);
    const [a, b, c, d] = lines.map((line) => line.id);
    const [ax, ay] = lineDirection(sketch, a!);
    const [bx, by] = lineDirection(sketch, b!);
    const [cx, cy] = lineDirection(sketch, c!);
    expect(ax * by - ay * bx).not.toBeCloseTo(0, 1);
    expect(ax * cy - ay * cx).toBeCloseTo(0, 3);
    expect(ax * bx + ay * by).toBeCloseTo(0, 3);
    expect(d).toBeTruthy();
  });

  it("draws a two-point circle from its diameter", () => {
    const sketch = solved(
      addCircleByDiameter(
        emptySketch(),
        { point: [0, 0] },
        { point: [10, 0] },
      ),
    );
    const circle = sketch.curves[0];
    if (!circle || circle.type !== "circle") throw new Error("missing circle");
    const center = sketch.points.find((point) => point.id === circle.center)!;
    expect(center.x).toBeCloseTo(5, 4);
    expect(center.y).toBeCloseTo(0, 4);
    expect(circle.radius).toBeCloseTo(5, 4);
  });

  it("draws a three-point circle through all three clicks", () => {
    const sketch = solved(
      addCircleThroughPoints(
        emptySketch(),
        { point: [0, 0] },
        { point: [10, 0] },
        { point: [0, 10] },
      ),
    );
    const circle = sketch.curves[0];
    if (!circle || circle.type !== "circle") throw new Error("missing circle");
    const center = sketch.points.find((point) => point.id === circle.center)!;
    expect(center.x).toBeCloseTo(5, 4);
    expect(center.y).toBeCloseTo(5, 4);
    expect(circle.radius).toBeCloseTo(Math.hypot(5, 5), 4);
  });

  it("draws a centre-point arc counter-clockwise from start to end", () => {
    const sketch = solved(
      addCenterArc(
        emptySketch(),
        { point: [0, 0] },
        { point: [10, 0] },
        { point: [0, 10] },
      ),
    );
    const arc = sketch.curves[0];
    if (!arc || arc.type !== "arc") throw new Error("missing arc");
    const geometry = arcGeometry(arc, pointsById(sketch))!;
    expect(geometry.radius).toBeCloseTo(10, 4);
    expect(geometry.sweep).toBeCloseTo(Math.PI / 2, 4);
    expect(geometry.center[0]).toBeCloseTo(0, 4);
    expect(geometry.center[1]).toBeCloseTo(0, 4);
  });

  it("draws a tangent arc from a line endpoint", () => {
    const lineSketch = addPolyline(
      emptySketch(),
      [{ point: [0, 0] }, { point: [10, 0] }],
      false,
    );
    const line = lineSketch.curves[0];
    if (!line || line.type !== "line") throw new Error("missing line");
    const start = lineSketch.points.find((point) => point.id === line.a)!;
    const sketch = addTangentArc(
      lineSketch,
      { point: [start.x, start.y], existingPointId: start.id },
      { point: [10, 10] },
      line.id,
    );
    expect(sketch.constraints.some((c) => c.type === "tangent")).toBe(true);
    const applied = solved(sketch);
    const arc = applied.curves.find((curve) => curve.type === "arc");
    if (!arc || arc.type !== "arc") throw new Error("missing arc");
    const geometry = arcGeometry(arc, pointsById(applied))!;
    expect(geometry.center[0]).toBeCloseTo(0, 3);
    expect(geometry.center[1]).toBeCloseTo(10, 3);
    expect(geometry.radius).toBeCloseTo(10, 3);
    expect(distance(geometry.center, [10, 10])).toBeCloseTo(10, 3);
  });
});
