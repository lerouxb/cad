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

  it("uses a lone circle as the outer profile", () => {
    const sketch = addCircle(emptySketch(), { point: [0, 0] }, 12);
    const profile = profileFromSketch(sketch);

    expect(profile).not.toBeNull();
    expect(profile!.outer).toMatchObject({ kind: "circle", radius: 12 });
    expect(profile!.holes).toHaveLength(0);
    expect(profile!.outerCircleId).toBe(sketch.curves[0]!.id);
  });

  it("makes concentric circles a tube", () => {
    const outer = addCircle(emptySketch(), { point: [0, 0] }, 20);
    const tube = addCircle(outer, { point: [0, 0] }, 8);

    const profile = profileFromSketch(tube);
    expect(profile!.outer).toMatchObject({ kind: "circle", radius: 20 });
    expect(profile!.holes).toHaveLength(1);
    expect(profile!.holes[0]).toMatchObject({ kind: "circle", radius: 8 });
  });

  it("uses a nested line loop as a hole", () => {
    const outer = addRectangle(emptySketch(), [0, 0], [100, 60]);
    const withHole = addRectangle(outer, [30, 20], [70, 40]);

    const profile = profileFromSketch(withHole);
    expect(profile!.outer).toMatchObject({ kind: "polygon" });
    expect(profile!.holes).toHaveLength(1);
    expect(profile!.holes[0]).toMatchObject({ kind: "polygon" });
  });

  it("does not treat a subdivision loop as a hole", () => {
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
    expect(profileFromSketch(withDiagonal)?.holes).toHaveLength(0);
  });

  it("uses a line loop inside a circle as a hole", () => {
    const circle = addCircle(emptySketch(), { point: [0, 0] }, 50);
    const withRect = addRectangle(circle, [-10, -10], [10, 10]);

    const profile = profileFromSketch(withRect);
    expect(profile!.outer).toMatchObject({ kind: "circle", radius: 50 });
    expect(profile!.holes).toHaveLength(1);
    expect(profile!.holes[0]).toMatchObject({ kind: "polygon" });
  });

  it("keeps only one level of nesting (no island inside a hole)", () => {
    const outer = addRectangle(emptySketch(), [0, 0], [100, 60]);
    const hole = addRectangle(outer, [20, 10], [80, 50]);
    const island = addRectangle(hole, [40, 25], [60, 35]);

    const profile = profileFromSketch(island);
    expect(profile!.holes).toHaveLength(1);
  });

  it("prefers the larger region when a circle and a line loop compete", () => {
    const rectangle = addRectangle(emptySketch(), [0, 0], [20, 10]);
    const withBigCircle = addCircle(rectangle, { point: [100, 100] }, 20);

    const profile = profileFromSketch(withBigCircle);
    expect(profile!.outer).toMatchObject({ kind: "circle", radius: 20 });
  });

  it("returns null when there is no closed profile", () => {
    const sketch: Sketch = emptySketch();
    expect(profileFromSketch(sketch)).toBeNull();
    expect(profileFromSketch(addRectangle(sketch, [0, 0], [0, 0]))).toBeNull();
  });
});
