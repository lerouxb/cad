import { createDocument } from "../../src/core/doc/create";
import type { ExtrudeFeature, SketchFeature } from "../../src/core/doc/types";
import { addCircle, addPolyline, emptySketch } from "../../src/core/sketch/create";

/**
 * A saved three-feature part: a new plate, a cut hole, and a joined extension.
 * Built in the test process and opened through the file dialog, so document
 * loading does not depend on drawing the same thing through the UI each time.
 */
export function multiFeatureDoc() {
  const plate = addPolyline(
    emptySketch(),
    [
      { point: [0, 0] },
      { point: [60, 0] },
      { point: [60, 40] },
      { point: [0, 40] },
    ],
    true,
  );
  const hole = addCircle(emptySketch(), { point: [30, 20] }, 8);
  const extension = addPolyline(
    emptySketch(),
    [
      { point: [40, 0] },
      { point: [80, 0] },
      { point: [80, 40] },
      { point: [40, 40] },
    ],
    true,
  );
  const doc = createDocument(plate, {
    id: "doc-multi",
    sketchId: "sketch-1",
    extrudeId: "extrude-1",
    name: "Multi-feature",
    height: 12,
  });
  const base = doc.features[1];
  if (base?.type !== "extrude") throw new Error("Expected the base extrude");

  const sketch2: SketchFeature = {
    id: "sketch-2",
    type: "sketch",
    name: "Hole sketch",
    support: { kind: "world", plane: "XY" },
    sketch: hole,
  };
  const sketch3: SketchFeature = {
    id: "sketch-3",
    type: "sketch",
    name: "Extension sketch",
    support: { kind: "world", plane: "XY" },
    sketch: extension,
  };
  const cut: ExtrudeFeature = {
    ...base,
    id: "extrude-2",
    name: "Cut 1",
    sketchId: "sketch-2",
    operation: "cut",
    regions: [],
  };
  const join: ExtrudeFeature = {
    ...base,
    id: "extrude-3",
    name: "Join 1",
    sketchId: "sketch-3",
    operation: "join",
    regions: [],
  };
  return {
    ...doc,
    features: [doc.features[0]!, base, sketch2, cut, sketch3, join],
  };
}

export function symmetricDoc() {
  const plate = addPolyline(
    emptySketch(),
    [
      { point: [0, 0] },
      { point: [40, 0] },
      { point: [40, 20] },
      { point: [0, 20] },
    ],
    true,
  );
  const doc = createDocument(plate, {
    id: "doc-symmetric",
    sketchId: "sketch-sym",
    extrudeId: "extrude-sym",
    name: "Symmetric",
    height: 10,
  });
  const base = doc.features[1];
  if (base?.type !== "extrude") throw new Error("Expected the base extrude");
  return { ...doc, features: [doc.features[0]!, { ...base, symmetric: true }] };
}

export function throughAllDoc() {
  const doc = multiFeatureDoc();
  return {
    ...doc,
    features: doc.features.map((feature) =>
      feature.id === "extrude-2" && feature.type === "extrude"
        ? { ...feature, height: 1, end: "throughAll" as const }
        : feature,
    ),
  };
}
