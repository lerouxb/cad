import { emptySketch } from "../sketch/create";
import type { Sketch } from "../sketch/types";
import { createExtrudeFeature, createSketchFeature } from "./create";
import {
  isExtrudeFeature,
  isSketchFeature,
  type Doc,
  type ExtrudeFeature,
  type ExtrudeOperation,
  type FaceProjection,
  type Feature,
  type PlaneRef,
  type SketchFeature,
} from "./types";

// Shared so a document without a sketch does not hand React a new object on
// every render. Sketches are treated as immutable throughout the app.
const EMPTY_SKETCH = emptySketch();

export function sketchFeatures(doc: Doc): SketchFeature[] {
  return doc.features.filter(isSketchFeature);
}

export function extrudeFeatures(doc: Doc): ExtrudeFeature[] {
  return doc.features.filter(isExtrudeFeature);
}

export function primarySketchFeature(doc: Doc): SketchFeature | null {
  return doc.features.find(isSketchFeature) ?? null;
}

export function primaryExtrudeFeature(doc: Doc): ExtrudeFeature | null {
  return doc.features.find(isExtrudeFeature) ?? null;
}

export function primarySketch(doc: Doc): Sketch {
  return primarySketchFeature(doc)?.sketch ?? EMPTY_SKETCH;
}

export function findFeature(doc: Doc, featureId: string): Feature | null {
  return doc.features.find((feature) => feature.id === featureId) ?? null;
}

export function sketchFeatureById(
  doc: Doc,
  featureId: string,
): SketchFeature | null {
  const feature = findFeature(doc, featureId);
  return feature && isSketchFeature(feature) ? feature : null;
}

export function extrudeFeatureById(
  doc: Doc,
  featureId: string,
): ExtrudeFeature | null {
  const feature = findFeature(doc, featureId);
  return feature && isExtrudeFeature(feature) ? feature : null;
}

/** The first extrude that consumes this sketch, in history order. */
export function extrudesForSketch(
  doc: Doc,
  sketchId: string,
): ExtrudeFeature[] {
  return doc.features.filter(
    (feature): feature is ExtrudeFeature =>
      isExtrudeFeature(feature) && feature.sketchId === sketchId,
  );
}

export function extrudeForSketch(
  doc: Doc,
  sketchId: string,
): ExtrudeFeature | null {
  return extrudesForSketch(doc, sketchId)[0] ?? null;
}

export function updateSketchFeature(
  doc: Doc,
  featureId: string,
  sketch: Sketch,
): Doc {
  return updateFeature(doc, featureId, (feature) =>
    isSketchFeature(feature) && feature.sketch !== sketch
      ? { ...feature, sketch }
      : feature,
  );
}

/** Update one extrude by id; the updater must return the same object for a no-op. */
export function updateExtrudeFeature(
  doc: Doc,
  featureId: string,
  update: (feature: ExtrudeFeature) => ExtrudeFeature,
): Doc {
  return updateFeature(doc, featureId, (feature) =>
    isExtrudeFeature(feature) ? update(feature) : feature,
  );
}

export function updatePrimarySketch(doc: Doc, sketch: Sketch): Doc {
  const id = primarySketchFeature(doc)?.id;
  if (!id) {
    return {
      ...doc,
      features: [...doc.features, createSketchFeature(sketch)],
    };
  }
  return updateSketchFeature(doc, id, sketch);
}

export function updateExtrudeHeight(doc: Doc, height: number): Doc {
  const id = primaryExtrudeFeature(doc)?.id;
  if (!id) return doc;
  return updateExtrudeFeature(doc, id, (feature) =>
    feature.height !== height ? { ...feature, height } : feature,
  );
}

export function updateExtrudeRegions(doc: Doc, regions: readonly string[]): Doc {
  const id = primaryExtrudeFeature(doc)?.id;
  if (!id) return doc;
  return updateExtrudeFeature(doc, id, (feature) => {
    const next = [...regions];
    if (
      next.length === feature.regions.length &&
      next.every((id, index) => id === feature.regions[index])
    ) {
      return feature;
    }
    return { ...feature, regions: next };
  });
}

/** `Sketch 2`, `Extrude 3`, ... based on how many of that type already exist. */
export function nextFeatureName(doc: Doc, type: Feature["type"]): string {
  const prefix = type === "sketch" ? "Sketch" : "Extrude";
  const count = doc.features.filter((feature) => feature.type === type).length;
  return `${prefix} ${count + 1}`;
}

/**
 * Append a new sketch on XY. M4 will let the caller choose a support.
 * Returns the new feature so the caller can activate it.
 */
export function addSketchFeature(
  doc: Doc,
  options: {
    name?: string;
    id?: string;
    sketch?: Sketch;
    support?: PlaneRef;
    projections?: FaceProjection[];
  } = {},
): { doc: Doc; feature: SketchFeature } {
  const feature = createSketchFeature(options.sketch ?? emptySketch(), {
    name: options.name ?? nextFeatureName(doc, "sketch"),
    ...(options.id ? { id: options.id } : {}),
    ...(options.support ? { support: options.support } : {}),
    ...(options.projections ? { projections: options.projections } : {}),
  });
  return {
    doc: { ...doc, features: [...doc.features, feature] },
    feature,
  };
}

/**
 * Append an extrude for an existing sketch. The default operation is `new` for
 * the first extrude and `join` once a body exists; the UI can override it.
 */
export function addExtrudeFeature(
  doc: Doc,
  sketchId: string,
  options: {
    name?: string;
    id?: string;
    height?: number;
    operation?: ExtrudeOperation;
  } = {},
): { doc: Doc; feature: ExtrudeFeature } | null {
  if (!sketchFeatureById(doc, sketchId)) return null;
  const base = createExtrudeFeature(sketchId, {
    name: options.name ?? nextFeatureName(doc, "extrude"),
    ...(options.id ? { id: options.id } : {}),
    ...(options.height !== undefined ? { height: options.height } : {}),
  });
  const operation =
    options.operation ?? (doc.features.some(isExtrudeFeature) ? "join" : "new");
  const feature = { ...base, operation };
  return {
    doc: { ...doc, features: [...doc.features, feature] },
    feature,
  };
}

/** Suppress or unsuppress a feature; downstream dependants will skip visibly. */
export function setFeatureSuppressed(
  doc: Doc,
  featureId: string,
  suppressed: boolean,
): Doc {
  return updateFeature(doc, featureId, (feature) => {
    const current = feature.suppressed === true;
    if (current === suppressed) return feature;
    return suppressed
      ? { ...feature, suppressed: true }
      : { ...feature, suppressed: undefined };
  });
}

/**
 * Move a feature in history. The order is rejected if it would put an extrude
 * before the sketch it consumes.
 */
export function moveFeature(
  doc: Doc,
  featureId: string,
  toIndex: number,
): { doc: Doc } | { error: string } {
  const from = doc.features.findIndex((feature) => feature.id === featureId);
  if (from < 0) return { error: "Feature not found." };
  const features = [...doc.features];
  const [feature] = features.splice(from, 1);
  if (!feature) return { error: "Feature not found." };
  const target = Math.max(0, Math.min(features.length, Math.round(toIndex)));
  features.splice(target, 0, feature);
  if (!hasValidOrder(features)) {
    return { error: "An extrude must come after the sketch it consumes." };
  }
  return { doc: { ...doc, features } };
}

/**
 * Delete a feature. Deleting a sketch also removes the extrudes that consume
 * it, so the saved document stays valid. Extrudes are independent of one
 * another; a downstream join/cut may still error visibly if its base is gone.
 */
export function deleteFeature(
  doc: Doc,
  featureId: string,
): { doc: Doc; removedIds: string[] } {
  const target = doc.features.find((feature) => feature.id === featureId);
  if (!target) return { doc, removedIds: [] };
  const removed = new Set<string>([featureId]);
  if (isSketchFeature(target)) {
    for (const feature of doc.features) {
      if (isExtrudeFeature(feature) && feature.sketchId === featureId) {
        removed.add(feature.id);
      }
    }
  }
  return {
    doc: {
      ...doc,
      features: doc.features.filter((feature) => !removed.has(feature.id)),
    },
    removedIds: [...removed],
  };
}

function hasValidOrder(features: readonly Feature[]): boolean {
  const index = new Map(features.map((feature, position) => [feature.id, position]));
  return features.every((feature) => {
    if (!isExtrudeFeature(feature)) return true;
    const sketchIndex = index.get(feature.sketchId);
    return sketchIndex !== undefined && sketchIndex < (index.get(feature.id) ?? -1);
  });
}

export function renameFeature(doc: Doc, featureId: string, name: string): Doc {
  const trimmed = name.trim();
  if (!trimmed) return doc;
  return updateFeature(doc, featureId, (feature) =>
    feature.name === trimmed ? feature : { ...feature, name: trimmed },
  );
}

export function renameDocument(doc: Doc, name: string): Doc {
  const trimmed = name.trim();
  return trimmed && trimmed !== doc.name ? { ...doc, name: trimmed } : doc;
}

export function updateFeature(
  doc: Doc,
  featureId: string,
  update: (feature: Feature) => Feature,
): Doc {
  let changed = false;
  const features = doc.features.map((feature) => {
    if (feature.id !== featureId) return feature;
    const next = update(feature);
    if (next !== feature) changed = true;
    return next;
  });
  return changed ? { ...doc, features } : doc;
}
