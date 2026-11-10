import type { BodyMesh, TopoRef } from "../core/kernel/protocol";
import { faceRefKey } from "../core/kernel/protocol";

export interface OffsetHint {
  /** Source-face boundary segments, xyz pairs. */
  boundary: Float32Array;
  arrows: Array<{
    origin: [number, number, number];
    direction: [number, number, number];
    length: number;
  }>;
}

/**
 * The offset draft hint: the selected face's original boundary (dashed) and one
 * normal arrow per selected face. The caller passes the pre-offset ghost mesh,
 * so the boundary stays where the input face was, not on the preview result.
 */
export function offsetHintFor(
  mesh: BodyMesh,
  faces: readonly TopoRef[],
  distance: number,
): OffsetHint | null {
  if (faces.length === 0) return null;
  const wanted = new Set(faces.map(faceRefKey));
  const groups = mesh.faceGroups.filter(
    (group) => group.ref !== undefined && wanted.has(faceRefKey(group.ref)),
  );
  if (groups.length === 0) return null;

  const boundary: number[] = [];
  const arrowPoint = new Map<
    string,
    { origin: [number, number, number]; normal: [number, number, number] }
  >();
  for (const group of groups) {
    const key = group.ref ? faceRefKey(group.ref) : "";
    const counts = new Map<string, number>();
    const positions = new Map<string, number[]>();
    for (let index = group.start; index < group.start + group.count; index += 3) {
      const a = mesh.indices[index]!;
      const b = mesh.indices[index + 1]!;
      const c = mesh.indices[index + 2]!;
      if (key !== "" && !arrowPoint.has(key)) {
        const ax = mesh.positions[a * 3]!;
        const ay = mesh.positions[a * 3 + 1]!;
        const az = mesh.positions[a * 3 + 2]!;
        const bx = mesh.positions[b * 3]!;
        const by = mesh.positions[b * 3 + 1]!;
        const bz = mesh.positions[b * 3 + 2]!;
        const cx = mesh.positions[c * 3]!;
        const cy = mesh.positions[c * 3 + 1]!;
        const cz = mesh.positions[c * 3 + 2]!;
        const nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
        const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
        const nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
        const length = Math.hypot(nx, ny, nz);
        if (length > 1e-9) {
          arrowPoint.set(key, {
            origin: [
              (ax + bx + cx) / 3,
              (ay + by + cy) / 3,
              (az + bz + cz) / 3,
            ],
            normal: [nx / length, ny / length, nz / length],
          });
        }
      }
      for (const [u, v] of [
        [a, b],
        [b, c],
        [c, a],
      ] as const) {
        const edgeKey = u < v ? `${u}:${v}` : `${v}:${u}`;
        counts.set(edgeKey, (counts.get(edgeKey) ?? 0) + 1);
        if (!positions.has(edgeKey)) {
          positions.set(edgeKey, [
            mesh.positions[u * 3]!,
            mesh.positions[u * 3 + 1]!,
            mesh.positions[u * 3 + 2]!,
            mesh.positions[v * 3]!,
            mesh.positions[v * 3 + 1]!,
            mesh.positions[v * 3 + 2]!,
          ]);
        }
      }
    }
    for (const [edgeKey, count] of counts) {
      if (count !== 1) continue;
      boundary.push(...positions.get(edgeKey)!);
    }
  }

  const arrows: OffsetHint["arrows"] = [];
  const seen = new Set<string>();
  for (const ref of faces) {
    const key = faceRefKey(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    const point = arrowPoint.get(key);
    const normal = point?.normal ?? ref.hint.normal;
    const centroid = point?.origin ?? ref.hint.centroid;
    if (!normal || !centroid || distance === 0) continue;
    const length = Math.hypot(normal[0], normal[1], normal[2]);
    if (length < 1e-9) continue;
    const sign = distance < 0 ? -1 : 1;
    arrows.push({
      origin: [centroid[0], centroid[1], centroid[2]],
      direction: [
        (normal[0] / length) * sign,
        (normal[1] / length) * sign,
        (normal[2] / length) * sign,
      ],
      length: Math.abs(distance),
    });
  }

  if (boundary.length === 0 && arrows.length === 0) return null;
  return { boundary: new Float32Array(boundary), arrows };
}
