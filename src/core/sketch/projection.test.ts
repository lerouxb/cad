import { describe, expect, it } from "vitest";
import { addPoint, addPolyline, emptySketch } from "./create";
import {
  applicableConstraints,
  applyConstraint,
  constructionState,
  toggleConstruction,
} from "./constraints";
import { regionsFromSketch } from "./loops";
import {
  applyProjectionGeometry,
  projectPointToPlane,
  projectedCircle,
  projectionHasDependents,
  sameProjectedLoops,
} from "./projection";
import { initSolver, solveSketch } from "./solver";

function circleLoop(
  radius: number,
  count = 32,
  center: [number, number] = [0, 0],
): Array<[number, number]> {
  return Array.from({ length: count }, (_, index) => {
    const angle = (index / count) * Math.PI * 2;
    return [
      center[0] + Math.cos(angle) * radius,
      center[1] + Math.sin(angle) * radius,
    ] as [number, number];
  });
}

const frame = {
  origin: [10, 20, 5] as [number, number, number],
  normal: [0, 0, 1] as [number, number, number],
  xAxis: [1, 0, 0] as [number, number, number],
  yAxis: [0, 1, 0] as [number, number, number],
};

describe("face projections", () => {
  it("projects world points and creates fixed reference geometry", () => {
    expect(projectPointToPlane([15, 24, 5], frame)).toEqual([5, 4]);
    const sketch = applyProjectionGeometry(
      emptySketch(),
      "proj-1",
      "Projected face",
      [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
        ],
      ],
    );
    if (!sketch) throw new Error("Expected the projection to apply");
    const points = sketch.references!.points.filter(
      (point) => point.projectionId === "proj-1",
    );
    const lines = sketch.references!.lines.filter(
      (line) => line.projectionId === "proj-1",
    );
    expect(points).toHaveLength(4);
    expect(lines).toHaveLength(4);
    expect(points.every((point) => point.fixed && point.reference)).toBe(true);
    expect(lines.every((line) => line.reference && line.construction)).toBe(true);
  });

  it("toggles projected lines between construction and profile geometry", () => {
    const sketch = applyProjectionGeometry(
      emptySketch(),
      "proj-1",
      "Projected face",
      [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
        ],
      ],
    );
    if (!sketch) throw new Error("Expected the projection to apply");
    const lineIds = sketch.references!.lines
      .filter((line) => line.projectionId === "proj-1")
      .map((line) => line.id);
    expect(constructionState(sketch, lineIds)).toBe("all");
    expect(regionsFromSketch(sketch)).toHaveLength(0);

    const normal = toggleConstruction(sketch, lineIds);
    expect(constructionState(normal, lineIds)).toBe("none");
    const regions = regionsFromSketch(normal);
    expect(regions).toHaveLength(1);
    expect(regions[0]?.kind).toBe("material");
    expect(regions[0]?.area).toBeCloseTo(100, 6);

    const point = addPoint(normal, [5, 5]);
    const pointId = point.points[point.points.length - 1]!.id;
    expect(
      applicableConstraints(point, [pointId, lineIds[0]!]).some(
        (action) => action.type === "pointOnLine",
      ),
    ).toBe(true);

    const moved = applyProjectionGeometry(
      normal,
      "proj-1",
      "Projected face",
      [
        [
          [4, 4],
          [10, 4],
          [10, 10],
          [4, 10],
        ],
      ],
      true,
    );
    if (!moved) throw new Error("Expected the updated projection");
    expect(
      moved.references!.lines
        .filter((line) => line.projectionId === "proj-1")
        .every((line) => line.construction === false),
    ).toBe(true);
  });

  it("updates positions without losing ids when the topology is stable", () => {
    const first = applyProjectionGeometry(
      emptySketch(),
      "proj-1",
      "Projected face",
      [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
        ],
      ],
    );
    if (!first) throw new Error("Expected the first projection");
    const moved = applyProjectionGeometry(
      first,
      "proj-1",
      "Projected face",
      [
        [
          [1, 1],
          [11, 1],
          [11, 11],
          [1, 11],
        ],
      ],
      true,
    );
    if (!moved) throw new Error("Expected the updated projection");
    const before = first.references!.points.filter(
      (point) => point.projectionId === "proj-1",
    );
    const after = moved.references!.points.filter(
      (point) => point.projectionId === "proj-1",
    );
    expect(after.map((point) => point.id)).toEqual(
      before.map((point) => point.id),
    );
    expect(after[0]).toMatchObject({ x: 1, y: 1 });
  });

  it("refuses a topology change when preserving identities", () => {
    const first = applyProjectionGeometry(
      emptySketch(),
      "proj-1",
      "Projected face",
      [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
        ],
      ],
    );
    if (!first) throw new Error("Expected the first projection");
    expect(
      applyProjectionGeometry(
        first,
        "proj-1",
        "Projected face",
        [
          [
            [0, 0],
            [10, 0],
            [5, 10],
          ],
        ],
        true,
      ),
    ).toBeNull();
  });

  it("compares projected loops with a tolerance", () => {
    expect(sameProjectedLoops([[[0, 0]]], [[[0.0001, 0.0001]]])).toBe(true);
    expect(sameProjectedLoops([[[0, 0]]], [[[0.1, 0]]])).toBe(false);
  });

  it("keeps a circular boundary analytic so a point can sit on it", async () => {
    await initSolver();
    const loop = circleLoop(8, 32, [3, -2]);
    const fitted = projectedCircle(loop);
    expect(fitted).not.toBeNull();
    expect(fitted!.center[0]).toBeCloseTo(3, 9);
    expect(fitted!.center[1]).toBeCloseTo(-2, 9);
    expect(fitted!.radius).toBeCloseTo(8, 9);
    const sketch = applyProjectionGeometry(
      emptySketch(),
      "proj-circle",
      "Projected circle",
      [loop],
    );
    if (!sketch) throw new Error("Expected the projection to apply");
    const circles = sketch.references!.circles!.filter(
      (circle) => circle.projectionId === "proj-circle",
    );
    expect(circles).toHaveLength(1);
    expect(circles[0]).toMatchObject({
      reference: true,
      construction: true,
      radius: 8,
    });
    expect(
      sketch.references!.lines.filter(
        (line) => line.projectionId === "proj-circle",
      ),
    ).toHaveLength(0);

    const circle = circles[0]!;
    expect(constructionState(sketch, [circle.id])).toBe("all");
    const normal = toggleConstruction(sketch, [circle.id]);
    expect(constructionState(normal, [circle.id])).toBe("none");
    expect(regionsFromSketch(normal)).toHaveLength(1);

    const withPoint = addPoint(normal, [20, 0]);
    const pointId = withPoint.points[withPoint.points.length - 1]!.id;
    expect(
      applicableConstraints(withPoint, [pointId, circle.id]).some(
        (action) => action.type === "pointOnCircle",
      ),
    ).toBe(true);
    const constrained = applyConstraint(withPoint, "pointOnCircle", [
      pointId,
      circle.id,
    ]);
    const outcome = solveSketch(constrained);
    expect(outcome.ok).toBe(true);
    const solved = outcome.points[pointId]!;
    expect(Math.hypot(solved[0] - 3, solved[1] + 2)).toBeCloseTo(8, 3);
  });

  it("attaches a point snapped onto a projected circle", () => {
    const sketch = applyProjectionGeometry(
      emptySketch(),
      "proj-snap",
      "Projected circle",
      [circleLoop(8)],
    );
    if (!sketch) throw new Error("Expected the projection to apply");
    const circle = sketch.references!.circles![0]!;
    const snapped = addPoint(sketch, [0, 8], undefined, undefined, circle.id);
    expect(
      snapped.constraints.some(
        (constraint) =>
          constraint.type === "pointOnCircle" &&
          constraint.circle === circle.id,
      ),
    ).toBe(true);

    const polyline = addPolyline(
      sketch,
      [
        { point: [0, 8], referenceCircleId: circle.id },
        { point: [12, 8] },
      ],
      false,
    );
    expect(
      polyline.constraints.filter(
        (constraint) =>
          constraint.type === "pointOnCircle" &&
          constraint.circle === circle.id,
      ),
    ).toHaveLength(1);
  });

  it("knows when a projection is safe to re-represent", () => {
    const sketch = applyProjectionGeometry(
      emptySketch(),
      "proj-rep",
      "Projected circle",
      [circleLoop(8)],
    );
    if (!sketch) throw new Error("Expected the projection to apply");
    expect(projectionHasDependents(sketch, "proj-rep")).toBe(false);
    const circle = sketch.references!.circles![0]!;
    const withPoint = addPoint(sketch, [20, 0]);
    const pointId = withPoint.points[withPoint.points.length - 1]!.id;
    const constrained = applyConstraint(withPoint, "pointOnCircle", [
      pointId,
      circle.id,
    ]);
    expect(projectionHasDependents(constrained, "proj-rep")).toBe(true);
  });

  it("leaves a non-circular projected boundary as a polyline", () => {
    const ellipse = circleLoop(8).map(([x, y]) => [x, y * 0.5] as [number, number]);
    expect(projectedCircle(ellipse)).toBeNull();
    const sketch = applyProjectionGeometry(
      emptySketch(),
      "proj-ellipse",
      "Projected boundary",
      [ellipse],
    );
    if (!sketch) throw new Error("Expected the projection to apply");
    expect(sketch.references!.circles).toHaveLength(0);
    expect(
      sketch.references!.lines.filter(
        (line) => line.projectionId === "proj-ellipse",
      ),
    ).toHaveLength(ellipse.length);
  });
});
