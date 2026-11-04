import type {
  BodyMesh,
  EdgeGroup,
  EdgeRef,
  FaceGroup,
  TopoRef,
} from "../core/kernel/protocol";
import { edgeRefKey } from "../core/kernel/protocol";

/** Ephemeral body selection. Never persisted in the document. */
export interface BodyPick {
  kind: "face" | "edge" | "datum";
  /** Stable id derived from the brepjs origin/hash, not an array index. */
  id: string;
  faceId?: number;
  origin?: number;
  edgeId?: number;
  /** Datum-plane feature id for a datum pick. */
  datumId?: string;
  /** Stable role+hint reference created by the worker for a face. */
  ref?: TopoRef;
  /** Stable face-pair reference created by the worker for an edge. */
  edgeRef?: EdgeRef;
}

export type EdgeUnit = "segment" | "vertex";

export function faceGroupForTriangle(
  mesh: Pick<BodyMesh, "faceGroups">,
  triangleIndex: number,
): FaceGroup | null {
  const index = triangleIndex * 3;
  return (
    mesh.faceGroups.find(
      (group) => index >= group.start && index < group.start + group.count,
    ) ?? null
  );
}

/**
 * OCCT's edge groups use either segment indices or vertex indices depending on
 * the kernel build. Detect it from the data so picking works across kernels.
 */
export function edgeUnitForMesh(
  mesh: Pick<BodyMesh, "edgePositions" | "edgeGroups">,
): EdgeUnit {
  if (mesh.edgeGroups.length === 0) return "segment";
  const totalSegments = Math.floor(mesh.edgePositions.length / 6);
  const maxEnd = Math.max(
    ...mesh.edgeGroups.map((group) => group.start + group.count),
  );
  return maxEnd <= totalSegments ? "segment" : "vertex";
}

/** `vertexIndex` is the LineSegments intersection index (start vertex of a pair). */
export function edgeGroupForVertex(
  mesh: Pick<BodyMesh, "edgePositions" | "edgeGroups">,
  vertexIndex: number,
  unit: EdgeUnit = edgeUnitForMesh(mesh),
): EdgeGroup | null {
  for (const group of mesh.edgeGroups) {
    const start = unit === "segment" ? group.start * 2 : group.start;
    const end =
      unit === "segment"
        ? (group.start + group.count) * 2
        : group.start + group.count;
    if (vertexIndex >= start && vertexIndex < end) return group;
  }
  return null;
}

/** Vertex range for one edge group, normalized to `edgePositions` vertices. */
export function edgeVertexRange(
  group: EdgeGroup,
  unit: EdgeUnit,
): { start: number; count: number } {
  return unit === "segment"
    ? { start: group.start * 2, count: group.count * 2 }
    : { start: group.start, count: group.count };
}

export function edgePositionsForGroup(
  mesh: Pick<BodyMesh, "edgePositions">,
  group: EdgeGroup,
  unit: EdgeUnit,
): Float32Array {
  const range = edgeVertexRange(group, unit);
  return mesh.edgePositions.slice(
    range.start * 3,
    (range.start + range.count) * 3,
  );
}

export function facePick(group: FaceGroup): BodyPick {
  return {
    kind: "face",
    id: `face-${group.faceId}`,
    faceId: group.faceId,
    origin: group.origin,
    ...(group.ref ? { ref: group.ref } : {}),
  };
}

export function edgePick(group: EdgeGroup): BodyPick {
  return {
    kind: "edge",
    // A role key survives a rebuild; the hash-based edgeId does not.
    id: group.ref ? `edge-${edgeRefKey(group.ref)}` : `edge-${group.edgeId}`,
    edgeId: group.edgeId,
    ...(group.ref ? { edgeRef: group.ref } : {}),
  };
}

export function datumPick(featureId: string): BodyPick {
  return {
    kind: "datum",
    id: `datum-${featureId}`,
    datumId: featureId,
  };
}
