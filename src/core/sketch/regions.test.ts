import { describe, expect, it } from "vitest";
import { addCircle, addPolyline, addRectangle, emptySketch } from "./create";
import { regionsFromSketch } from "./loops";
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
    expect(regions[0]).toMatchObject({ depth: 0, area: 2400 });
    expect(regions[0]!.outer.kind).toBe("polygon");
    expect(regions[0]!.holes).toHaveLength(0);
  });

  it("turns two disjoint rectangles into two regions", () => {
    const first = addRectangle(emptySketch(), [0, 0], [60, 40]);
    const both = addRectangle(first, [100, 0], [160, 40]);
    const regions = regionsFromSketch(both);
    expect(regions).toHaveLength(2);
    expect(regions.map((region) => region.area)).toEqual([2400, 2400]);
  });

  it("uses a nested circle as a hole, not a separate region", () => {
    const rectangle = addRectangle(emptySketch(), [0, 0], [100, 60]);
    const withHole = addCircle(rectangle, { point: [50, 30] }, 10);
    const regions = regionsFromSketch(withHole);

    expect(regions).toHaveLength(1);
    expect(regions[0]!.holes).toHaveLength(1);
    expect(regions[0]!.holes[0]).toMatchObject({ kind: "circle", radius: 10 });
    expect(regions[0]!.area).toBeCloseTo(6000 - Math.PI * 100, 4);
  });

  it("makes concentric circles a tube", () => {
    const outer = addCircle(emptySketch(), { point: [0, 0] }, 20);
    const tube = addCircle(outer, { point: [0, 0] }, 8);
    const regions = regionsFromSketch(tube);

    expect(regions).toHaveLength(1);
    expect(regions[0]!.holes).toHaveLength(1);
    expect(regions[0]!.area).toBeCloseTo(Math.PI * (20 * 20 - 8 * 8), 4);
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

  it("keeps an island inside a hole as a separate region", () => {
    const outer = addRectangle(emptySketch(), [0, 0], [100, 60]);
    const withHole = addRectangle(outer, [10, 10], [90, 50]);
    const withIsland = addRectangle(withHole, [40, 25], [60, 35]);
    const regions = regionsFromSketch(withIsland);

    expect(regions).toHaveLength(2);
    const [parent, island] = regions;
    expect(parent!.holes).toHaveLength(1);
    expect(parent!.area).toBeCloseTo(6000 - 3200, 4);
    expect(island!.depth).toBe(2);
    expect(island!.area).toBeCloseTo(200, 4);
  });

  it("gives regions stable ids", () => {
    const rectangle = addRectangle(emptySketch(), [0, 0], [60, 40]);
    const first = regionsFromSketch(rectangle)[0]!;
    const second = regionsFromSketch(rectangle)[0]!;
    expect(first.id).toBe(second.id);
    expect(first.id).toMatch(/^reg-/);
  });
});
