import { emptySketch, newId } from "../sketch/create";
import type { Sketch } from "../sketch/types";
import {
  CURRENT_SCHEMA_VERSION,
  type Doc,
  type ExtrudeFeature,
  type SketchFeature,
} from "./types";

export interface CreateDocOptions {
  name?: string;
  height?: number;
  /** Override generated ids, for imports and deterministic tests. */
  id?: string;
  sketchId?: string;
  extrudeId?: string;
}

export function createSketchFeature(
  sketch: Sketch = emptySketch(),
  options: { name?: string; id?: string } = {},
): SketchFeature {
  return {
    id: options.id ?? newId("feat"),
    type: "sketch",
    name: options.name ?? "Sketch 1",
    support: { kind: "world", plane: "XY" },
    sketch,
  };
}

export function createExtrudeFeature(
  sketchId: string,
  options: { name?: string; id?: string; height?: number } = {},
): ExtrudeFeature {
  return {
    id: options.id ?? newId("feat"),
    type: "extrude",
    name: options.name ?? "Extrude 1",
    sketchId,
    regions: [],
    height: options.height ?? 12,
    operation: "new",
    symmetric: false,
    end: "blind",
  };
}

/**
 * A new part with one sketch and one extrude. This is deliberately the same
 * two-step shape the spike had; history grows from here.
 */
/** A new local part: one empty sketch and no extrude yet. */
export function createBlankDocument(name = "Untitled"): Doc {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: newId("doc"),
    name,
    features: [createSketchFeature(emptySketch(), { name: "Sketch 1" })],
  };
}

/** An independent local copy: new document id, same immutable features. */
export function copyDocument(doc: Doc, name = `${doc.name} copy`): Doc {
  return { ...doc, id: newId("doc"), name };
}

export function createDocument(
  sketch: Sketch = emptySketch(),
  options: CreateDocOptions = {},
): Doc {
  const sketchFeature = createSketchFeature(sketch, {
    name: "Sketch 1",
    ...(options.sketchId ? { id: options.sketchId } : {}),
  });
  const extrudeFeature = createExtrudeFeature(sketchFeature.id, {
    name: "Extrude 1",
    height: options.height,
    ...(options.extrudeId ? { id: options.extrudeId } : {}),
  });
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: options.id ?? newId("doc"),
    name: options.name ?? "Untitled",
    features: [sketchFeature, extrudeFeature],
  };
}
