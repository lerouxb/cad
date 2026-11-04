import { describe, expect, it } from "vitest";
import { DEMO_MAX_HEIGHT, DEMO_MAX_WIDTH, clampDemoDrag, createDemoModel } from "./demo";

describe("demo drag clamps", () => {
  const { sketch } = createDemoModel();

  it("stops the bottom-right corner at the minimum width (hole clearance)", () => {
    const target = clampDemoDrag(sketch, "p1", [-500, 0]);
    // Hole Ø16 needs 6 mm of material, so the full width is at least 22 mm;
    // the centred rectangle stores half of it.
    expect(target[0]).toBe(11);
    expect(target[1]).toBe(-20);
  });

  it("stops the bottom-right corner at the maximum width", () => {
    const target = clampDemoDrag(sketch, "p1", [500, 0]);
    expect(target[0]).toBe(DEMO_MAX_WIDTH / 2);
  });

  it("clamps the top-right corner in both axes but keeps it reachable", () => {
    const target = clampDemoDrag(sketch, "p2", [70, 500]);
    expect(target[0]).toBe(DEMO_MAX_WIDTH / 2);
    expect(target[1]).toBe(DEMO_MAX_HEIGHT / 2);
  });

  it("only lets the top-left corner change height", () => {
    const target = clampDemoDrag(sketch, "p3", [40, 50]);
    expect(target[0]).toBe(-30);
    expect(target[1]).toBe(DEMO_MAX_HEIGHT / 2);
  });
});
