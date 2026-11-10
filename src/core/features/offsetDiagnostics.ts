/**
 * Human-readable diagnostics for the conservative Offset Faces v1 slice.
 *
 * The worker rejects a move it cannot rebuild exactly (a step/undercut at an
 * adjacent face, a non-planar selected face, a partial cylinder, ...). These
 * strings name the blocker and the practical workaround; they are pure so the
 * copy can be tested without the kernel.
 */

/** Readable surface description from brepjs' public `faceGeomType` string. */
export function offsetSurfaceLabel(type: string): string {
  const upper = type.toUpperCase();
  if (upper.includes("PLANE")) return "a planar face";
  if (upper.includes("CYL")) return "a cylindrical face";
  if (upper.includes("CONE")) return "a conical face";
  if (upper.includes("SPHERE")) return "a spherical face";
  if (upper.includes("TORUS")) return "a toroidal face";
  if (upper.includes("BSPLINE") || upper.includes("BEZIER")) {
    return "a B-spline face";
  }
  if (upper.includes("REVOLUTION")) return "a revolved face";
  if (upper.includes("EXTRUSION")) return "an extruded face";
  if (upper.includes("OFFSET")) return "an offset face";
  return "a curved face";
}

export function offsetSelectedSurfaceMessage(type: string): string {
  return `The selected face is ${offsetSurfaceLabel(
    type,
  )}. Offset faces v1 moves planar faces and full cylindrical through holes/bosses only; move this offset before the operation that creates it, or edit that operation.`;
}

export function offsetNonParallelSelectionMessage(): string {
  return "The selected faces do not share one normal. Offset faces moves one face direction at a time; offset them in separate steps, or select parallel faces together.";
}

export function offsetTangentFilletMessage(): string {
  return "A neighbouring face is a top-edge fillet, so the sweep would leave an undercut. Move this offset before the fillet in the timeline, or edit the fillet after this step.";
}

export function offsetHorizontalCylinderMessage(): string {
  return "A neighbouring face is a horizontal cylindrical wall that is not parallel to the move, so the sweep would leave an undercut. Move this offset before that feature, or edit it.";
}

export function offsetCurvedNeighbourMessage(type: string): string {
  return `A neighbouring face is ${offsetSurfaceLabel(
    type,
  )}, which v1 cannot follow. Move this offset before the operation that creates it, or edit that operation.`;
}

export function offsetMixedSlantedCurvedMessage(type: string): string {
  return `This face has both a slanted planar neighbour and ${offsetSurfaceLabel(
    type,
  )} on its outer boundary. v1.5 supports slanted planar neighbours with straight outer walls only; move this offset before the curved feature, or edit that feature.`;
}

export function offsetNonConvexFaceMessage(): string {
  return "The selected face has a non-convex outer boundary. v1.5 supports convex planar faces with slanted planar neighbours; split the face or edit the profile first.";
}

export function offsetHoleWallMessage(): string {
  return "A hole in the selected face has a slanted wall, so the hole would change shape. v1.5 translates holes only through straight or parallel-cylindrical walls; move this offset before that feature, or edit it.";
}

export function offsetPartialCapMessage(): string {
  return "The selected partial cylindrical face is not bounded by two straight radial caps. Offset faces v1.5 supports partial cylinders with planar radial caps only; offset the face before the fillet or edit that feature.";
}

export function offsetSealedCylinderMessage(): string {
  return "The selected cylindrical hole does not open on the body. Offset faces needs an opening to rebuild the wall; reselect the hole or edit the feature.";
}

export function offsetBlindCapMessage(): string {
  return "The selected blind hole has a non-planar bottom. Offset faces v1.5 supports blind holes with planar caps only; edit the hole feature or offset it before the cap is created.";
}

export function offsetMultipleCylinderSelectionMessage(): string {
  return "A cylindrical face was selected with other faces. Offset one full cylindrical hole or boss at a time, or select only planar faces.";
}
