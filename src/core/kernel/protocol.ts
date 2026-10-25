import type { ProfileLoop } from "../types";

export type { ProfileLoop };

export interface ExtrudeParams {
  outer: ProfileLoop;
  holes: ProfileLoop[];
  height: number;
}

export interface FaceGroup {
  /** Start index in the triangle index buffer. */
  start: number;
  /** Number of indices in this group. */
  count: number;
  faceId: number;
  /** brepjs face-origin id, the basis for stable references later. */
  origin: number;
}

export interface EdgeGroup {
  /** Start vertex index in `edgePositions` (2 vertices per segment). */
  start: number;
  count: number;
  edgeId: number;
}

export interface BodyStats {
  faces: number;
  edges: number;
  triangles: number;
  volume: number;
  buildMs: number;
}

/** Renderable output of one rebuild. Typed arrays are transferred, not copied. */
export interface BodyMesh {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  faceGroups: FaceGroup[];
  edgePositions: Float32Array;
  edgeGroups: EdgeGroup[];
  stats: BodyStats;
}

export type KernelRequest =
  | { type: "init" }
  | { type: "rebuild"; gen: number; params: ExtrudeParams };

export type KernelResponse =
  | { type: "ready"; kernel: string }
  | { type: "result"; gen: number; mesh: BodyMesh }
  | { type: "error"; gen: number; message: string };
