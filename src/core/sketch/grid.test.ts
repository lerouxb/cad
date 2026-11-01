import { describe, expect, it } from "vitest";
import { formatGridStep, niceGridStep } from "./grid";

describe("adaptive sketch grid", () => {
  it("keeps minor cells readable at any zoom", () => {
    for (const scale of [0.05, 0.5, 1, 10, 100, 1000]) {
      const step = niceGridStep(scale);
      expect(step).toBeGreaterThan(0);
      expect(step * scale).toBeGreaterThanOrEqual(16);
      expect(step * scale).toBeLessThanOrEqual(40);
    }
  });

  it("uses the classic 1/2/5 sequence", () => {
    expect(niceGridStep(1)).toBe(20);
    expect(niceGridStep(10)).toBe(2);
    expect(niceGridStep(100)).toBe(0.2);
    expect(niceGridStep(0.5)).toBe(50);
    expect(niceGridStep(5)).toBe(5);
  });

  it("falls back safely for a missing or degenerate view", () => {
    expect(niceGridStep(0)).toBe(10);
    expect(niceGridStep(Number.NaN)).toBe(10);
  });

  it("formats steps without trailing zeros", () => {
    expect(formatGridStep(10)).toBe("10");
    expect(formatGridStep(0.1)).toBe("0.1");
    expect(formatGridStep(0.05)).toBe("0.05");
  });
});
