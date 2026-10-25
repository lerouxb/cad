import type { Sketch } from "./types";

/**
 * Pure structural edits that are not about creating geometry.
 *
 * Deletion has to keep the model coherent: constraints must never point at
 * geometry that no longer exists, and points that only existed to define a
 * deleted curve should disappear with it. Shared endpoints survive because
 * another curve still uses them.
 */
export function deleteEntities(sketch: Sketch, ids: readonly string[]): Sketch {
  if (ids.length === 0) return sketch;

  const curveIds = new Set(sketch.curves.map((curve) => curve.id));
  const pointIds = new Set(sketch.points.map((point) => point.id));
  const selectedCurves = new Set(ids.filter((id) => curveIds.has(id)));
  const selectedPoints = new Set(ids.filter((id) => pointIds.has(id)));
  if (selectedCurves.size === 0 && selectedPoints.size === 0) return sketch;

  // Deleting a point deletes every curve that depends on it: a line endpoint or
  // a circle centre. That is what makes deleting a corner also remove its edges.
  const doomedCurves = new Set(selectedCurves);
  for (const curve of sketch.curves) {
    if (curve.type === "line") {
      if (selectedPoints.has(curve.a) || selectedPoints.has(curve.b)) {
        doomedCurves.add(curve.id);
      }
    } else if (selectedPoints.has(curve.center)) {
      doomedCurves.add(curve.id);
    }
  }

  const curves = sketch.curves.filter((curve) => !doomedCurves.has(curve.id));

  const usedPoints = new Set<string>();
  for (const curve of curves) {
    if (curve.type === "line") {
      usedPoints.add(curve.a);
      usedPoints.add(curve.b);
    } else {
      usedPoints.add(curve.center);
    }
  }

  // Fixed points are reference geometry (the sketch origin, projected edges):
  // they stay even when nothing currently uses them. Everything else survives
  // only if a remaining curve still refers to it.
  const points = sketch.points.filter((point) => {
    if (selectedPoints.has(point.id)) return false;
    return point.fixed === true || usedPoints.has(point.id);
  });
  const keptPoints = new Set(points.map((point) => point.id));

  const constraints = sketch.constraints.filter((constraint) => {
    switch (constraint.type) {
      case "coincident":
        return keptPoints.has(constraint.a) && keptPoints.has(constraint.b);
      case "horizontal":
      case "vertical":
        return !doomedCurves.has(constraint.line);
      case "distance":
        return keptPoints.has(constraint.a) && keptPoints.has(constraint.b);
      case "diameter":
        return !doomedCurves.has(constraint.circle);
      case "midpoint":
        return keptPoints.has(constraint.point) && !doomedCurves.has(constraint.line);
    }
  });

  if (
    points.length === sketch.points.length &&
    curves.length === sketch.curves.length &&
    constraints.length === sketch.constraints.length
  ) {
    return sketch;
  }

  return { points, curves, constraints };
}

export function isSketchEntity(sketch: Sketch, id: string): boolean {
  return (
    sketch.curves.some((curve) => curve.id === id) || sketch.points.some((point) => point.id === id)
  );
}
