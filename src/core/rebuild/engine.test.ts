import { describe, expect, it } from "vitest";
import { createDocument } from "../doc/create";
import {
  updateExtrudeFeature,
  updateExtrudeHeight,
  updateExtrudeRegions,
  updatePrimarySketch,
} from "../doc/selectors";
import { extrudeParams } from "../features/extrude";
import { addCircle, emptySketch } from "../sketch/create";
import { createDemoModel } from "../sketch/demo";
import { sketchGeometry } from "../sketch/geometry";
import { regionsFromSketch } from "../sketch/loops";
import type { ExtrudeFeature, SketchFeature } from "../doc/types";
import type { SolveOutcome } from "../sketch/solver";
import type { Sketch } from "../sketch/types";
import { extractKernelFeatures, rebuildDocument } from "./engine";
import { canonicalJson, stableHash } from "./hash";
import { RebuildCache, type RebuildDeps } from "./types";

function solved(sketch: Sketch): SolveOutcome {
  const geometry = sketchGeometry(sketch);
  return {
    ok: true,
    status: "ok",
    dof: 0,
    points: geometry.points,
    radii: geometry.radii,
    conflicting: [],
  };
}

function countingDeps(): {
  calls: { solve: number; regions: number; extrude: number };
  deps: RebuildDeps;
} {
  const calls = { solve: 0, regions: 0, extrude: 0 };
  return {
    calls,
    deps: {
      solveSketch: (sketch) => {
        calls.solve += 1;
        return solved(sketch);
      },
      regionsFromSketch: (sketch) => {
        calls.regions += 1;
        return regionsFromSketch(sketch);
      },
      extrudeParams: (regions, height, options) => {
        calls.extrude += 1;
        return extrudeParams(regions, height, options);
      },
    },
  };
}

function exampleDoc() {
  return createDocument(createDemoModel().sketch, {
    id: "doc",
    sketchId: "sketch",
    extrudeId: "extrude",
    name: "Part",
    height: 12,
  });
}

describe("ordered rebuild", () => {
  it("evaluates sketch then extrude with diagnostics", () => {
    const { calls, deps } = countingDeps();
    const result = rebuildDocument(
      exampleDoc(),
      { generation: 7, cache: new RebuildCache() },
      deps,
    );

    expect(result.generation).toBe(7);
    expect(result.status).toBe("ok");
    expect(result.features.map((feature) => feature.type)).toEqual([
      "sketch",
      "extrude",
    ]);
    expect(result.features.every((feature) => feature.status === "ok")).toBe(true);
    expect(result.features.every((feature) => !feature.cached)).toBe(true);
    expect(result.sketch?.regions).toHaveLength(2);
    expect(result.params?.height).toBe(12);
    expect(calls).toEqual({ solve: 1, regions: 1, extrude: 1 });
  });

  it("re-evaluates only the extrude when its height changes", () => {
    const { calls, deps } = countingDeps();
    const cache = new RebuildCache();
    const doc = exampleDoc();
    rebuildDocument(doc, { cache }, deps);

    const taller = updateExtrudeHeight(doc, 30);
    const result = rebuildDocument(taller, { cache }, deps);

    expect(result.features[0]?.cached).toBe(true);
    expect(result.features[1]?.cached).toBe(false);
    expect(result.params?.height).toBe(30);
    expect(calls).toEqual({ solve: 1, regions: 1, extrude: 2 });
  });

  it("invalidates the extrude when the upstream sketch changes", () => {
    const { calls, deps } = countingDeps();
    const cache = new RebuildCache();
    const doc = exampleDoc();
    rebuildDocument(doc, { cache }, deps);

    const sketch = doc.features[0];
    if (sketch?.type !== "sketch") throw new Error("Expected a sketch");
    const edited = updatePrimarySketch(
      doc,
      addCircle(sketch.sketch, { point: [45, 20] }, 5),
    );
    const result = rebuildDocument(edited, { cache }, deps);

    expect(result.features[0]?.cached).toBe(false);
    expect(result.features[1]?.cached).toBe(false);
    expect(result.sketch?.regions).toHaveLength(3);
    expect(calls).toEqual({ solve: 2, regions: 2, extrude: 2 });
  });

  it("uses the editor's solved outcome instead of solving again", () => {
    const { calls, deps } = countingDeps();
    const doc = exampleDoc();
    const sketch = doc.features[0];
    if (sketch?.type !== "sketch") throw new Error("Expected a sketch");
    const outcomes = new Map([["sketch", solved(sketch.sketch)]]);

    const result = rebuildDocument(doc, { sketchOutcomes: outcomes }, deps);
    expect(result.status).toBe("ok");
    expect(calls.solve).toBe(0);
    expect(calls.regions).toBe(1);
  });

  it("skips downstream features when the sketch fails and caches the error", () => {
    const deps: RebuildDeps = {
      solveSketch: () => ({
        ok: false,
        status: "inconsistent",
        dof: 0,
        points: {},
        radii: {},
        conflicting: ["c1"],
        message: "Constraints conflict.",
      }),
      regionsFromSketch,
      extrudeParams,
    };
    const cache = new RebuildCache();
    const first = rebuildDocument(exampleDoc(), { cache }, deps);
    const second = rebuildDocument(exampleDoc(), { cache }, deps);

    expect(first.status).toBe("error");
    expect(first.features[0]?.status).toBe("error");
    expect(first.features[1]?.status).toBe("skipped");
    expect(first.params).toBeNull();
    expect(first.features[0]?.diagnostics.map((d) => d.code)).toContain(
      "solve-inconsistent",
    );
    expect(second.features[0]?.cached).toBe(true);
    expect(second.features[1]?.cached).toBe(true);
  });

  it("reports an empty sketch and the extrude that cannot use it", () => {
    const result = rebuildDocument(
      createDocument(emptySketch(), { height: 12 }),
      {},
      countingDeps().deps,
    );
    expect(result.status).toBe("error");
    expect(result.features[0]?.status).toBe("ok");
    expect(result.features[0]?.diagnostics[0]?.code).toBe("empty-profile");
    expect(result.features[1]?.status).toBe("error");
    expect(result.features[1]?.diagnostics[0]?.code).toBe("no-region");
  });

  it("warns about a stale region selection and falls back to material", () => {
    const doc = updateExtrudeRegions(exampleDoc(), ["missing-region"]);
    const result = rebuildDocument(doc, {}, countingDeps().deps);
    const extrude = result.features[1]!;
    expect(result.status).toBe("ok");
    expect(extrude.output?.kind).toBe("extrude");
    if (extrude.output?.kind !== "extrude") throw new Error("Expected extrude");
    expect(extrude.output.auto).toBe(true);
    expect(extrude.diagnostics[0]?.code).toBe("stale-regions");
  });

  it("errors on an invalid height", () => {
    const zero = rebuildDocument(
      updateExtrudeHeight(exampleDoc(), 0),
      {},
      countingDeps().deps,
    );
    expect(zero.status).toBe("error");
    expect(zero.features[1]?.diagnostics[0]?.code).toBe("invalid-height");
  });

  it("evaluates a second sketch and a cut extrude in order", () => {
    const doc = exampleDoc();
    const sketch1 = doc.features[0]!;
    const extrude1 = doc.features[1]!;
    if (sketch1.type !== "sketch" || extrude1.type !== "extrude") {
      throw new Error("Expected the example sketch/extrude");
    }
    const sketch2: SketchFeature = {
      id: "sketch-2",
      type: "sketch",
      name: "Sketch 2",
      support: { kind: "world", plane: "XY" },
      sketch: addCircle(emptySketch(), { point: [30, 20] }, 8),
    };
    const extrude2: ExtrudeFeature = {
      ...extrude1,
      id: "extrude-2",
      name: "Cut 1",
      sketchId: "sketch-2",
      operation: "cut",
      regions: [],
    };
    const twoFeatureDoc = {
      ...doc,
      features: [sketch1, extrude1, sketch2, extrude2],
    };

    const { calls, deps } = countingDeps();
    const result = rebuildDocument(twoFeatureDoc, {}, deps);

    expect(result.status).toBe("ok");
    expect(result.features).toHaveLength(4);
    expect(result.features.every((feature) => feature.status === "ok")).toBe(true);
    expect(result.sketchById.size).toBe(2);
    expect(result.sketchById.get("sketch")?.regions).toHaveLength(2);
    expect(result.sketchById.get("sketch-2")?.regions).toHaveLength(1);
    expect(result.sketch?.sketch.curves.length).toBeGreaterThan(0);
    const kernelFeatures = extractKernelFeatures(result);
    expect(kernelFeatures.map((feature) => feature.operation)).toEqual([
      "new",
      "cut",
    ]);
    expect(kernelFeatures[1]?.params.regions[0]?.outer.kind).toBe("circle");
    expect(calls).toEqual({ solve: 2, regions: 2, extrude: 2 });
  });

  it("skips suppressed features and their dependants", () => {
    const { deps } = countingDeps();
    const suppressedExtrude = updateExtrudeFeature(
      exampleDoc(),
      "extrude",
      (feature) => ({ ...feature, suppressed: true }),
    );
    const extruded = rebuildDocument(suppressedExtrude, {}, deps);
    expect(extruded.status).toBe("ok");
    expect(extruded.features[1]?.status).toBe("skipped");
    expect(extruded.features[1]?.diagnostics[0]?.code).toBe("suppressed");
    expect(extruded.params).toBeNull();

    const doc = exampleDoc();
    const first = doc.features[0]!;
    if (first.type !== "sketch") throw new Error("Expected a sketch");
    const withSuppressedSketch = {
      ...doc,
      features: [{ ...first, suppressed: true }, doc.features[1]!],
    };
    const skipped = rebuildDocument(withSuppressedSketch, {}, deps);
    expect(skipped.features[0]?.status).toBe("skipped");
    expect(skipped.features[1]?.status).toBe("skipped");
    expect(skipped.sketchById.size).toBe(0);
  });

  it("passes symmetric and through-all end conditions to the kernel", () => {
    const { deps } = countingDeps();
    const symmetric = rebuildDocument(
      updateExtrudeFeature(exampleDoc(), "extrude", (feature) => ({
        ...feature,
        symmetric: true,
      })),
      {},
      deps,
    );
    expect(symmetric.params?.symmetric).toBe(true);

    const throughAll = updateExtrudeFeature(
      exampleDoc(),
      "extrude",
      (feature) => ({ ...feature, operation: "cut", end: "throughAll" }),
    );
    const cut = rebuildDocument(throughAll, {}, deps);
    expect(cut.status).toBe("ok");
    expect(cut.params?.end).toBe("throughAll");

    const invalid = rebuildDocument(
      updateExtrudeFeature(exampleDoc(), "extrude", (feature) => ({
        ...feature,
        end: "throughAll",
      })),
      {},
      deps,
    );
    expect(invalid.status).toBe("error");
    expect(invalid.features[1]?.diagnostics[0]?.code).toBe(
      "through-all-needs-cut",
    );
  });

  it("reports an extrude whose source sketch is missing", () => {
    const doc = exampleDoc();
    const isolated = {
      ...doc,
      features: doc.features.filter((feature) => feature.type === "extrude"),
    };
    const result = rebuildDocument(isolated, {}, countingDeps().deps);
    expect(result.status).toBe("error");
    expect(result.features[0]?.diagnostics[0]?.code).toBe("missing-sketch");
  });
});

describe("rebuild cache keys", () => {
  it("canonicalizes object keys and hashes deterministically", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(
      '{"a":{"c":3,"d":2},"b":1}',
    );
    expect(stableHash("same")).toBe(stableHash("same"));
    expect(stableHash("a")).not.toBe(stableHash("b"));
  });

  it("clears its entries and bounds a drag-time cache", () => {
    const cache = new RebuildCache(2);
    const result = rebuildDocument(exampleDoc(), { cache }, countingDeps().deps);
    expect(cache.size).toBe(2);
    expect(result.status).toBe("ok");

    rebuildDocument(
      updateExtrudeHeight(exampleDoc(), 20),
      { cache },
      countingDeps().deps,
    );
    expect(cache.size).toBe(2);
    cache.clear();
    expect(cache.size).toBe(0);
  });
});
