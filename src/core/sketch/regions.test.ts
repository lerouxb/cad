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
    expect(regions[0]).toMatchObject({ depth: 0, kind: "material", area: 2400 });
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
