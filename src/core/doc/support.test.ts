import { describe, expect, it } from "vitest";
import {
  flipFrame,
  frameFromHint,
  isDefaultSupport,
  stabilizeFrame,
  supportLabel,
  worldPlaneFrame,
} from "./support";
import type { PlaneFrame } from "../types";

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

const frame: PlaneFrame = {
  origin: [10, 20, 12],
  normal: [0, 0, 1],
  xAxis: [1, 0, 0],
  yAxis: [0, 1, 0],
};

describe("stable face frames", () => {
  it("flips the normal and Y axis while keeping the origin and X axis", () => {
    expect(flipFrame(frame)).toEqual({
      origin: [10, 20, 12],
      normal: [-0, -0, -1],
      xAxis: [1, 0, 0],
      yAxis: [-0, -1, -0],
    });
  });

  it("keeps the previous side when a face normal flips", () => {
    const flipped = flipFrame({ ...frame, origin: [10, 20, 30] });
    const stable = stabilizeFrame(flipped, frame);
    expect(stable.origin).toEqual([10, 20, 30]);
    expect(stable.normal).toEqual([0, 0, 1]);
    expect(stable.xAxis).toEqual([1, 0, 0]);
    expect(stable.yAxis).toEqual([0, 1, 0]);
  });

  it("accepts a genuinely different plane orientation", () => {
    const rotated: PlaneFrame = {
      origin: [0, 0, 0],
      normal: [1, 0, 0],
      xAxis: [0, 1, 0],
      yAxis: [0, 0, 1],
    };
    expect(stabilizeFrame(rotated, frame)).toEqual(rotated);
  });
});
