import { addCircle, emptySketch } from "../sketch/create";
import { createExampleModel } from "../sketch/demo";
import { regionsFromSketch } from "../sketch/loops";
import {
  createDocument,
  createExtrudeFeature,
  createSketchFeature,
} from "./create";
import type { Doc } from "./types";

/** Stable id so repeatedly loading the built-in example updates one local file
 * entry instead of piling up identical "Example.cad" rows. */
export const EXAMPLE_DOC_ID = "doc-example";

/**
 * The default part: the dimensioned plate from the sketch demo plus a second
 * extrude from the same sketch (the central hole as a solid pin) and a second,
 * suppressed mounting-holes feature.
 *
 * Using Sketch 1 twice is deliberate: it exercises independent region
 * selections on a shared sketch. The pin is suppressed by default so the base
 * plate, picking coordinates and volume goldens stay stable; unsuppress
 * "Center pin" to see a cylinder grow out of the central hole. The mounting cut
 * is suppressed for the same reason.
 */
export function createExampleDocument(): Doc {
  const model = createExampleModel();
  const base = createDocument(model.sketch, {
    id: EXAMPLE_DOC_ID,
    name: "Example",
    height: 12,
  });
  const baseSketch = base.features[0]!;
  const baseExtrude = base.features[1]!;
  const holeRegion = regionsFromSketch(model.sketch).find(
    (region) => region.kind === "void",
  );

  const centerPin = {
    ...createExtrudeFeature(baseSketch.id, {
      name: "Center pin",
      height: 20,
    }),
    operation: "join" as const,
    regions: holeRegion ? [holeRegion.id] : [],
    suppressed: true,
  };

  const mounting = addCircle(
    addCircle(emptySketch(), { point: [12, 20] }, 3),
    { point: [48, 20] },
    3,
  );
  const holesSketch = createSketchFeature(mounting, {
    name: "Mounting holes",
  });
  const holesCut = {
    ...createExtrudeFeature(holesSketch.id, {
      name: "Mounting holes cut",
      height: 12,
    }),
    operation: "cut" as const,
    end: "throughAll" as const,
    suppressed: true,
  };

  return {
    ...base,
    features: [baseSketch, baseExtrude, centerPin, holesSketch, holesCut],
  };
}
