import { describe, expect, it } from "vitest";
import { createDemoModel } from "./demo";
import {
  applySolution,
  ensureCounterClockwise,
  signedArea,
  sketchGeometry,
  updateConstraintValue,
} from "./geometry";

const square = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
] as const;

describe("sketch geometry", () => {
  it("computes signed area with the right sign", () => {
    expect(signedArea(square)).toBeCloseTo(100);
    expect(signedArea([...square].reverse())).toBeCloseTo(-100);
  });

  it("normalises loops to counter-clockwise", () => {
    const clockwise = [...square].reverse();
    expect(signedArea(ensureCounterClockwise(clockwise))).toBeCloseTo(100);
  });

  it("reads the authored document as geometry", () => {
    const { sketch } = createDemoModel();
    const geometry = sketchGeometry(sketch);

    expect(geometry.points.p1).toEqual([30, -20]);
    expect(geometry.radii.hole).toBe(8);
  });

  it("writes solver output back into the document without mutating it", () => {
    const { sketch } = createDemoModel();
    const next = applySolution(sketch, {
      points: { p1: [80, 0], p2: [80, 50] },
      radii: { hole: 12 },
    });

    expect(sketch.points.find((p) => p.id === "p1")?.x).toBe(30);
    expect(next.points.find((p) => p.id === "p1")?.x).toBe(80);
    expect(next.curves.find((c) => c.id === "hole")).toMatchObject({ radius: 12 });
  });

  it("updates only the targeted dimension", () => {
    const { sketch } = createDemoModel({ width: 60, height: 40, holeDiameter: 16, constrained: true });
    const next = updateConstraintValue(sketch, "dim-width", 72);

    expect(next.constraints.find((c) => c.id === "dim-width")).toMatchObject({ value: 72 });
    expect(next.constraints.find((c) => c.id === "dim-height")).toMatchObject({ value: 40 });
    expect(sketch.constraints.find((c) => c.id === "dim-width")).toMatchObject({ value: 60 });
  });
});
