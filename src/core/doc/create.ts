import type { PlaneFrame } from "../types";
import type { EdgeRef } from "../kernel/protocol";
import { emptySketch, newId } from "../sketch/create";
import type { Sketch } from "../sketch/types";
import {
  CURRENT_SCHEMA_VERSION,
  type DatumPlaneDefinition,
  type DatumPlaneFeature,
  type Doc,
  type ChamferFeature,
  type ExtrudeFeature,
  type FaceProjection,
  type FilletFeature,
  type PlaneRef,
  type SketchFeature,
} from "./types";

export interface CreateDocOptions {
  name?: string;
  height?: number;
  /** Override generated ids, for imports and deterministic tests. */
  id?: string;
  sketchId?: string;
  extrudeId?: string;
  support?: PlaneRef;
}

export function createSketchFeature(
  sketch: Sketch = emptySketch(),
  options: {
    name?: string;
    id?: string;
    support?: PlaneRef;
    projections?: FaceProjection[];
  } = {},
): SketchFeature {
  return {
    id: options.id ?? newId("feat"),
    type: "sketch",
    name: options.name ?? "Sketch 1",
    support: options.support ?? { kind: "world", plane: "XY" },
    sketch,
    ...(options.projections && options.projections.length > 0
      ? { projections: options.projections }
      : {}),
  };
}

export function createDatumPlaneFeature(
  definition: DatumPlaneDefinition,
  frame: PlaneFrame,
  options: { name?: string; id?: string; hidden?: boolean } = {},
): DatumPlaneFeature {
  return {
    id: options.id ?? newId("feat"),
    type: "datum",
    name: options.name ?? "Plane 1",
    definition,
    frame,
    ...(options.hidden ? { hidden: true } : {}),
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

export function createFilletFeature(
  edges: readonly EdgeRef[],
  radius: number,
  options: { name?: string; id?: string } = {},
): FilletFeature {
  return {
    id: options.id ?? newId("feat"),
    type: "fillet",
    name: options.name ?? "Fillet 1",
    edges: [...edges],
    radius,
  };
}

export function createChamferFeature(
  edges: readonly EdgeRef[],
  distance: number,
  options: { name?: string; id?: string } = {},
): ChamferFeature {
  return {
    id: options.id ?? newId("feat"),
    type: "chamfer",
    name: options.name ?? "Chamfer 1",
    edges: [...edges],
    distance,
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
    ...(options.support ? { support: options.support } : {}),
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
