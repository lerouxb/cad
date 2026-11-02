import type { PlaneFrame, Vec2, Vec3 } from "../types";
import { newId, withReferences } from "./create";
import type { Sketch } from "./types";

/** Project a world point into the local sketch plane. */
export function projectPointToPlane(point: Vec3, frame: PlaneFrame): Vec2 {
  const dx = point[0] - frame.origin[0];
  const dy = point[1] - frame.origin[1];
  const dz = point[2] - frame.origin[2];
  return [
    dx * frame.xAxis[0] + dy * frame.xAxis[1] + dz * frame.xAxis[2],
    dx * frame.yAxis[0] + dy * frame.yAxis[1] + dz * frame.yAxis[2],
  ];
}

function uniqueLoop(loop: ReadonlyArray<Vec2>): Vec2[] {
  if (loop.length < 2) return [...loop];
  const first = loop[0]!;
  const last = loop[loop.length - 1]!;
  return Math.hypot(first[0] - last[0], first[1] - last[1]) < 1e-6
    ? loop.slice(0, -1)
    : [...loop];
}

function projectionPointCount(loops: ReadonlyArray<ReadonlyArray<Vec2>>): number {
  return loops.reduce((count, loop) => count + uniqueLoop(loop).length, 0);
}

/**
 * Replace one projection's fixed reference points/lines. Point and line ids are
 * deterministic from the projection id and loop/index, so an update with the
 * same topology keeps every user constraint attached.
 *
 * Returns null when the topology changed and the cached geometry should stay.
 */
export function applyProjectionGeometry(
  sketch: Sketch,
  projectionId: string,
  label: string,
  loops: ReadonlyArray<ReadonlyArray<Vec2>>,
  preserveCount = false,
): Sketch | null {
  const base = sketch.references ? sketch : withReferences(sketch);
  const references = base.references!;
  const oldPoints = references.points.filter(
    (point) => point.projectionId === projectionId,
  );
  if (preserveCount && oldPoints.length !== projectionPointCount(loops)) {
    return null;
  }

  const points = references.points.filter(
    (point) => point.projectionId !== projectionId,
  );
  const lines = references.lines.filter(
    (line) => line.projectionId !== projectionId,
  );

  loops.forEach((source, loopIndex) => {
    const loop = uniqueLoop(source);
    if (loop.length < 2) return;
    const ids = loop.map(([x, y], pointIndex) => {
      const id = `${projectionId}-p${loopIndex}-${pointIndex}`;
      points.push({
        id,
        x,
        y,
        fixed: true,
        reference: true,
        construction: true,
        projectionId,
        referenceLabel: label,
      });
      return id;
    });
    ids.forEach((id, index) => {
      const next = ids[(index + 1) % ids.length]!;
      lines.push({
        id: `${projectionId}-l${loopIndex}-${index}`,
        type: "line",
        a: id,
        b: next,
        construction: true,
        reference: true,
        projectionId,
        referenceLabel: label,
      });
    });
  });

  return {
    ...base,
    references: {
      ...references,
      points,
      lines,
    },
  };
}

export function newProjectionId(): string {
  return newId("proj");
}

/** Compare two projected loops within a small tessellation tolerance. */
export function sameProjectedLoops(
  a: ReadonlyArray<ReadonlyArray<Vec2>>,
  b: ReadonlyArray<ReadonlyArray<Vec2>>,
  tolerance = 1e-3,
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const left = a[i]!;
    const right = b[i]!;
    if (left.length !== right.length) return false;
    for (let j = 0; j < left.length; j++) {
      if (
        Math.abs(left[j]![0] - right[j]![0]) > tolerance ||
        Math.abs(left[j]![1] - right[j]![1]) > tolerance
      ) {
        return false;
      }
    }
  }
  return true;
}
