import { describe, expect, it } from "vitest";
import { addCircle, addPolyline, addRectangle, emptySketch } from "./create";
import { createDemoModel } from "./demo";
import { findLoops, profileFromSketch } from "./loops";
import type { Sketch } from "./types";

describe("loop extraction", () => {
  it("finds a rectangle drawn by the rectangle tool", () => {
    const sketch = addRectangle(emptySketch(), [0, 0], [60, 40]);
    const loops = findLoops(sketch);

    expect(loops).toHaveLength(1);
    expect(loops[0]!.points).toHaveLength(4);
    expect(loops[0]!.area).toBeCloseTo(2400);
  });

  it("finds a closed polyline and ignores an open one", () => {
    const open = addPolyline(
      emptySketch(),
      [{ point: [0, 0] }, { point: [60, 0] }, { point: [60, 40] }],
      false,
    );
    expect(findLoops(open)).toHaveLength(0);

    const closed = addPolyline(
      emptySketch(),
      [{ point: [0, 0] }, { point: [60, 0] }, { point: [60, 40] }],
      true,
    );
    const loops = findLoops(closed);
    expect(loops).toHaveLength(1);
    expect(loops[0]!.area).toBeCloseTo(1200);
  });

  it("finds several loops and sorts them by area", () => {
    const first = addRectangle(emptySketch(), [0, 0], [20, 10]);
    const both = addRectangle(first, [100, 0], [160, 40]);
    const loops = findLoops(both);

    expect(loops).toHaveLength(2);
    expect(loops[0]!.area).toBeGreaterThan(loops[1]!.area);
  });

  it("ignores construction geometry", () => {
    const withDiagonal = addPolyline(
      emptySketch(),
      [
        { point: [0, 0] },
        { point: [60, 0] },
        { point: [60, 40] },
        { point: [0, 40] },
        { point: [0, 0] },
        { point: [60, 40] },
      ],
      false,
    );
    // The last segment is diagonal, so it creates triangles plus the outer
    // rectangle. That is fine: the largest loop is still the rectangle.
    const loops = findLoops(withDiagonal);
    expect(loops[0]!.area).toBeCloseTo(2400);
    // A construction diagonal is excluded entirely.
    const demo = createDemoModel();
    expect(findLoops(demo.sketch)).toHaveLength(1);
  });

  it("uses circles inside the outer loop as holes", () => {
    const rectangle = addRectangle(emptySketch(), [0, 0], [60, 40]);
    const withHole = addCircle(rectangle, { point: [30, 20] }, 8);

    const profile = profileFromSketch(withHole);
    expect(profile).not.toBeNull();
    expect(profile!.outer.kind).toBe("polygon");
    expect(profile!.holes).toHaveLength(1);
    expect(profile!.holes[0]).toMatchObject({ kind: "circle", radius: 8 });
  });

  it("does not use circles outside the outer loop", () => {
    const rectangle = addRectangle(emptySketch(), [0, 0], [60, 40]);
    const withOutside = addCircle(rectangle, { point: [200, 200] }, 8);
    expect(profileFromSketch(withOutside)?.holes).toHaveLength(0);
  });

  it("returns null when there is no closed profile", () => {
    const sketch: Sketch = emptySketch();
    expect(profileFromSketch(sketch)).toBeNull();
    expect(profileFromSketch(addRectangle(sketch, [0, 0], [0, 0]))).toBeNull();
  });
});
