import { describe, expect, it } from "vitest";
import { frameFromHint, isDefaultSupport, supportLabel, worldPlaneFrame } from "./support";

describe("sketch supports", () => {
  it("builds an intuitive frame for a top face", () => {
    expect(
      frameFromHint({
        entityType: "face",
        normal: [0, 0, 1],
        centroid: [30, 20, 12],
      }),
    ).toEqual({
      origin: [30, 20, 12],
      normal: [0, 0, 1],
      xAxis: [1, 0, 0],
      yAxis: [0, 1, 0],
    });
  });

  it("builds a right-handed frame for a vertical face", () => {
    expect(
      frameFromHint({
        entityType: "face",
        normal: [1, 0, 0],
        centroid: [60, 20, 6],
      }),
    ).toEqual({
      origin: [60, 20, 6],
      normal: [1, 0, 0],
      xAxis: [0, 1, 0],
      yAxis: [0, 0, 1],
    });
  });

  it("refuses a face without a usable plane hint", () => {
    expect(frameFromHint({ entityType: "face" })).toBeNull();
    expect(
      frameFromHint({
        entityType: "face",
        normal: [0, 0, 0],
        centroid: [0, 0, 0],
      }),
    ).toBeNull();
  });

  it("labels world and face supports and identifies the default", () => {
    expect(supportLabel({ kind: "world", plane: "XY" })).toBe("XY");
    expect(
      supportLabel({
        kind: "face",
        ref: {
          source: "extrude",
          kind: "face",
          role: "top",
          hint: { entityType: "face" },
        },
        frame: worldPlaneFrame("XY"),
      }),
    ).toBe("Face · top");
    expect(isDefaultSupport({ kind: "world", plane: "XY" })).toBe(true);
    expect(isDefaultSupport({ kind: "world", plane: "XZ" })).toBe(false);
  });
});
