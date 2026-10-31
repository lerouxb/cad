import { describe, expect, it } from "vitest";
import { createDemoModel } from "../sketch/demo";
import { createDocument } from "./create";
import { migrateDoc, validateDoc } from "./migrations";
import { deserializeDoc, serializeDoc } from "./persistence";
import {
  primaryExtrudeFeature,
  primarySketch,
  primarySketchFeature,
  renameFeature,
  updateExtrudeHeight,
  updateExtrudeRegions,
  updatePrimarySketch,
} from "./selectors";
import type { Doc } from "./types";

function exampleDoc(): Doc {
  return createDocument(createDemoModel().sketch, {
    id: "doc-1",
    sketchId: "sketch-1",
    extrudeId: "extrude-1",
    name: "Example",
    height: 12,
  });
}

describe("document schema", () => {
  it("creates a two-feature part with stable ids", () => {
    const doc = exampleDoc();
    expect(doc.schemaVersion).toBe(1);
    expect(doc.features.map((feature) => feature.type)).toEqual([
      "sketch",
      "extrude",
    ]);
    expect(primarySketchFeature(doc)?.id).toBe("sketch-1");
    expect(primaryExtrudeFeature(doc)?.id).toBe("extrude-1");
    expect(primaryExtrudeFeature(doc)?.height).toBe(12);
    expect(primarySketch(doc).curves.length).toBeGreaterThan(0);
  });

  it("survives JSON round-trips unchanged", () => {
    const doc = exampleDoc();
    const text = serializeDoc(doc);
    expect(JSON.parse(text)).toEqual(doc);
    expect(deserializeDoc(text)).toEqual(doc);
  });

  it("updates features immutably", () => {
    const doc = exampleDoc();
    const taller = updateExtrudeHeight(doc, 30);
    expect(primaryExtrudeFeature(taller)?.height).toBe(30);
    expect(primaryExtrudeFeature(doc)?.height).toBe(12);

    const selected = updateExtrudeRegions(doc, ["reg-a", "reg-b"]);
    expect(primaryExtrudeFeature(selected)?.regions).toEqual(["reg-a", "reg-b"]);
    expect(primaryExtrudeFeature(doc)?.regions).toEqual([]);

    const renamed = renameFeature(doc, "extrude-1", "  Boss  ");
    expect(primaryExtrudeFeature(renamed)?.name).toBe("Boss");
    expect(primaryExtrudeFeature(doc)?.name).toBe("Extrude 1");
  });

  it("replaces the primary sketch without touching the extrude", () => {
    const doc = exampleDoc();
    const sketch = primarySketch(doc);
    const next = updatePrimarySketch(doc, {
      ...sketch,
      points: sketch.points.slice(0, 2),
    });
    expect(primarySketch(next).points).toHaveLength(2);
    expect(primaryExtrudeFeature(next)).toEqual(primaryExtrudeFeature(doc));
  });

  it("returns a stable empty sketch when the document has none", () => {
    const empty: Doc = {
      schemaVersion: 1,
      id: "empty",
      name: "Empty",
      features: [],
    };
    expect(primarySketch(empty)).toBe(primarySketch(empty));
    expect(primarySketch(empty).curves).toEqual([]);
  });
});

describe("document migrations", () => {
  it("migrates a legacy single-sketch payload", () => {
    const model = createDemoModel();
    const migrated = migrateDoc({
      sketch: model.sketch,
      height: 25,
      name: "Legacy part",
    });

    expect(migrated).not.toBeNull();
    expect(migrated!.schemaVersion).toBe(1);
    expect(migrated!.name).toBe("Legacy part");
    expect(migrated!.features).toHaveLength(2);
    expect(primaryExtrudeFeature(migrated!)?.height).toBe(25);
    expect(primarySketchFeature(migrated!)?.support).toEqual({
      kind: "world",
      plane: "XY",
    });
  });

  it("rejects malformed, unknown and newer documents", () => {
    const doc = exampleDoc();
    expect(migrateDoc(null)).toBeNull();
    expect(migrateDoc("nope")).toBeNull();
    expect(migrateDoc({ ...doc, schemaVersion: 2 })).toBeNull();
    expect(migrateDoc({ ...doc, features: "nope" })).toBeNull();
    expect(
      migrateDoc({
        ...doc,
        features: [...doc.features, { id: "x", type: "fillet", name: "Fillet" }],
      }),
    ).toBeNull();
    expect(
      migrateDoc({
        ...doc,
        features: doc.features.filter((feature) => feature.type !== "sketch"),
      }),
    ).toBeNull();
    expect(
      migrateDoc({
        ...doc,
        features: doc.features.map((feature) =>
          feature.type === "sketch" ? { ...feature, sketch: { points: "nope" } } : feature,
        ),
      }),
    ).toBeNull();
  });

  it("validates a hand-written minimal document", () => {
    const doc = exampleDoc();
    expect(validateDoc(doc)).toEqual(doc);
  });

  it("rejects invalid JSON text", () => {
    expect(deserializeDoc("{not json")).toBeNull();
  });
});
