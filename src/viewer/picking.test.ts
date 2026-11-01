import { describe, expect, it } from "vitest";
import type { BodyMesh, EdgeGroup, FaceGroup } from "../core/kernel/protocol";
import {
  edgeGroupForVertex,
  edgePick,
  edgePositionsForGroup,
  edgeUnitForMesh,
  edgeVertexRange,
  faceGroupForTriangle,
  facePick,
} from "./picking";

const faceGroups: FaceGroup[] = [
  { start: 0, count: 3, faceId: 11, origin: 101 },
  { start: 3, count: 6, faceId: 12, origin: 102 },
];

function edges(
  edgePositions: Float32Array,
  edgeGroups: EdgeGroup[],
): Pick<BodyMesh, "edgePositions" | "edgeGroups"> {
  return { edgePositions, edgeGroups };
}

describe("body picking groups", () => {
  it("maps a triangle index to its face group", () => {
    expect(faceGroupForTriangle({ faceGroups }, 0)?.faceId).toBe(11);
    expect(faceGroupForTriangle({ faceGroups }, 1)?.faceId).toBe(12);
    expect(faceGroupForTriangle({ faceGroups }, 2)?.faceId).toBe(12);
    expect(faceGroupForTriangle({ faceGroups }, 3)).toBeNull();
  });

  it("maps segment-index edge groups", () => {
    const mesh = edges(new Float32Array(4 * 6), [
      { start: 0, count: 2, edgeId: 21 },
      { start: 2, count: 2, edgeId: 22 },
    ]);
    expect(edgeUnitForMesh(mesh)).toBe("segment");
    expect(edgeGroupForVertex(mesh, 1)?.edgeId).toBe(21);
    expect(edgeGroupForVertex(mesh, 2)?.edgeId).toBe(21);
    expect(edgeGroupForVertex(mesh, 4)?.edgeId).toBe(22);
    expect(edgeGroupForVertex(mesh, 7)?.edgeId).toBe(22);
    expect(edgeGroupForVertex(mesh, 8)).toBeNull();
    expect(edgeVertexRange(mesh.edgeGroups[0]!, "segment")).toEqual({
      start: 0,
      count: 4,
    });
  });

  it("maps vertex-index edge groups", () => {
    const mesh = edges(new Float32Array(4 * 6), [
      { start: 0, count: 4, edgeId: 31 },
      { start: 4, count: 4, edgeId: 32 },
    ]);
    expect(edgeUnitForMesh(mesh)).toBe("vertex");
    expect(edgeGroupForVertex(mesh, 2)?.edgeId).toBe(31);
    expect(edgeGroupForVertex(mesh, 5)?.edgeId).toBe(32);
    expect(edgeGroupForVertex(mesh, 8)).toBeNull();
    expect(edgeVertexRange(mesh.edgeGroups[1]!, "vertex")).toEqual({
      start: 4,
      count: 4,
    });
  });

  it("slices edge positions for highlighting", () => {
    const positions = new Float32Array(24);
    positions.set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 0);
    const mesh = edges(positions, [{ start: 0, count: 2, edgeId: 41 }]);
    expect(Array.from(edgePositionsForGroup(mesh, mesh.edgeGroups[0]!, "segment"))).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
  });

  it("builds stable ephemeral pick ids from hashes/origins", () => {
    expect(facePick(faceGroups[1]!)).toEqual({
      kind: "face",
      id: "face-12",
      faceId: 12,
      origin: 102,
    });
    expect(edgePick({ start: 0, count: 1, edgeId: 77 })).toEqual({
      kind: "edge",
      id: "edge-77",
      edgeId: 77,
    });
  });
});
