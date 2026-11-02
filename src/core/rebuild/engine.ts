import {
  isDatumPlaneFeature,
  isExtrudeFeature,
  isSketchFeature,
  type DatumPlaneFeature,
  type Doc,
  type ExtrudeFeature,
  type Feature,
  type PlaneRef,
  type SketchFeature,
} from "../doc/types";
import {
  isDefaultSupport,
  midplaneFrame,
  offsetFrame,
  supportFrame,
} from "../doc/support";
import type { PlaneFrame } from "../types";
import type { KernelFeature } from "../kernel/protocol";
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
  const sketchById = new Map<string, SketchRebuildOutput>();
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
    } else if (feature.suppressed) {
      result = {
        featureId: feature.id,
        type: feature.type,
        name: feature.name,
        cacheKey,
        upstreamKey,
        cached: false,
        status: "skipped",
        output: null,
        diagnostics: [
          {
            severity: "info",
            code: "suppressed",
            message: "Suppressed in the history.",
          },
        ],
      };
      cache.set(cacheKey, result);
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
    if (result.output?.kind === "sketch") {
      sketchById.set(feature.id, result.output);
      if (!sketch) sketch = result.output;
    }
  }

  return {
    generation: inputs.generation ?? 0,
    // A suppressed/skipped step is an intentional state, not a rebuild error;
    // the step that actually failed (if any) still makes this "error".
    status: results.every((result) => result.status !== "error") ? "ok" : "error",
    features: results,
    params,
    sketch,
    sketchById,
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
      return evaluateSketch(feature, base, byId, inputs, deps);
    }
    if (isDatumPlaneFeature(feature)) {
      return evaluateDatumPlane(feature, base, byId);
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
  byId: Map<string, FeatureResult>,
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

  let supportLost = false;
  const frame = isDefaultSupport(feature.support)
    ? undefined
    : resolveSupportFrame(feature.support, byId, () => {
        supportLost = true;
      });
  const output: SketchRebuildOutput = {
    kind: "sketch",
    sketch,
    regions,
    ...(frame ? { frame } : {}),
    dof: outcome.dof,
    solveStatus: outcome.status,
    conflicting: outcome.conflicting,
    ...(outcome.message ? { message: outcome.message } : {}),
  };
  if (supportLost) {
    diagnostics.push({
      severity: "error",
      code: "support-lost",
      message: "The sketch support could not be resolved; using its cached frame.",
    });
    return { ...base, status: "error", output, diagnostics };
  }
  return { ...base, status: "ok", output, diagnostics };
}

/** Resolve a support frame through earlier feature results. */
function resolveSupportFrame(
  ref: PlaneRef,
  byId: Map<string, FeatureResult>,
  onLost?: () => void,
): PlaneFrame {
  if (ref.kind !== "datum") return supportFrame(ref);
  const result = byId.get(ref.featureId);
  if (result?.status === "ok" && result.output?.kind === "datum") {
    return result.output.frame;
  }
  onLost?.();
  return ref.frame;
}

function evaluateDatumPlane(
  feature: DatumPlaneFeature,
  base: Omit<FeatureResult, "status" | "output" | "diagnostics">,
  byId: Map<string, FeatureResult>,
): FeatureResult {
  const definition = feature.definition;
  let lost = false;
  const resolve = (ref: PlaneRef): PlaneFrame =>
    resolveSupportFrame(ref, byId, () => {
      lost = true;
    });

  if (definition.kind === "offset") {
    if (!Number.isFinite(definition.distance)) {
      return {
        ...base,
        status: "error",
        output: null,
        diagnostics: [
          {
            severity: "error",
            code: "invalid-offset",
            message: "Datum plane offset must be a finite number.",
          },
        ],
      };
    }
    const frame = offsetFrame(resolve(definition.base), definition.distance);
    if (lost) {
      return {
        ...base,
        status: "error",
        output: { kind: "datum", frame: feature.frame },
        diagnostics: [
          {
            severity: "error",
            code: "support-lost",
            message: "The datum plane base could not be resolved; using its cached frame.",
          },
        ],
      };
    }
    return {
      ...base,
      status: "ok",
      output: { kind: "datum", frame },
      diagnostics: [],
    };
  }

  const a = resolve(definition.a);
  const b = resolve(definition.b);
  if (lost) {
    return {
      ...base,
      status: "error",
      output: { kind: "datum", frame: feature.frame },
      diagnostics: [
        {
          severity: "error",
          code: "support-lost",
          message: "A datum plane base could not be resolved; using its cached frame.",
        },
      ],
    };
  }
  const frame = midplaneFrame(a, b);
  if (!frame) {
    return {
      ...base,
      status: "error",
      output: null,
      diagnostics: [
        {
          severity: "error",
          code: "midplane-not-parallel",
          message: "A midplane needs two parallel supports.",
        },
      ],
    };
  }
  return {
    ...base,
    status: "ok",
    output: { kind: "datum", frame },
    diagnostics: [],
  };
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
  if (feature.end === "throughAll" && feature.operation !== "cut") {
    return {
      ...base,
      status: "error",
      output: null,
      diagnostics: [
        {
          severity: "error",
          code: "through-all-needs-cut",
          message: "Through-all is only available for a cut extrude.",
        },
      ],
    };
  }
  if (
    feature.end !== "throughAll" &&
    (!Number.isFinite(feature.height) || feature.height <= 0)
  ) {
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
    params: deps.extrudeParams(selection.regions, feature.height, {
      symmetric: feature.symmetric,
      end: feature.end,
      frame: source.output.frame,
    }),
    sketchId: feature.sketchId,
    regionIds: selection.ids,
    auto: selection.auto,
    operation: feature.operation,
    symmetric: feature.symmetric,
    end: feature.end,
  };
  return { ...base, status: "ok", output, diagnostics };
}

/**
 * The successful extrude features, in history order, in the shape the kernel
 * worker consumes. Main-thread failures are kept out of this list; their
 * statuses/diagnostics stay in the RebuildResult for the history UI.
 */
export function extractKernelFeatures(result: RebuildResult): KernelFeature[] {
  return result.features.flatMap((feature) => {
    if (feature.status !== "ok" || feature.output?.kind !== "extrude") return [];
    return [
      {
        featureId: feature.featureId,
        cacheKey: feature.cacheKey,
        params: feature.output.params,
        operation: feature.output.operation,
      },
    ];
  });
}
