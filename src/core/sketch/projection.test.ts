import { describe, expect, it } from "vitest";
import { addPoint, emptySketch } from "./create";
import {
  applicableConstraints,
  constructionState,
  toggleConstruction,
} from "./constraints";
import { regionsFromSketch } from "./loops";
import {
  applyProjectionGeometry,
  projectPointToPlane,
  sameProjectedLoops,
} from "./projection";

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
});
