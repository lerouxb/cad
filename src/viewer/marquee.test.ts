import { describe, expect, it } from "vitest";
import {
  boxBetween,
  boxIsEmpty,
  pointInPolygon,
  polylineInBox,
  polylineTouchesPolygon,
  type ScreenPoint,
} from "./marquee";

const p = (x: number, y: number): ScreenPoint => ({ x, y });

describe("box marquee", () => {
  it("normalises a drag in any direction", () => {
    expect(boxBetween(p(10, 20), p(4, 8))).toEqual({
      minX: 4,
      minY: 8,
      maxX: 10,
      maxY: 20,
    });
  });

  it("is empty below a few pixels so a click is not a selection", () => {
    expect(boxIsEmpty(boxBetween(p(4, 4), p(5, 6)))).toBe(true);
    expect(boxIsEmpty(boxBetween(p(4, 4), p(40, 6)))).toBe(true);
    expect(boxIsEmpty(boxBetween(p(4, 4), p(40, 40)))).toBe(false);
  });

  it("selects a polyline only when every vertex is enclosed", () => {
    const box = boxBetween(p(0, 0), p(10, 10));
    expect(polylineInBox([p(2, 2), p(8, 8)], box)).toBe(true);
    expect(polylineInBox([p(2, 2), p(12, 8)], box)).toBe(false);
    // A single point is not a selectable edge.
    expect(polylineInBox([p(2, 2)], box)).toBe(false);
  });
});

describe("lasso selection", () => {
  const square = [p(0, 0), p(10, 0), p(10, 10), p(0, 10)];

  it("contains interior points and treats the boundary as inside", () => {
    expect(pointInPolygon(square, p(5, 5))).toBe(true);
    expect(pointInPolygon(square, p(0, 5))).toBe(true);
    expect(pointInPolygon(square, p(15, 5))).toBe(false);
  });

  it("turns a concave lasso into a real test, not a bounding box", () => {
    const chevron = [p(0, 0), p(10, 0), p(10, 10), p(5, 3), p(0, 10)];
    expect(pointInPolygon(chevron, p(5, 8))).toBe(false);
    expect(pointInPolygon(chevron, p(5, 1))).toBe(true);
  });

  it("selects a polyline it crosses even with no vertex inside", () => {
    expect(
      polylineTouchesPolygon([p(-5, 5), p(15, 5)], square),
    ).toBe(true);
    expect(
      polylineTouchesPolygon([p(-5, -5), p(-1, -1)], square),
    ).toBe(false);
  });

  it("selects a polyline fully inside without crossing the boundary", () => {
    expect(polylineTouchesPolygon([p(2, 2), p(8, 8)], square)).toBe(true);
  });
});
