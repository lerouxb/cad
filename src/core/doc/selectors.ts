import { emptySketch } from "../sketch/create";
import type { Sketch } from "../sketch/types";
import { createSketchFeature } from "./create";
import {
  isExtrudeFeature,
  isSketchFeature,
  type Doc,
  type ExtrudeFeature,
  type Feature,
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

export function updatePrimarySketch(doc: Doc, sketch: Sketch): Doc {
  const id = primarySketchFeature(doc)?.id;
  if (!id) {
    return {
      ...doc,
      features: [...doc.features, createSketchFeature(sketch)],
    };
  }
  return updateFeature(doc, id, (feature) =>
    isSketchFeature(feature) ? { ...feature, sketch } : feature,
  );
}

export function updateExtrudeHeight(doc: Doc, height: number): Doc {
  const id = primaryExtrudeFeature(doc)?.id;
  if (!id) return doc;
  return updateFeature(doc, id, (feature) =>
    isExtrudeFeature(feature) && feature.height !== height
      ? { ...feature, height }
      : feature,
  );
}

export function updateExtrudeRegions(doc: Doc, regions: readonly string[]): Doc {
  const id = primaryExtrudeFeature(doc)?.id;
  if (!id) return doc;
  return updateFeature(doc, id, (feature) => {
    if (!isExtrudeFeature(feature)) return feature;
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
