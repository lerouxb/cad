import { describe, expect, it } from "vitest";
import { planarArrangement } from "./arrangement";
import { addArc, addPolyline, emptySketch } from "./create";
import { regionsFromSketch } from "./loops";
import { allPoints, type Sketch } from "./types";

function pointIdAt(sketch: Sketch, x: number, y: number): string {
  const point = allPoints(sketch).find(
    (candidate) =>
      Math.abs(candidate.x - x) < 1e-9 && Math.abs(candidate.y - y) < 1e-9,
  );
  if (!point) throw new Error(`No point at ${x}, ${y}`);
  return point.id;
}

function rectangleWithDiagonals(): Sketch {
  let sketch = emptySketch();
  sketch = addPolyline(
    sketch,
    [
      { point: [-30, -20] },
      { point: [30, -20] },
      { point: [30, 20] },
      { point: [-30, 20] },
    ],
    true,
  );
  sketch = addPolyline(
    sketch,
    [
      { point: [-30, -20], existingPointId: pointIdAt(sketch, -30, -20) },
      { point: [30, 20], existingPointId: pointIdAt(sketch, 30, 20) },
    ],
    false,
  );
  sketch = addPolyline(
    sketch,
    [
      { point: [30, -20], existingPointId: pointIdAt(sketch, 30, -20) },
      { point: [-30, 20], existingPointId: pointIdAt(sketch, -30, 20) },
    ],
    false,
  );
  return sketch;
}

describe("planar arrangement", () => {
  it("splits two crossing diagonals into four triangular regions", () => {
    const sketch = rectangleWithDiagonals();
    const arrangement = planarArrangement(sketch);

    // Four rectangle sides plus four half-diagonals around the centre.
    expect(arrangement.pieces).toHaveLength(8);
    expect(arrangement.nodes.size).toBe(5);

    const regions = regionsFromSketch(sketch);
    expect(regions).toHaveLength(4);
    for (const region of regions) {
      expect(region.area).toBeCloseTo(600, 6);
      expect(region.holes).toHaveLength(0);
    }
  });

  it("keeps a simple rectangle whole (original curve ids survive)", () => {
    const sketch = addPolyline(
      emptySketch(),
      [
        { point: [0, 0] },
        { point: [40, 0] },
        { point: [40, 30] },
        { point: [0, 30] },
      ],
      true,
    );
    const arrangement = planarArrangement(sketch);
    expect(arrangement.pieces).toHaveLength(4);
    expect(arrangement.pieces.map((piece) => piece.id)).toEqual(
      sketch.curves.map((curve) => curve.id),
    );
  });

  it("splits a line and an arc at both crossings", () => {
    let sketch = emptySketch();
    sketch = addArc(
      sketch,
      { point: [-10, 0] },
      { point: [10, 0] },
      [0, 10],
    );
    sketch = addPolyline(
      sketch,
      [
        { point: [-15, 5] },
        { point: [15, 5] },
      ],
      false,
    );

    const arrangement = planarArrangement(sketch);
    const arc = sketch.curves.find((curve) => curve.type === "arc")!;
    const line = sketch.curves.find((curve) => curve.type === "line")!;

    expect(arrangement.bySource.get(arc.id)).toHaveLength(3);
    expect(arrangement.bySource.get(line.id)).toHaveLength(3);
    expect(arrangement.pieces).toHaveLength(6);
  });

  it("splits at a T-junction without a curve/curve crossing", () => {
    let sketch = emptySketch();
    sketch = addPolyline(
      sketch,
      [
        { point: [-30, 20] },
        { point: [30, 20] },
      ],
      false,
    );
    const top = sketch.curves[0]!;
    sketch = addPolyline(
      sketch,
      [
        { point: [0, 0] },
        { point: [0, 20] },
      ],
      false,
    );

    const arrangement = planarArrangement(sketch);
    expect(arrangement.bySource.get(top.id)).toHaveLength(2);
    const shared = arrangement.bySource
      .get(top.id)!
      .map((piece) => [piece.start, piece.end])
      .flat();
    expect(shared).toContain(pointIdAt(sketch, 0, 20));
  });
});
