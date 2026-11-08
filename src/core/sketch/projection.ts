import type { PlaneFrame, Vec2, Vec3 } from "../types";
import { newId, withReferences } from "./create";
import { circumcenter } from "./geometry";
import type { Sketch, SketchCircle } from "./types";

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

/**
 * A projected face boundary sampled from a circular edge is a dense, closed,
 * equidistant polygon. Keep that analytic so a point can be constrained with
 * point-on-circle (and dragged around the circle) instead of a chord.
 *
 * The three-point circumcentre makes the test insensitive to slightly
 * non-uniform sampling; a projection that makes the circle elliptical fails the
 * radius check and stays a polyline.
 */
export function projectedCircle(
  loop: ReadonlyArray<Vec2>,
): { center: Vec2; radius: number } | null {
  const points = uniqueLoop(loop);
  if (points.length < 12) return null;
  const first = points[0]!;
  const second = points[Math.floor(points.length / 3)]!;
  const third = points[Math.floor((points.length * 2) / 3)]!;
  const center = circumcenter(first, second, third);
  if (!center) return null;
  let radiusSum = 0;
  let radiusMin = Infinity;
  let radiusMax = 0;
  for (const point of points) {
    const radius = Math.hypot(point[0] - center[0], point[1] - center[1]);
    radiusSum += radius;
    radiusMin = Math.min(radiusMin, radius);
    radiusMax = Math.max(radiusMax, radius);
  }
  const radius = radiusSum / points.length;
  if (radius < 1e-6) return null;
  if (radiusMax - radiusMin > Math.max(1e-3, radius * 1e-3)) return null;
  return { center, radius };
}

function projectionPointCount(loops: ReadonlyArray<ReadonlyArray<Vec2>>): number {
  return loops.reduce(
    (count, loop) =>
      count +
      (projectedCircle(loop) ? 1 : uniqueLoop(loop).length),
    0,
  );
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
  const oldLines = references.lines.filter(
    (line) => line.projectionId === projectionId,
  );
  const oldConstruction = new Map(
    oldLines.map((line) => [line.id, line.construction]),
  );
  const lines = references.lines.filter(
    (line) => line.projectionId !== projectionId,
  );
  const oldCircles = (references.circles ?? []).filter(
    (circle) => circle.projectionId === projectionId,
  );
  const oldCircleConstruction = new Map(
    oldCircles.map((circle) => [circle.id, circle.construction]),
  );
  const circles = (references.circles ?? []).filter(
    (circle) => circle.projectionId !== projectionId,
  );

  loops.forEach((source, loopIndex) => {
    const loop = uniqueLoop(source);
    if (loop.length < 2) return;
    const analytic = projectedCircle(loop);
    if (analytic) {
      const centerId = `${projectionId}-c${loopIndex}`;
      const circleId = `${projectionId}-circle${loopIndex}`;
      const [x, y] = analytic.center;
      points.push({
        id: centerId,
        x,
        y,
        fixed: true,
        reference: true,
        construction: true,
        projectionId,
        referenceLabel: label,
      });
      const circle: SketchCircle = {
        id: circleId,
        type: "circle",
        center: centerId,
        radius: analytic.radius,
        construction: oldCircleConstruction.get(circleId) ?? true,
        reference: true,
        projectionId,
        referenceLabel: label,
      };
      circles.push(circle);
      return;
    }
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
      const lineId = `${projectionId}-l${loopIndex}-${index}`;
      lines.push({
        id: lineId,
        type: "line",
        a: id,
        b: next,
        construction: oldConstruction.get(lineId) ?? true,
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
      circles,
    },
  };
}

/**
 * Does any user geometry or constraint already refer to this projection's
 * materialized ids? Such a projection cannot be re-represented (polyline to
 * circle) without dropping those references, so it stays as it is.
 */
export function projectionHasDependents(
  sketch: Sketch,
  projectionId: string,
): boolean {
  const ids = new Set<string>();
  for (const point of sketch.references?.points ?? []) {
    if (point.projectionId === projectionId) ids.add(point.id);
  }
  for (const line of sketch.references?.lines ?? []) {
    if (line.projectionId === projectionId) ids.add(line.id);
  }
  for (const circle of sketch.references?.circles ?? []) {
    if (circle.projectionId === projectionId) ids.add(circle.id);
  }
  if (ids.size === 0) return false;
  for (const constraint of sketch.constraints) {
    for (const value of Object.values(constraint)) {
      if (typeof value === "string" && ids.has(value)) return true;
    }
  }
  for (const point of sketch.points) {
    if (ids.has(point.id)) return true;
  }
  for (const curve of sketch.curves) {
    if (curve.type === "line") {
      if (ids.has(curve.a) || ids.has(curve.b)) return true;
    } else if (curve.type === "circle") {
      if (ids.has(curve.center)) return true;
    } else if (
      ids.has(curve.center) ||
      ids.has(curve.start) ||
      ids.has(curve.end)
    ) {
      return true;
    }
  }
  return false;
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
