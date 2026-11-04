import { describe, expect, it } from "vitest";
import {
  addCircle,
  addPoint,
  addPolyline,
  addRectangle,
  emptySketch,
} from "./create";
import {
  pointInPolygon,
  regionsFromSketch,
  regionsFullyInside,
  regionsFullyInsidePolygon,
  regionsIntersectingPolygon,
} from "./loops";
import { createDemoModel } from "./demo";
import type { Sketch } from "./types";

function diagonalRectangle(): Sketch {
  const rectangle = addRectangle(emptySketch(), [0, 0], [60, 40]);
  const p0 = rectangle.points[0]!;
  const p2 = rectangle.points[2]!;
  return addPolyline(
    rectangle,
    [
      { point: [0, 0], existingPointId: p0.id },
      { point: [60, 40], existingPointId: p2.id },
    ],
    false,
  );
}

describe("sketch regions", () => {
  it("turns a rectangle into one region", () => {
    const regions = regionsFromSketch(addRectangle(emptySketch(), [0, 0], [60, 40]));
    expect(regions).toHaveLength(1);
    expect(regions[0]).toMatchObject({ depth: 0, kind: "material", area: 2400 });
    expect(regions[0]!.outer.kind).toBe("polygon");
    expect(regions[0]!.holes).toHaveLength(0);
  });

  it("keeps profiles selectable when a polygon crosses the example plate and hole", () => {
    const demo = createDemoModel().sketch;
    const crossed = addPolyline(
      demo,
      [
        { point: [-40, 0] },
        { point: [2, 27] },
        { point: [39, 7.5] },
        { point: [16, -27] },
      ],
      true,
    );
    const regions = regionsFromSketch(crossed);
    expect(regions).toHaveLength(10);
    expect(regions.filter((region) => region.kind === "void")).toHaveLength(1);
    expect(
      regions.filter((region) => region.kind === "material").length,
    ).toBe(9);
    // Every material region is a real closed loop, not an empty artifact.
    for (const region of regions) {
      if (region.outer.kind === "circle") {
        expect(region.outer.radius).toBeGreaterThan(0);
        continue;
      }
      expect(region.outer.points.length).toBeGreaterThanOrEqual(3);
      expect(region.area).toBeGreaterThan(0);
    }
  });

  it("does not treat standalone points as profiles", () => {
    const sketch = addPoint(emptySketch(), [10, 10]);
    expect(regionsFromSketch(sketch)).toHaveLength(0);
  });

  it("turns two disjoint rectangles into two regions", () => {
    const first = addRectangle(emptySketch(), [0, 0], [60, 40]);
    const both = addRectangle(first, [100, 0], [160, 40]);
    const regions = regionsFromSketch(both);
    expect(regions).toHaveLength(2);
    expect(regions.map((region) => region.area)).toEqual([2400, 2400]);
  });

  it("selects only regions fully inside a box", () => {
    const first = addRectangle(emptySketch(), [0, 0], [40, 20]);
    const both = addRectangle(first, [60, 0], [100, 20]);
    const regions = regionsFromSketch(both);
    expect(regions).toHaveLength(2);

    expect(regionsFullyInside(regions, { minX: -5, minY: -5, maxX: 45, maxY: 25 }))
      .toHaveLength(1);
    expect(
      regionsFullyInside(regions, { minX: -5, minY: -5, maxX: 105, maxY: 25 }),
    ).toHaveLength(2);
    // Crossing the first rectangle without enclosing it selects nothing.
    expect(regionsFullyInside(regions, { minX: 10, minY: -5, maxX: 105, maxY: 25 }))
      .toHaveLength(1);
  });

  it("selects a fully enclosed circle region", () => {
    const sketch = addCircle(emptySketch(), { point: [20, 20] }, 10);
    const regions = regionsFromSketch(sketch);
    expect(
      regionsFullyInside(regions, { minX: 0, minY: 0, maxX: 40, maxY: 40 }),
    ).toHaveLength(1);
    expect(
      regionsFullyInside(regions, { minX: 15, minY: 15, maxX: 40, maxY: 40 }),
    ).toHaveLength(0);
  });

  it("selects regions fully inside a lasso polygon", () => {
    const first = addRectangle(emptySketch(), [0, 0], [40, 20]);
    const both = addRectangle(first, [60, 0], [100, 20]);
    const regions = regionsFromSketch(both);
    const bothLasso = [
      [-5, -5],
      [105, -5],
      [105, 25],
      [-5, 25],
    ] as const;
    const oneLasso = [
      [-5, -5],
      [45, -5],
      [45, 25],
      [-5, 25],
    ] as const;
    const crossingLasso = [
      [10, -5],
      [105, -5],
      [105, 25],
      [10, 25],
    ] as const;

    expect(regionsFullyInsidePolygon(regions, [...bothLasso])).toHaveLength(2);
    expect(regionsFullyInsidePolygon(regions, [...oneLasso])).toHaveLength(1);
    expect(regionsFullyInsidePolygon(regions, [...crossingLasso])).toHaveLength(
      1,
    );
    expect(regionsFullyInsidePolygon(regions, [[0, 0], [1, 1]])).toHaveLength(0);
  });

  it("lasso selects a profile it merely touches", () => {
    const first = addRectangle(emptySketch(), [0, 0], [40, 20]);
    const both = addRectangle(first, [60, 0], [100, 20]);
    const regions = regionsFromSketch(both);
    const right = regions.find(
      (region) =>
        region.outer.kind !== "circle" &&
        Math.min(...region.outer.points.map((point) => point[0])) >= 60,
    )!;

    // A small loop entirely inside the right profile's top-right corner.
    const corner = [
      [90, 15],
      [95, 15],
      [95, 18],
      [90, 18],
    ] as const;
    const touched = regionsIntersectingPolygon(regions, [...corner]);
    expect(touched.map((region) => region.id)).toEqual([right.id]);

    // A loop outside every profile touches nothing.
    expect(
      regionsIntersectingPolygon(regions, [
        [-20, -20],
        [-10, -20],
        [-10, -10],
        [-20, -10],
      ]),
    ).toHaveLength(0);
  });

  it("does not select parent material for a lasso inside its hole", () => {
    const rectangle = addRectangle(emptySketch(), [0, 0], [60, 40]);
    const withHole = addCircle(rectangle, { point: [30, 20] }, 8);
    const regions = regionsFromSketch(withHole);
    const insideHole = [
      [28, 18],
      [32, 18],
      [32, 22],
      [28, 22],
    ] as const;
    const selected = regionsIntersectingPolygon(regions, [...insideHole]);
    expect(selected.every((region) => region.kind === "void")).toBe(true);
    expect(selected).toHaveLength(1);
  });

  it("handles concave lasso polygons and circle containment", () => {
    const polygon = [
      [0, 0],
      [50, 0],
      [50, 50],
      [30, 30],
      [20, 50],
      [0, 50],
    ] as const;
    expect(pointInPolygon([10, 10], polygon)).toBe(true);
    expect(pointInPolygon([40, 10], polygon)).toBe(true);
    expect(pointInPolygon([25, 45], polygon)).toBe(false);

    const circle = addCircle(emptySketch(), { point: [10, 10] }, 4);
    const regions = regionsFromSketch(circle);
    expect(regionsFullyInsidePolygon(regions, [...polygon])).toHaveLength(1);
  });

  it("exposes a nested circle as both a hole and a void profile", () => {
    const rectangle = addRectangle(emptySketch(), [0, 0], [100, 60]);
    const withHole = addCircle(rectangle, { point: [50, 30] }, 10);
    const regions = regionsFromSketch(withHole);

    expect(regions).toHaveLength(2);
    const [plate, voidDisk] = regions;
    expect(plate!.kind).toBe("material");
    expect(plate!.holes).toHaveLength(1);
    expect(plate!.holes[0]).toMatchObject({ kind: "circle", radius: 10 });
    expect(plate!.area).toBeCloseTo(6000 - Math.PI * 100, 4);
    expect(voidDisk!.kind).toBe("void");
    expect(voidDisk!.depth).toBe(1);
    expect(voidDisk!.holes).toHaveLength(0);
    expect(voidDisk!.outer).toMatchObject({ kind: "circle", radius: 10 });
    expect(voidDisk!.area).toBeCloseTo(Math.PI * 100, 4);
  });

  it("makes concentric circles a tube and an inner void profile", () => {
    const outer = addCircle(emptySketch(), { point: [0, 0] }, 20);
    const tube = addCircle(outer, { point: [0, 0] }, 8);
    const regions = regionsFromSketch(tube);

    expect(regions).toHaveLength(2);
    const [ring, voidDisk] = regions;
    expect(ring!.kind).toBe("material");
    expect(ring!.holes).toHaveLength(1);
    expect(ring!.area).toBeCloseTo(Math.PI * (20 * 20 - 8 * 8), 4);
    expect(voidDisk!.kind).toBe("void");
    expect(voidDisk!.area).toBeCloseTo(Math.PI * 8 * 8, 4);
  });

  it("makes a lone circle a solid region", () => {
    const regions = regionsFromSketch(addCircle(emptySketch(), { point: [0, 0] }, 12));
    expect(regions).toHaveLength(1);
    expect(regions[0]!.outer).toMatchObject({ kind: "circle", radius: 12 });
    expect(regions[0]!.outerCircleId).toBeDefined();
  });

  it("splits a rectangle at a real diagonal into two triangular regions", () => {
    const regions = regionsFromSketch(diagonalRectangle());
    expect(regions).toHaveLength(2);
    expect(regions.map((region) => region.area).sort((a, b) => a - b)).toEqual([
      1200, 1200,
    ]);
    expect(regions.every((region) => region.holes.length === 0)).toBe(true);
  });

  it("exposes every depth of an island-in-a-hole nesting", () => {
    const outer = addRectangle(emptySketch(), [0, 0], [100, 60]);
    const withHole = addRectangle(outer, [10, 10], [90, 50]);
    const withIsland = addRectangle(withHole, [40, 25], [60, 35]);
    const regions = regionsFromSketch(withIsland);

    expect(regions).toHaveLength(3);
    const plate = regions.find((region) => region.depth === 0)!;
    const voidRing = regions.find((region) => region.depth === 1)!;
    const island = regions.find((region) => region.depth === 2)!;

    expect(plate.kind).toBe("material");
    expect(plate.holes).toHaveLength(1);
    expect(plate.area).toBeCloseTo(6000 - 3200, 4);

    expect(voidRing.kind).toBe("void");
    expect(voidRing.holes).toHaveLength(1);
    expect(voidRing.area).toBeCloseTo(3200 - 200, 4);

    expect(island.kind).toBe("material");
    expect(island.holes).toHaveLength(0);
    expect(island.area).toBeCloseTo(200, 4);
  });

  it("gives regions stable ids", () => {
    const rectangle = addRectangle(emptySketch(), [0, 0], [60, 40]);
    const first = regionsFromSketch(rectangle)[0]!;
    const second = regionsFromSketch(rectangle)[0]!;
    expect(first.id).toBe(second.id);
    expect(first.id).toMatch(/^reg-/);
  });
});
