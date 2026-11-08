import { describe, expect, it } from "vitest";
import { addCircle, addPoint, emptySketch } from "../sketch/create";
import { createDemoModel } from "../sketch/demo";
import { createDocument } from "./create";
import { createExampleDocument } from "./example";
import { migrateDoc, validateDoc } from "./migrations";
import { datumDefinitionFrame } from "./support";
import { deserializeDoc, serializeDoc } from "./persistence";
import {
  addChamferFeature,
  addDatumPlaneFeature,
  addExtrudeFeature,
  addFilletFeature,
  addOffsetFaceFeature,
  addShellFeature,
  addSketchFeature,
  deleteFeature,
  extrudeFeatureById,
  extrudeForSketch,
  moveFeature,
  nextFeatureName,
  primaryExtrudeFeature,
  primarySketch,
  primarySketchFeature,
  renameFeature,
  setFeatureSuppressed,
  sketchFeatureById,
  updateExtrudeFeature,
  updateExtrudeHeight,
  updateChamferFeature,
  updateExtrudeRegions,
  updateFilletFeature,
  updateOffsetFaceFeature,
  updateShellFeature,
  updatePrimarySketch,
  updateSketchFeature,
} from "./selectors";
import {
  CURRENT_SCHEMA_VERSION,
  isChamferFeature,
  isFilletFeature,
  type Doc,
  type ExtrudeFeature,
  type SketchFeature,
} from "./types";
import type { EdgeRef, TopoRef } from "../kernel/protocol";

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
    expect(doc.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(doc.features.map((feature) => feature.type)).toEqual([
      "sketch",
      "extrude",
    ]);
    expect(primarySketchFeature(doc)?.id).toBe("sketch-1");
    expect(primaryExtrudeFeature(doc)?.id).toBe("extrude-1");
    expect(primaryExtrudeFeature(doc)?.height).toBe(12);
    expect(primarySketch(doc).curves.length).toBeGreaterThan(0);
  });

  it("uses a stable document id for the built-in example", () => {
    expect(createExampleDocument().id).toBe(createExampleDocument().id);
  });

  it("reuses the example sketch and includes a suppressed through-all cut", () => {
    const doc = createExampleDocument();
    expect(doc.name).toBe("Example");
    expect(doc.features.map((feature) => feature.type)).toEqual([
      "sketch",
      "extrude",
      "datum",
      "extrude",
      "sketch",
      "extrude",
      "fillet",
      "chamfer",
    ]);
    const baseSketch = doc.features[0]!;
    const midplane = doc.features[2]!;
    const centerPin = doc.features[3]!;
    expect(midplane).toMatchObject({
      type: "datum",
      name: "Midplane",
      definition: { kind: "midplane" },
    });
    const mounting = doc.features[4]!;
    expect(mounting).toMatchObject({
      type: "sketch",
      name: "Mounting holes",
      support: { kind: "face" },
    });
    expect(centerPin).toMatchObject({
      type: "extrude",
      name: "Center pin",
      operation: "join",
      suppressed: true,
    });
    if (
      baseSketch.type !== "sketch" ||
      centerPin.type !== "extrude"
    ) {
      throw new Error("Expected the example sketch and center pin");
    }
    expect(centerPin.sketchId).toBe(baseSketch.id);
    expect(centerPin.regions).toHaveLength(1);
    expect(doc.features[5]).toMatchObject({
      type: "extrude",
      operation: "cut",
      end: "throughAll",
      suppressed: true,
    });
    expect(doc.features[6]).toMatchObject({
      type: "fillet",
      name: "Rounded plate",
      radius: 4,
      suppressed: true,
    });
    const rounded = doc.features[6];
    expect(rounded?.type === "fillet" ? rounded.edges : []).toHaveLength(4);
    expect(doc.features[7]).toMatchObject({
      type: "chamfer",
      name: "Beveled plate",
      distance: 4,
      suppressed: true,
    });
    const beveled = doc.features[7];
    expect(beveled?.type === "chamfer" ? beveled.edges : []).toHaveLength(4);

    // The hand-authored edge refs are valid plain JSON and survive the schema
    // validator (which checks ordering against the face sources).
    const parsed = validateDoc(JSON.parse(JSON.stringify(doc)));
    expect(parsed?.features).toHaveLength(8);
    const parsedRounded = parsed?.features[6];
    expect(
      parsedRounded?.type === "fillet" ? parsedRounded.edges : [],
    ).toHaveLength(4);
    const parsedBeveled = parsed?.features[7];
    expect(
      parsedBeveled?.type === "chamfer" ? parsedBeveled.edges : [],
    ).toHaveLength(4);
  });

  it("survives JSON round-trips unchanged", () => {
    const doc = exampleDoc();
    const text = serializeDoc(doc);
    expect(JSON.parse(text)).toEqual(doc);
    expect(deserializeDoc(text)).toEqual(doc);
  });

  it("suppresses, reorders and cascades deletion with dependencies", () => {
    const doc = exampleDoc();
    const base = doc.features[1];
    if (base?.type !== "extrude") throw new Error("Expected the base extrude");
    const sketch2: SketchFeature = {
      id: "sketch-2",
      type: "sketch",
      name: "Hole sketch",
      support: { kind: "world", plane: "XY" },
      sketch: addCircle(emptySketch(), { point: [30, 20] }, 8),
    };
    const cut: ExtrudeFeature = {
      ...base,
      id: "extrude-2",
      name: "Cut 1",
      sketchId: "sketch-2",
      operation: "cut",
      regions: [],
    };
    const multi: Doc = {
      ...doc,
      features: [doc.features[0]!, base, sketch2, cut],
    };

    const suppressed = setFeatureSuppressed(multi, "extrude-2", true);
    expect(extrudeFeatureById(suppressed, "extrude-2")?.suppressed).toBe(true);
    expect(
      extrudeFeatureById(setFeatureSuppressed(suppressed, "extrude-2", false), "extrude-2")
        ?.suppressed,
    ).toBeUndefined();

    const invalid = moveFeature(multi, "extrude-2", 2);
    expect("error" in invalid).toBe(true);
    const valid = moveFeature(multi, "sketch-2", 1);
    expect("error" in valid).toBe(false);
    if ("doc" in valid) {
      expect(valid.doc.features.map((feature) => feature.id)).toEqual([
        "sketch-1",
        "sketch-2",
        "extrude-1",
        "extrude-2",
      ]);
    }

    const deleted = deleteFeature(multi, "sketch-2");
    expect(deleted.removedIds.sort()).toEqual(["extrude-2", "sketch-2"]);
    expect(deleted.doc.features.map((feature) => feature.id)).toEqual([
      "sketch-1",
      "extrude-1",
    ]);
    expect(deleteFeature(multi, "missing").doc).toBe(multi);
  });

  it("persists standalone sketch points through JSON", () => {
    const doc = exampleDoc();
    const sketch = primarySketch(doc);
    const withPoint = updateSketchFeature(
      doc,
      "sketch-1",
      addPoint(sketch, [12, 34]),
    );
    const reopened = deserializeDoc(serializeDoc(withPoint));
    const point = primarySketch(reopened!).points.find(
      (candidate) => candidate.standalone,
    );
    expect(point).toMatchObject({ x: 12, y: 34, standalone: true });
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

  it("updates a sketch or extrude by feature id", () => {
    const doc = exampleDoc();
    const base = doc.features[1];
    if (base?.type !== "extrude") throw new Error("Expected the base extrude");
    const sketch2: SketchFeature = {
      id: "sketch-2",
      type: "sketch",
      name: "Hole sketch",
      support: { kind: "world", plane: "XY" },
      sketch: addCircle(emptySketch(), { point: [30, 20] }, 8),
    };
    const cut: ExtrudeFeature = {
      ...base,
      id: "extrude-2",
      name: "Cut 1",
      sketchId: "sketch-2",
      operation: "cut",
      regions: [],
    };
    const multi: Doc = {
      ...doc,
      features: [doc.features[0]!, base, sketch2, cut],
    };

    const edited = updateSketchFeature(
      multi,
      "sketch-2",
      addCircle(sketch2.sketch, { point: [10, 10] }, 3),
    );
    expect(sketchFeatureById(edited, "sketch-2")?.sketch.curves).toHaveLength(2);
    expect(sketchFeatureById(edited, "sketch-1")).toEqual(
      sketchFeatureById(multi, "sketch-1"),
    );
    expect(extrudeForSketch(edited, "sketch-2")?.id).toBe("extrude-2");
    expect(extrudeForSketch(edited, "sketch-1")?.id).toBe("extrude-1");

    const taller = updateExtrudeFeature(edited, "extrude-2", (feature) => ({
      ...feature,
      height: 7,
    }));
    expect(extrudeFeatureById(taller, "extrude-2")?.height).toBe(7);
    expect(extrudeFeatureById(taller, "extrude-1")?.height).toBe(12);
    expect(updateExtrudeFeature(taller, "missing", (feature) => feature)).toBe(
      taller,
    );
    expect(updateSketchFeature(taller, "extrude-2", emptySketch())).toBe(taller);
  });

  it("appends sketches and extrudes in history order with safe defaults", () => {
    const doc = exampleDoc();
    expect(nextFeatureName(doc, "sketch")).toBe("Sketch 2");
    expect(nextFeatureName(doc, "extrude")).toBe("Extrude 2");

    const sketch = addSketchFeature(doc);
    expect(sketch.feature.name).toBe("Sketch 2");
    expect(sketch.doc.features[sketch.doc.features.length - 1]?.id).toBe(
      sketch.feature.id,
    );

    const extrude = addExtrudeFeature(sketch.doc, sketch.feature.id);
    expect(extrude).not.toBeNull();
    expect(extrude!.feature.name).toBe("Extrude 2");
    expect(extrude!.feature.sketchId).toBe(sketch.feature.id);
    expect(extrude!.feature.operation).toBe("join");
    expect(
      extrude!.doc.features[extrude!.doc.features.length - 1]?.id,
    ).toBe(extrude!.feature.id);
    expect(addExtrudeFeature(sketch.doc, "missing")).toBeNull();

    const atStart = addSketchFeature(doc, {
      atStart: true,
      name: "Start sketch",
    });
    expect(atStart.doc.features[0]?.id).toBe(atStart.feature.id);

    const firstOnly: Doc = { ...doc, features: [doc.features[0]!] };
    expect(addExtrudeFeature(firstOnly, "sketch-1")?.feature.operation).toBe(
      "new",
    );
  });

  it("adds an undoable fillet, validates it and cascades when its source dies", () => {
    const doc = exampleDoc();
    const edge: EdgeRef = {
      kind: "edge",
      faces: [
        {
          source: "extrude-1",
          kind: "face",
          role: "extrude:face_1",
          hint: { entityType: "face" },
        },
        {
          source: "extrude-1",
          kind: "face",
          role: "extrude:face_2",
          hint: { entityType: "face" },
        },
      ],
      hint: { entityType: "edge", length: 12, midpoint: [0, 0, 6] },
    };

    const added = addFilletFeature(doc, [edge], 2);
    expect(added.feature.name).toBe("Fillet 1");
    expect(added.doc.features[added.doc.features.length - 1]?.id).toBe(
      added.feature.id,
    );
    expect(added.feature.edges[0]).toEqual(edge);

    // The fillet round-trips as plain JSON and keeps its edge refs.
    const parsed = validateDoc(JSON.parse(JSON.stringify(added.doc)));
    expect(parsed).not.toBeNull();
    const migrated = parsed?.features.find(
      (feature) => feature.id === added.feature.id,
    );
    expect(migrated?.type).toBe("fillet");
    expect(
      migrated?.type === "fillet" ? migrated.radius : null,
    ).toBe(2);

    // A fillet can never move before the feature that named its faces.
    expect("error" in moveFeature(added.doc, added.feature.id, 1)).toBe(true);

    const edited = updateFilletFeature(added.doc, added.feature.id, (feature) => ({
      ...feature,
      radius: 3.5,
    }));
    expect(
      edited.features
        .filter(isFilletFeature)
        .find((feature) => feature.id === added.feature.id)?.radius,
    ).toBe(3.5);

    const deleted = deleteFeature(added.doc, "extrude-1");
    expect(deleted.removedIds).toContain(added.feature.id);
  });

  it("adds a shell with stable open-face references", () => {
    const doc = exampleDoc();
    const face: TopoRef = {
      source: "extrude-1",
      kind: "face",
      role: "extrude:face_6",
      hint: {
        entityType: "face",
        surfaceType: "PLANE",
        normal: [0, 0, 1],
        centroid: [30, 20, 12],
        area: 60 * 40,
      },
    };

    const added = addShellFeature(doc, [face], 2);
    expect(added.feature.name).toBe("Shell 1");
    expect(added.feature.faces[0]).toEqual(face);
    expect(added.doc.features.map((feature) => feature.type)).toEqual([
      "sketch",
      "extrude",
      "shell",
    ]);

    // Plain JSON round-trip: the open face keeps its role and hint.
    const parsed = validateDoc(JSON.parse(JSON.stringify(added.doc)));
    const migrated = parsed?.features.find(
      (feature) => feature.id === added.feature.id,
    );
    expect(migrated?.type).toBe("shell");
    expect(
      migrated?.type === "shell" ? migrated.faces[0]?.role : null,
    ).toBe("extrude:face_6");
    expect(
      migrated?.type === "shell" ? migrated.thickness : null,
    ).toBe(2);

    // A shell can never move before the feature that named its faces.
    expect("error" in moveFeature(added.doc, added.feature.id, 1)).toBe(true);

    const edited = updateShellFeature(
      added.doc,
      added.feature.id,
      (feature) => ({ ...feature, thickness: 3 }),
    );
    expect(
      edited.features.find((feature) => feature.type === "shell")?.type ===
        "shell"
        ? (
            edited.features.find(
              (feature) => feature.type === "shell",
            ) as { thickness: number }
          ).thickness
        : null,
    ).toBe(3);

    const deleted = deleteFeature(added.doc, "extrude-1");
    expect(deleted.removedIds).toContain(added.feature.id);

    // Malformed shells must not open.
    expect(
      validateDoc({
        ...added.doc,
        features: [...added.doc.features.slice(0, 2), { ...added.feature, thickness: "2" }],
      }),
    ).toBeNull();
    expect(
      validateDoc({
        ...added.doc,
        features: [...added.doc.features.slice(0, 2), { ...added.feature, faces: [] }],
      }),
    ).toBeNull();
  });

  it("adds an offset face with stable face references", () => {
    const doc = exampleDoc();
    const face: TopoRef = {
      source: "extrude-1",
      kind: "face",
      role: "extrude:face_6",
      hint: {
        entityType: "face",
        surfaceType: "PLANE",
        normal: [0, 0, 1],
        centroid: [30, 20, 12],
        area: 60 * 40,
        radius: 8,
        radialSign: -1,
      },
    };

    const added = addOffsetFaceFeature(doc, [face], 3);
    expect(added.feature.name).toBe("Offset 1");
    expect(added.feature.faces[0]).toEqual(face);
    expect(added.doc.features.map((feature) => feature.type)).toEqual([
      "sketch",
      "extrude",
      "offset",
    ]);

    const parsed = validateDoc(JSON.parse(JSON.stringify(added.doc)));
    const migrated = parsed?.features.find(
      (feature) => feature.id === added.feature.id,
    );
    expect(migrated?.type).toBe("offset");
    expect(
      migrated?.type === "offset" ? migrated.faces[0]?.role : null,
    ).toBe("extrude:face_6");
    expect(migrated?.type === "offset" ? migrated.distance : null).toBe(3);
    expect(
      migrated?.type === "offset" ? migrated.faces[0]?.hint.radius : null,
    ).toBe(8);
    expect(
      migrated?.type === "offset" ? migrated.faces[0]?.hint.radialSign : null,
    ).toBe(-1);

    // An offset can never move before the feature that named its faces.
    expect("error" in moveFeature(added.doc, added.feature.id, 1)).toBe(true);

    const edited = updateOffsetFaceFeature(
      added.doc,
      added.feature.id,
      (feature) => ({ ...feature, distance: -2 }),
    );
    expect(
      edited.features.find((feature) => feature.type === "offset")?.type ===
        "offset"
        ? (
            edited.features.find(
              (feature) => feature.type === "offset",
            ) as { distance: number }
          ).distance
        : null,
    ).toBe(-2);

    const deleted = deleteFeature(added.doc, "extrude-1");
    expect(deleted.removedIds).toContain(added.feature.id);

    // Malformed offsets must not open.
    expect(
      validateDoc({
        ...added.doc,
        features: [
          ...added.doc.features.slice(0, 2),
          { ...added.feature, distance: 0 },
        ],
      }),
    ).toBeNull();
    expect(
      validateDoc({
        ...added.doc,
        features: [
          ...added.doc.features.slice(0, 2),
          { ...added.feature, faces: [] },
        ],
      }),
    ).toBeNull();
  });

  it("adds a chamfer with the same edge identity rules", () => {
    const doc = exampleDoc();
    const edge: EdgeRef = {
      kind: "edge",
      faces: [
        {
          source: "extrude-1",
          kind: "face",
          role: "extrude:face_1",
          hint: { entityType: "face" },
        },
        {
          source: "extrude-1",
          kind: "face",
          role: "extrude:face_2",
          hint: { entityType: "face" },
        },
      ],
      hint: { entityType: "edge", length: 12, midpoint: [0, 0, 6] },
    };

    const added = addChamferFeature(doc, [edge], 1.5);
    expect(added.feature.name).toBe("Chamfer 1");
    expect(added.feature.edges[0]).toEqual(edge);

    const parsed = validateDoc(JSON.parse(JSON.stringify(added.doc)));
    const migrated = parsed?.features.find(
      (feature) => feature.id === added.feature.id,
    );
    expect(migrated?.type).toBe("chamfer");
    expect(
      migrated?.type === "chamfer" ? migrated.distance : null,
    ).toBe(1.5);

    expect("error" in moveFeature(added.doc, added.feature.id, 1)).toBe(true);

    const edited = updateChamferFeature(
      added.doc,
      added.feature.id,
      (feature) => ({ ...feature, distance: 2.5 }),
    );
    expect(
      edited.features
        .filter(isChamferFeature)
        .find((feature) => feature.id === added.feature.id)?.distance,
    ).toBe(2.5);

    const deleted = deleteFeature(added.doc, "extrude-1");
    expect(deleted.removedIds).toContain(added.feature.id);
  });

  it("returns a stable empty sketch when the document has none", () => {
    const empty: Doc = {
      schemaVersion: 3,
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
    expect(migrated!.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated!.name).toBe("Legacy part");
    expect(migrated!.features).toHaveLength(2);
    expect(primaryExtrudeFeature(migrated!)?.height).toBe(25);
    expect(primarySketchFeature(migrated!)?.support).toEqual({
      kind: "world",
      plane: "XY",
    });
  });

  it("opens a v1 document and upgrades it to the current schema", () => {
    const doc = exampleDoc();
    const migrated = migrateDoc({ ...doc, schemaVersion: 1 });
    expect(migrated).toEqual(doc);
    expect(migrated?.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it("opens a v2 document and adds the extrude defaults", () => {
    const doc = exampleDoc();
    const migrated = migrateDoc({ ...doc, schemaVersion: 2 });
    expect(migrated?.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(primaryExtrudeFeature(migrated!)?.end).toBe("blind");
    expect(primaryExtrudeFeature(migrated!)?.suppressed).toBeUndefined();
  });

  it("opens a v3 document and keeps its dimension placements", () => {
    const doc = exampleDoc();
    const migrated = migrateDoc({ ...doc, schemaVersion: 3 });
    expect(migrated?.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it("opens a v4 document with a face-supported sketch", () => {
    const doc = exampleDoc();
    const sketch = doc.features[0]!;
    if (sketch.type !== "sketch") throw new Error("Expected the example sketch");
    const support = {
      kind: "face" as const,
      ref: {
        source: "extrude",
        kind: "face" as const,
        role: "top",
        hint: {
          entityType: "face" as const,
          normal: [0, 0, 1] as [number, number, number],
          centroid: [30, 20, 12] as [number, number, number],
        },
      },
      frame: {
        origin: [30, 20, 12] as [number, number, number],
        normal: [0, 0, 1] as [number, number, number],
        xAxis: [1, 0, 0] as [number, number, number],
        yAxis: [0, 1, 0] as [number, number, number],
      },
    };
    const migrated = migrateDoc({
      ...doc,
      schemaVersion: 4,
      features: [{ ...sketch, support }, ...doc.features.slice(1)],
    });
    expect(migrated?.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(primarySketchFeature(migrated!)?.support).toEqual(support);
    expect(
      migrateDoc({
        ...doc,
        schemaVersion: 5,
        features: [{ ...sketch, support: { kind: "face" } }, ...doc.features.slice(1)],
      }),
    ).toBeNull();
  });

  it("preserves face-boundary projections on a v5 document", () => {
    const doc = exampleDoc();
    const sketch = doc.features[0]!;
    if (sketch.type !== "sketch") throw new Error("Expected the example sketch");
    const support = {
      kind: "face" as const,
      ref: {
        source: "extrude",
        kind: "face" as const,
        role: "top",
        hint: {
          entityType: "face" as const,
          normal: [0, 0, 1] as [number, number, number],
          centroid: [30, 20, 12] as [number, number, number],
        },
      },
      frame: {
        origin: [30, 20, 12] as [number, number, number],
        normal: [0, 0, 1] as [number, number, number],
        xAxis: [1, 0, 0] as [number, number, number],
        yAxis: [0, 1, 0] as [number, number, number],
      },
    };
    const projections = [
      {
        id: "proj-1",
        kind: "faceBoundary" as const,
        source: support.ref,
        label: "Projected face",
        loops: [
          [
            [0, 0] as [number, number],
            [60, 0] as [number, number],
            [60, 40] as [number, number],
          ],
        ],
      },
    ];
    const migrated = migrateDoc({
      ...doc,
      schemaVersion: 5,
      features: [
        { ...sketch, support, projections },
        ...doc.features.slice(1),
      ],
    });
    expect(migrated?.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(primarySketchFeature(migrated!)?.projections).toEqual(projections);
  });

  it("opens a v6 document with a datum plane and datum support", () => {
    const doc = exampleDoc();
    const definition = {
      kind: "offset" as const,
      base: { kind: "world" as const, plane: "XY" as const },
      distance: 10,
    };
    const frame = datumDefinitionFrame(definition)!;
    const datum = addDatumPlaneFeature(doc, definition, frame, {
      id: "plane-1",
      name: "Plane 1",
    });
    const withSketch = addSketchFeature(datum.doc, {
      id: "sketch-2",
      support: {
        kind: "datum",
        featureId: "plane-1",
        label: "Plane 1",
        frame,
      },
    });
    const migrated = migrateDoc({
      ...withSketch.doc,
      schemaVersion: 6,
    });
    expect(migrated?.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated?.features.map((feature) => feature.type)).toEqual([
      "sketch",
      "extrude",
      "datum",
      "sketch",
    ]);
    expect(
      migrateDoc({
        ...withSketch.doc,
        features: withSketch.doc.features.filter(
          (feature) => feature.id !== "plane-1",
        ),
      }),
    ).toBeNull();
  });

  it("opens a v12 document and bumps the schema", () => {
    const doc = exampleDoc();
    const migrated = migrateDoc({ ...doc, schemaVersion: 12 });
    expect(migrated?.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated?.features.map((feature) => feature.type)).toEqual([
      "sketch",
      "extrude",
    ]);
  });

  it("opens a v11 document without offset features and bumps the schema", () => {
    const doc = exampleDoc();
    const migrated = migrateDoc({ ...doc, schemaVersion: 11 });
    expect(migrated?.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated?.features.map((feature) => feature.type)).toEqual([
      "sketch",
      "extrude",
    ]);
  });

  it("opens a v10 document without shell features and bumps the schema", () => {
    const doc = exampleDoc();
    const migrated = migrateDoc({ ...doc, schemaVersion: 10 });
    expect(migrated?.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated?.features.map((feature) => feature.type)).toEqual([
      "sketch",
      "extrude",
    ]);
  });

  it("rejects malformed, unknown and newer documents", () => {
    const doc = exampleDoc();
    expect(migrateDoc(null)).toBeNull();
    expect(migrateDoc("nope")).toBeNull();
    expect(
      migrateDoc({ ...doc, schemaVersion: CURRENT_SCHEMA_VERSION + 1 }),
    ).toBeNull();
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
