import { beforeAll, describe, expect, it } from "vitest";
import { addCircle, addPolyline, emptySketch, isSketchEmpty } from "./create";
import { applicableConstraints, applyConstraint } from "./constraints";
import { addDimension, setDimensionValue } from "./dimensions";
import { applySolution, distance, sketchGeometry } from "./geometry";
import { profileFromSketch } from "./loops";
import { applyProjectionGeometry } from "./projection";
import { initSolver, solveDrag, solveSketch } from "./solver";
import type { Sketch } from "./types";

function withPoint(x: number, y: number): Sketch {
  return {
    ...emptySketch(),
    points: [{ id: "p", x, y }],
    constraints: [],
  };
}

describe("sketch reference frame", () => {
  beforeAll(async () => {
    await initSolver();
  });

  it("ships a fixed origin and X/Y axes without making the sketch non-empty", () => {
    const sketch = emptySketch();
    expect(isSketchEmpty(sketch)).toBe(true);
    expect(sketch.references?.origin.id).toBe("origin");
    expect(sketch.references?.lines.map((line) => line.id)).toEqual([
      "axis-x",
      "axis-y",
    ]);
    const geometry = sketchGeometry(sketch);
    expect(geometry.points.origin).toEqual([0, 0]);
    expect(geometry.points["axis-x-max"]).toEqual([1000, 0]);
  });

  it("can constrain a free point to the origin", () => {
    const sketch = withPoint(10, 10);
    expect(applicableConstraints(sketch, ["p", "origin"]).map((a) => a.type)).toContain(
      "coincident",
    );
    const constrained = applyConstraint(sketch, "coincident", ["p", "origin"]);
    const solved = solveSketch(constrained);
    expect(solved.ok).toBe(true);
    expect(solved.points.p).toEqual([0, 0]);
  });

  it("can put a free point on the X axis", () => {
    const sketch = withPoint(10, 10);
    const constrained = applyConstraint(sketch, "pointOnLine", ["p", "axis-x"]);
    const solved = solveSketch(constrained);
    expect(solved.ok).toBe(true);
    expect(solved.points.p![1]).toBeCloseTo(0, 6);
  });

  it("dimensions a point from the origin", () => {
    const sketch = withPoint(10, 10);
    const dimensioned = addDimension(
      sketch,
      { kind: "distance", a: "origin", b: "p" },
      true,
      { offset: 10 },
    );
    const driven = setDimensionValue(
      dimensioned,
      { kind: "distance", a: "origin", b: "p" },
      20,
    );
    const solved = solveSketch(driven);
    expect(solved.ok).toBe(true);
    expect(
      distance(solved.points.p!, [0, 0]),
    ).toBeCloseTo(20, 4);
  });

  it("dimensions a point from the X axis", () => {
    const sketch = withPoint(10, 10);
    const dimensioned = addDimension(
      sketch,
      { kind: "pointLineDistance", point: "p", line: "axis-x" },
      true,
      { offset: 8 },
    );
    const driven = setDimensionValue(
      dimensioned,
      { kind: "pointLineDistance", point: "p", line: "axis-x" },
      25,
    );
    const solved = solveSketch(driven);
    expect(solved.ok).toBe(true);
    expect(Math.abs(solved.points.p![1])).toBeCloseTo(25, 4);
  });

  it("extrudes a circle centred on the reference origin", () => {
    const sketch = addCircle(
      emptySketch(),
      { point: [0, 0], existingPointId: "origin" },
      10,
    );
    const profile = profileFromSketch(sketch);
    expect(profile).not.toBeNull();
    expect(profile!.outer).toMatchObject({
      kind: "circle",
      center: [0, 0],
      radius: 10,
    });
  });

  it("keeps a polyline vertex snapped to a projected reference line", () => {
    const projected = applyProjectionGeometry(
      emptySketch(),
      "proj-1",
      "Projected face",
      [
        [
          [0, 0],
          [60, 0],
          [60, 40],
          [0, 40],
        ],
      ],
    );
    if (!projected) throw new Error("Expected the projection to apply");
    const lineId = "proj-1-l0-0";
    const sketch = addPolyline(
      projected,
      [
        { point: [10, 1], referenceLineId: lineId },
        { point: [10, 20] },
      ],
      false,
    );
    const pointId = sketch.points[0]!.id;
    expect(sketch.constraints).toContainEqual(
      expect.objectContaining({
        type: "pointOnLine",
        point: pointId,
        line: lineId,
      }),
    );
    const solved = solveSketch(sketch);
    expect(solved.ok).toBe(true);
    expect(solved.points[pointId]![1]).toBeCloseTo(0, 6);
  });

  it("does not drift a detached point when dragging another projected point", () => {
    const projected = applyProjectionGeometry(
      emptySketch(),
      "proj-1",
      "Projected face",
      [
        [
          [-30, -6],
          [30, -6],
          [30, 6],
          [-30, 6],
        ],
      ],
    );
    if (!projected) throw new Error("Expected the projection to apply");
    const sketch = addPolyline(
      projected,
      [
        { point: [-30, 1], referenceLineId: "proj-1-l0-3" },
        { point: [-1, -6], referenceLineId: "proj-1-l0-0" },
      ],
      false,
    );
    const leftId = sketch.points[0]!.id;
    const rightId = sketch.points[1]!.id;
    const settled = solveSketch(sketch);
    expect(settled.ok).toBe(true);
    const dragged = solveDrag(applySolution(sketch, settled), {
      pointId: rightId,
      x: -10,
      y: -6,
    });
    if (!dragged) throw new Error("Expected the drag to move");
    expect(dragged.points[rightId]![0]).toBeCloseTo(-10, 1);
    expect(dragged.points[leftId]![0]).toBeCloseTo(
      settled.points[leftId]![0],
      6,
    );
    expect(dragged.points[leftId]![1]).toBeCloseTo(
      settled.points[leftId]![1],
      6,
    );
  });
});
