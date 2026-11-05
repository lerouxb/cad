import { faceRefKey, type TopoRef } from "../kernel/protocol";
import type { PlaneFrame } from "../types";
import { datumDefinitionFrame, framesClose, stabilizeFrame } from "./support";
import {
  isDatumPlaneFeature,
  isSketchFeature,
  type Doc,
  type PlaneRef,
} from "./types";

/** Key used to cache a resolved face frame by its stable source/role pair. */
export { faceRefKey };

/** Every face reference used to derive a datum plane. */
export function collectDatumFaceRefs(doc: Doc): TopoRef[] {
  const refs: TopoRef[] = [];
  const add = (ref: PlaneRef): void => {
    if (ref.kind === "face") refs.push(ref.ref);
  };
  for (const feature of doc.features) {
    if (!isDatumPlaneFeature(feature)) continue;
    const definition = feature.definition;
    if (definition.kind === "offset") add(definition.base);
    else {
      add(definition.a);
      add(definition.b);
    }
  }
  return refs;
}

/**
 * Refresh datum planes and their dependent sketch supports from the latest
 * resolved face frames. Pure: callers decide whether the returned document
 * should be committed (this is derived state, never an undo step).
 */
export function refreshDatumFrames(
  doc: Doc,
  faceFrames: ReadonlyMap<string, PlaneFrame>,
): Doc {
  const frames = new Map<string, PlaneFrame>();
  let changed = false;

  const updateRef = (ref: PlaneRef): PlaneRef => {
    if (ref.kind === "world") return ref;
    const raw =
      ref.kind === "face"
        ? faceFrames.get(faceRefKey(ref.ref))
        : frames.get(ref.featureId);
    const frame = raw ? stabilizeFrame(raw, ref.frame) : undefined;
    return frame && !framesClose(frame, ref.frame) ? { ...ref, frame } : ref;
  };

  const features = doc.features.map((feature) => {
    if (isDatumPlaneFeature(feature)) {
      const definition = feature.definition;
      const nextDefinition =
        definition.kind === "offset"
          ? { ...definition, base: updateRef(definition.base) }
          : {
              ...definition,
              a: updateRef(definition.a),
              b: updateRef(definition.b),
            };
      const definitionChanged =
        definition.kind === "offset" && nextDefinition.kind === "offset"
          ? nextDefinition.base !== definition.base
          : definition.kind === "midplane" &&
            nextDefinition.kind === "midplane" &&
            (nextDefinition.a !== definition.a ||
              nextDefinition.b !== definition.b);
      const frame = datumDefinitionFrame(nextDefinition) ?? feature.frame;
      frames.set(feature.id, frame);
      if (!definitionChanged && framesClose(frame, feature.frame)) {
        return feature;
      }
      changed = true;
      return { ...feature, definition: nextDefinition, frame };
    }

    if (isSketchFeature(feature) && feature.support.kind === "datum") {
      const support = feature.support;
      const frame = frames.get(support.featureId);
      if (!frame || framesClose(frame, support.frame)) return feature;
      changed = true;
      return { ...feature, support: { ...support, frame } };
    }

    return feature;
  });

  return changed ? { ...doc, features } : doc;
}
