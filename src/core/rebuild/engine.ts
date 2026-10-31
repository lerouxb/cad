import {
  isExtrudeFeature,
  isSketchFeature,
  type Doc,
  type ExtrudeFeature,
  type Feature,
  type SketchFeature,
} from "../doc/types";
import { extrudeParams, selectExtrudeRegions } from "../features/extrude";
import { applySolution } from "../sketch/geometry";
import { regionsFromSketch } from "../sketch/loops";
import { solveSketch } from "../sketch/solver";
import { canonicalJson, stableHash } from "./hash";
import {
  RebuildCache,
  type ExtrudeRebuildOutput,
  type FeatureResult,
  type RebuildDeps,
  type RebuildDiagnostic,
  type RebuildInputs,
  type RebuildResult,
  type SketchRebuildOutput,
} from "./types";

export const defaultRebuildDeps: RebuildDeps = {
  solveSketch,
  regionsFromSketch,
  extrudeParams,
};

/**
 * Ordered, cached feature evaluation.
 *
 * This is the main-thread half of the M3 rebuild: sketches are solved and
 * profiled here, while the kernel still builds the final extrude in the
 * worker. Feature results carry status and diagnostics so a broken sketch or
 * stale region selection is visible in the history instead of disappearing.
 */
export function rebuildDocument(
  doc: Doc,
  inputs: RebuildInputs = {},
  deps: RebuildDeps = defaultRebuildDeps,
): RebuildResult {
  const cache = inputs.cache ?? new RebuildCache();
  const results: FeatureResult[] = [];
  const byId = new Map<string, FeatureResult>();
  let upstreamKey = "root";
  let params: RebuildResult["params"] = null;
  let sketch: SketchRebuildOutput | null = null;

  for (const feature of doc.features) {
    const contentKey = stableHash(canonicalJson(feature));
    const cacheKey = stableHash(`${contentKey}|${upstreamKey}`);
    const cached = cache.get(cacheKey);

    let result: FeatureResult;
    if (cached) {
      result = { ...cached, cached: true };
    } else {
      result = evaluateFeature(
        feature,
        { cacheKey, upstreamKey },
        byId,
        inputs,
        deps,
      );
      cache.set(cacheKey, result);
    }

    results.push(result);
    byId.set(feature.id, result);
    upstreamKey = cacheKey;

    if (result.status === "ok" && result.output?.kind === "extrude") {
      params = result.output.params;
    }
    if (!sketch && result.output?.kind === "sketch") {
      sketch = result.output;
    }
  }

  return {
    generation: inputs.generation ?? 0,
    status: results.every((result) => result.status === "ok") ? "ok" : "error",
    features: results,
    params,
    sketch,
  };
}

interface Keys {
  cacheKey: string;
  upstreamKey: string;
}

function evaluateFeature(
  feature: Feature,
  keys: Keys,
  byId: Map<string, FeatureResult>,
  inputs: RebuildInputs,
  deps: RebuildDeps,
): FeatureResult {
  const base = {
    featureId: feature.id,
    type: feature.type,
    name: feature.name,
    ...keys,
    cached: false,
  } as const;

  try {
    if (isSketchFeature(feature)) {
      return evaluateSketch(feature, base, inputs, deps);
    }
    if (isExtrudeFeature(feature)) {
      return evaluateExtrude(feature, base, byId, deps);
    }
    return {
      ...base,
      status: "error",
      output: null,
      diagnostics: [
        {
          severity: "error",
          code: "unknown-feature",
          message: `Unknown feature type "${(feature as Feature).type}".`,
        },
      ],
    };
  } catch (error) {
    return {
      ...base,
      status: "error",
      output: null,
      diagnostics: [
        {
          severity: "error",
          code: "feature-exception",
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
}

function evaluateSketch(
  feature: SketchFeature,
  base: Omit<FeatureResult, "status" | "output" | "diagnostics">,
  inputs: RebuildInputs,
  deps: RebuildDeps,
): FeatureResult {
  const outcome =
    inputs.sketchOutcomes?.get(feature.id) ?? deps.solveSketch(feature.sketch);

  if (!outcome.ok) {
    const diagnostics: RebuildDiagnostic[] = [
      {
        severity: "error",
        code: `solve-${outcome.status}`,
        message: outcome.message ?? `Sketch failed to solve (${outcome.status}).`,
      },
    ];
    if (outcome.conflicting.length > 0) {
      diagnostics.push({
        severity: "warning",
        code: "solve-conflicting",
        message: `Unsatisfied constraints: ${outcome.conflicting.join(", ")}.`,
      });
    }
    return { ...base, status: "error", output: null, diagnostics };
  }

  const sketch = applySolution(feature.sketch, outcome);
  const regions = deps.regionsFromSketch(sketch);
  const diagnostics: RebuildDiagnostic[] = [];

  if (outcome.status === "redundant") {
    diagnostics.push({
      severity: "warning",
      code: "solve-redundant",
      message: "The sketch has redundant constraints.",
    });
  }
  if (outcome.conflicting.length > 0) {
    diagnostics.push({
      severity: "warning",
      code: "solve-conflicting",
      message: `Unsatisfied constraints: ${outcome.conflicting.join(", ")}.`,
    });
  }
  if (regions.length === 0) {
    diagnostics.push({
      severity: "warning",
      code: "empty-profile",
      message: "The sketch has no closed profile.",
    });
  }

  const output: SketchRebuildOutput = {
    kind: "sketch",
    sketch,
    regions,
    dof: outcome.dof,
    solveStatus: outcome.status,
  };
  return { ...base, status: "ok", output, diagnostics };
}

function evaluateExtrude(
  feature: ExtrudeFeature,
  base: Omit<FeatureResult, "status" | "output" | "diagnostics">,
  byId: Map<string, FeatureResult>,
  deps: RebuildDeps,
): FeatureResult {
  const source = byId.get(feature.sketchId);
  if (!source) {
    return {
      ...base,
      status: "error",
      output: null,
      diagnostics: [
        {
          severity: "error",
          code: "missing-sketch",
          message: `Sketch "${feature.sketchId}" does not exist earlier in the history.`,
        },
      ],
    };
  }
  if (source.status !== "ok" || source.output?.kind !== "sketch") {
    return {
      ...base,
      status: "skipped",
      output: null,
      diagnostics: [
        {
          severity: "error",
          code: "upstream-error",
          message: `Skipped because ${source.name} could not be evaluated.`,
        },
      ],
    };
  }
  if (feature.operation !== "new") {
    return {
      ...base,
      status: "error",
      output: null,
      diagnostics: [
        {
          severity: "error",
          code: "operation-not-implemented",
          message: `Extrude operation "${feature.operation}" is not implemented yet.`,
        },
      ],
    };
  }
  if (feature.symmetric) {
    return {
      ...base,
      status: "error",
      output: null,
      diagnostics: [
        {
          severity: "error",
          code: "symmetric-not-implemented",
          message: "Symmetric extrudes are not implemented yet.",
        },
      ],
    };
  }
  if (!Number.isFinite(feature.height) || feature.height <= 0) {
    return {
      ...base,
      status: "error",
      output: null,
      diagnostics: [
        {
          severity: "error",
          code: "invalid-height",
          message: "Extrude height must be greater than zero.",
        },
      ],
    };
  }

  const selection = selectExtrudeRegions(source.output.regions, feature.regions);
  if (selection.regions.length === 0) {
    return {
      ...base,
      status: "error",
      output: null,
      diagnostics: [
        {
          severity: "error",
          code: "no-region",
          message: "No closed profile region is available to extrude.",
        },
      ],
    };
  }

  const diagnostics: RebuildDiagnostic[] = [];
  if (selection.stale) {
    diagnostics.push({
      severity: "warning",
      code: "stale-regions",
      message: selection.auto
        ? "The stored region selection no longer exists; using the largest material region."
        : "Some stored region ids no longer exist and were ignored.",
    });
  }

  const output: ExtrudeRebuildOutput = {
    kind: "extrude",
    params: deps.extrudeParams(selection.regions, feature.height),
    sketchId: feature.sketchId,
    regionIds: selection.ids,
    auto: selection.auto,
  };
  return { ...base, status: "ok", output, diagnostics };
}
