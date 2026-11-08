import { describe, expect, it } from "vitest";
import { emptySketch } from "./create";
import { marqueeSketchSelection } from "./marqueeSelect";
import { applyProjectionGeometry } from "./projection";
import type { Sketch } from "./types";

const points = {
  a: [0, 0] as [number, number],
  b: [10, 0] as [number, number],
  c: [20, 0] as [number, number],
  d: [30, 0] as [number, number],
  center: [25, 10] as [number, number],
};

const sketch: Sketch = {
  points: [
    { id: "a", x: 0, y: 0 },
    { id: "b", x: 10, y: 0 },
    { id: "c", x: 20, y: 0 },
    { id: "d", x: 30, y: 0 },
    { id: "center", x: 25, y: 10 },
  ],
  curves: [
    { id: "first", type: "line", a: "a", b: "b" },
    { id: "second", type: "line", a: "c", b: "d" },
    { id: "circle", type: "circle", center: "center", radius: 3 },
  ],
  constraints: [
    { id: "width", type: "distance", a: "a", b: "b", value: 10 },
  ],
};

describe("sketch marquee selection", () => {
  it("box-selects only what it fully encloses, through the filter", () => {
    const box = {
      kind: "box" as const,
      minX: -1,
      minY: -1,
      maxX: 11,
      maxY: 1,
    };
    expect(
      marqueeSketchSelection(sketch, points, {}, box, "all"),
    ).toEqual(["a", "b", "first", "width"]);
    expect(
      marqueeSketchSelection(sketch, points, {}, box, "curves"),
    ).toEqual(["first"]);
    expect(
      marqueeSketchSelection(sketch, points, {}, box, "points"),
    ).toEqual(["a", "b"]);
    expect(
      marqueeSketchSelection(sketch, points, {}, box, "dimensions"),
    ).toEqual(["width"]);
  });

  it("lasso-selects touched geometry and crossing lines", () => {
    const lasso = {
      kind: "lasso" as const,
      points: [
        [5, -2],
        [25, -2],
        [25, 2],
        [5, 2],
      ] as [number, number][],
    };
    expect(
      marqueeSketchSelection(sketch, points, {}, lasso, "curves"),
    ).toEqual(["first", "second"]);
    expect(
      marqueeSketchSelection(sketch, points, {}, lasso, "points"),
    ).toEqual(["b", "c"]);
  });

  it("treats a box around a circle as the whole curve", () => {
    const box = {
      kind: "box" as const,
      minX: 20,
      minY: 5,
      maxX: 30,
      maxY: 15,
    };
    expect(
      marqueeSketchSelection(sketch, points, {}, box, "curves"),
    ).toEqual(["circle"]);
  });

  it("marquees projected reference points and curves like sketch geometry", () => {
    const projected = applyProjectionGeometry(
      emptySketch(),
      "proj",
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
    if (!projected) throw new Error("Expected the projection to apply");
    const box = {
      kind: "box" as const,
      minX: -1,
      minY: -1,
      maxX: 11,
      maxY: 11,
    };
    const pointIds = projected.references!.points
      .filter((point) => point.projectionId === "proj")
      .map((point) => point.id);
    const lineIds = projected.references!.lines
      .filter((line) => line.projectionId === "proj")
      .map((line) => line.id);
    const projectedPositions = Object.fromEntries(
      projected.references!.points.map((point) => [
        point.id,
        [point.x, point.y] as [number, number],
      ]),
    );
    const geometryPoints = { ...points, ...projectedPositions };
    const all = marqueeSketchSelection(
      projected,
      geometryPoints,
      {},
      box,
      "all",
    );
    expect(all).toEqual(expect.arrayContaining([...pointIds, ...lineIds]));
    const curves = marqueeSketchSelection(
      projected,
      geometryPoints,
      {},
      box,
      "curves",
    );
    expect(curves).toEqual(expect.arrayContaining(lineIds));
    expect(curves).not.toEqual(expect.arrayContaining(pointIds));
    expect(
      marqueeSketchSelection(projected, geometryPoints, {}, box, "points"),
    ).toEqual(expect.arrayContaining(pointIds));
  });

  it("is a no-op for an empty or too-short lasso", () => {
    expect(
      marqueeSketchSelection(
        sketch,
        points,
        {},
        { kind: "lasso", points: [[0, 0]] },
        "all",
      ),
    ).toEqual([]);
  });
});
