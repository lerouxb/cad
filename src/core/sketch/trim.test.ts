import { beforeAll, describe, expect, it } from "vitest";
import { addArc, addPolyline, emptySketch } from "./create";
import { initSolver, solveSketch } from "./solver";
import { trimCurveAt } from "./trim";
import { allPoints, type Sketch } from "./types";

function at(sketch: Sketch, x: number, y: number): { x: number; y: number } {
  const point = allPoints(sketch).find(
    (candidate) =>
      Math.abs(candidate.x - x) < 1e-6 && Math.abs(candidate.y - y) < 1e-6,
  );
  if (!point) throw new Error(`No point at ${x}, ${y}`);
  return point;
}

function horizontalWithVerticals(xs: number[]): {
  sketch: Sketch;
  horizontalId: string;
  verticalIds: string[];
} {
  let sketch = addPolyline(
    emptySketch(),
    [
      { point: [-20, 0] },
      { point: [20, 0] },
    ],
    false,
  );
  const horizontalId = sketch.curves[0]!.id;
  for (const x of xs) {
    sketch = addPolyline(
      sketch,
      [
        { point: [x, -20] },
        { point: [x, 20] },
      ],
      false,
    );
  }
  return {
    sketch,
    horizontalId,
    verticalIds: sketch.curves
      .filter((curve) => curve.type === "line" && curve.id !== horizontalId)
      .map((curve) => curve.id),
  };
}

describe("trim", () => {
  beforeAll(async () => {
    await initSolver();
  });

  it("removes an unsplit line", () => {
    const { sketch, horizontalId } = horizontalWithVerticals([]);
    const result = trimCurveAt(sketch, horizontalId, [5, 0]);
    expect(result.removed).toBe(true);
    expect(result.sketch.curves).toHaveLength(0);
    expect(result.sketch.points).toHaveLength(0);
  });

  it("keeps the segment before the nearest crossing", () => {
    const { sketch, horizontalId, verticalIds } = horizontalWithVerticals([0]);
    const verticalId = verticalIds[0]!;
    const result = trimCurveAt(sketch, horizontalId, [5, 0]);

    expect(result.removed).toBe(true);
    expect(result.sketch.curves.some((curve) => curve.id === horizontalId)).toBe(
      false,
    );
    const kept = result.sketch.curves.filter(
      (curve) => curve.type === "line" && curve.id !== verticalId,
    );
    expect(kept).toHaveLength(1);
    const line = kept[0]!;
    if (line.type !== "line") throw new Error("Expected a line");
    const a = allPoints(result.sketch).find((point) => point.id === line.a)!;
    const b = allPoints(result.sketch).find((point) => point.id === line.b)!;
    expect([a.x, a.y]).toEqual([-20, 0]);
    expect([b.x, b.y]).toEqual([0, 0]);

    expect(
      result.sketch.constraints.some(
        (constraint) =>
          constraint.type === "horizontal" && constraint.line === line.id,
      ),
    ).toBe(true);
    expect(
      result.sketch.constraints.some(
        (constraint) =>
          constraint.type === "pointOnLine" &&
          constraint.line === verticalId &&
          constraint.point === b.id,
      ),
    ).toBe(true);

    const solved = solveSketch(result.sketch);
    expect(solved.ok).toBe(true);
  });

  it("removes a middle segment and keeps both ends collinear", () => {
    const { sketch, horizontalId, verticalIds } = horizontalWithVerticals([
      -5, 5,
    ]);
    const result = trimCurveAt(sketch, horizontalId, [0, 0]);

    expect(result.removed).toBe(true);
    const kept = result.sketch.curves.filter(
      (curve) =>
        curve.type === "line" &&
        !verticalIds.includes(curve.id) &&
        curve.id !== horizontalId,
    );
    expect(kept).toHaveLength(2);

    const parallel = result.sketch.constraints.find(
      (constraint) => constraint.type === "parallel",
    );
    expect(parallel).toBeDefined();
    if (parallel?.type !== "parallel") throw new Error("Expected parallel");

    const keptIds = new Set(kept.map((curve) => curve.id));
    expect(keptIds.has(parallel.a)).toBe(true);
    expect(keptIds.has(parallel.b)).toBe(true);

    const solved = solveSketch(result.sketch);
    expect(solved.ok).toBe(true);
  });

  it("trims an arc's middle and keeps the two pieces on one circle", () => {
    let sketch = addArc(
      emptySketch(),
      { point: [-10, 0] },
      { point: [10, 0] },
      [0, 10],
    );
    const arc = sketch.curves[0]!;
    if (arc.type !== "arc") throw new Error("Expected an arc");
    sketch = addPolyline(
      sketch,
      [
        { point: [-15, 5] },
        { point: [15, 5] },
      ],
      false,
    );

    const result = trimCurveAt(sketch, arc.id, [0, 10]);
    expect(result.removed).toBe(true);

    const arcs = result.sketch.curves.filter(
      (curve): curve is Extract<typeof curve, { type: "arc" }> =>
        curve.type === "arc",
    );
    expect(arcs).toHaveLength(2);
    for (const piece of arcs) expect(piece.center).toBe(arc.center);

    const circleLinks = result.sketch.constraints.filter(
      (constraint) =>
        constraint.type === "pointOnCircle" && constraint.circle === arcs[0]!.id,
    );
    expect(circleLinks).toHaveLength(2);

    const solved = solveSketch(result.sketch);
    expect(solved.ok).toBe(true);
  });

  it("reports constraints that a split cannot carry over", () => {
    let sketch = addPolyline(
      emptySketch(),
      [
        { point: [-20, 0] },
        { point: [20, 0] },
      ],
      false,
    );
    const first = sketch.curves[0]!;
    sketch = addPolyline(
      sketch,
      [
        { point: [0, -20] },
        { point: [0, 20] },
      ],
      false,
    );
    const second = sketch.curves[1]!;
    sketch = {
      ...sketch,
      constraints: [
        ...sketch.constraints,
        { id: "equal-1", type: "equal", a: first.id, b: second.id },
      ],
    };

    const result = trimCurveAt(sketch, first.id, [5, 0]);
    expect(result.removed).toBe(true);
    expect(result.droppedConstraints).toBeGreaterThan(0);
    expect(at(result.sketch, 0, 0)).toBeDefined();
  });
});
