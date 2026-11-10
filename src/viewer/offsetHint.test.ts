import { describe, expect, it } from "vitest";
import type { BodyMesh, TopoRef } from "../core/kernel/protocol";
import { offsetHintFor } from "./offsetHint";

function quadMesh(ref: TopoRef): BodyMesh {
  return {
    positions: new Float32Array([
      0, 0, 0,
      1, 0, 0,
      1, 1, 0,
      0, 1, 0,
    ]),
    normals: new Float32Array(12),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    faceGroups: [{ start: 0, count: 6, faceId: 0, origin: 0, ref }],
    edgePositions: new Float32Array(),
    edgeGroups: [],
    stats: {
      faces: 1,
      edges: 0,
      triangles: 2,
      volume: 1,
      buildMs: 0,
      bodies: 1,
      shells: 1,
      valid: true,
      bounds: [0, 0, 0, 1, 1, 0],
    },
  };
}

const ref: TopoRef = {
  source: "feature",
  kind: "face",
  role: "extrude:face_1",
  hint: {
    entityType: "face",
    surfaceType: "PLANE",
    normal: [0, 0, 1],
    centroid: [0.5, 0.5, 0],
  },
};

describe("offset hint", () => {
  it("draws the source boundary and a normal arrow", () => {
    const hint = offsetHintFor(quadMesh(ref), [ref], 2);
    expect(hint).not.toBeNull();
    // Four quad edges, two vertices each.
    expect(hint!.boundary).toHaveLength(4 * 2 * 3);
    expect(hint!.arrows).toHaveLength(1);
    expect(hint!.arrows[0]!.origin[0]).toBeCloseTo(2 / 3, 6);
    expect(hint!.arrows[0]!.origin[1]).toBeCloseTo(1 / 3, 6);
    expect(hint!.arrows[0]!.origin[2]).toBeCloseTo(0, 6);
    expect(hint!.arrows[0]!.direction).toEqual([0, 0, 1]);
    expect(hint!.arrows[0]!.length).toBe(2);
  });

  it("flips the arrow for an inward move", () => {
    const hint = offsetHintFor(quadMesh(ref), [ref], -3);
    expect(hint!.arrows[0]!.direction[0]).toBeCloseTo(0, 6);
    expect(hint!.arrows[0]!.direction[1]).toBeCloseTo(0, 6);
    expect(hint!.arrows[0]!.direction[2]).toBe(-1);
    expect(hint!.arrows[0]!.length).toBe(3);
  });

  it("returns null when the source face is not in the ghost mesh", () => {
    expect(offsetHintFor(quadMesh(ref), [], 1)).toBeNull();
    const missing: TopoRef = { ...ref, role: "extrude:face_9" };
    expect(offsetHintFor(quadMesh(ref), [missing], 1)).toBeNull();
  });
});
