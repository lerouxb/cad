import { describe, expect, it } from "vitest";
import { createDocument } from "./create";
import { faceRefKey, refreshDatumFrames } from "./datum";
import { addDatumPlaneFeature, addSketchFeature } from "./selectors";
import { datumDefinitionFrame, flipFrame } from "./support";
import type { PlaneFrame } from "../types";
import type { TopoRef } from "../kernel/protocol";
import { emptySketch } from "../sketch/create";

const face: TopoRef = {
  source: "extrude-1",
  kind: "face",
  role: "extrude:top",
  hint: {
    entityType: "face",
    normal: [0, 0, 1],
    centroid: [30, 20, 12],
  },
};

function frameAt(z: number): PlaneFrame {
  return {
    origin: [30, 20, z],
    normal: [0, 0, 1],
    xAxis: [1, 0, 0],
    yAxis: [0, 1, 0],
  };
}

function docWithFaceDatum() {
  const doc = createDocument(emptySketch(), {
    id: "doc",
    sketchId: "sketch-1",
    extrudeId: "extrude-1",
  });
  const definition = {
    kind: "offset" as const,
    base: { kind: "face" as const, ref: face, frame: frameAt(12) },
    distance: 5,
  };
  const datum = addDatumPlaneFeature(
    doc,
    definition,
    datumDefinitionFrame(definition)!,
    { id: "plane-1", name: "Plane 1" },
  );
  return addSketchFeature(datum.doc, {
    id: "sketch-2",
    support: {
      kind: "datum",
      featureId: "plane-1",
      label: "Plane 1",
      frame: datum.feature.frame,
    },
  }).doc;
}

describe("datum frame refresh", () => {
  it("follows a moved face base and updates dependent sketches", () => {
    const doc = docWithFaceDatum();
    const moved = refreshDatumFrames(
      doc,
      new Map([[faceRefKey(face), frameAt(30)]]),
    );
    const datum = moved.features.find((feature) => feature.id === "plane-1");
    if (datum?.type !== "datum") throw new Error("Expected a datum feature");
    expect(datum.frame.origin).toEqual([30, 20, 35]);
    expect(datum.definition.kind).toBe("offset");
    if (datum.definition.kind === "offset") {
      expect(datum.definition.base).toMatchObject({ frame: frameAt(30) });
    }
    const sketch = moved.features.find((feature) => feature.id === "sketch-2");
    if (sketch?.type !== "sketch") throw new Error("Expected a sketch");
    expect(sketch.support).toMatchObject({ frame: frameAt(35) });
  });

  it("keeps a datum on its original side when the face normal flips", () => {
    const doc = docWithFaceDatum();
    const moved = refreshDatumFrames(
      doc,
      new Map([[faceRefKey(face), flipFrame(frameAt(12))]]),
    );
    const datum = moved.features.find((feature) => feature.id === "plane-1");
    if (datum?.type !== "datum") throw new Error("Expected a datum feature");
    expect(datum.frame.normal).toEqual([0, 0, 1]);
    expect(datum.frame.origin).toEqual([30, 20, 17]);
    if (datum.definition.kind === "offset") {
      expect(datum.definition.base).toMatchObject({ frame: frameAt(12) });
    }
  });

  it("returns the same document when every frame is unchanged", () => {
    const doc = docWithFaceDatum();
    expect(
      refreshDatumFrames(doc, new Map([[faceRefKey(face), frameAt(12)]])),
    ).toBe(doc);
  });
});
