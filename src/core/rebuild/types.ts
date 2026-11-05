import type { Doc, ExtrudeOperation, Feature } from "../doc/types";
import type { EdgeRef, ExtrudeParams, TopoRef } from "../kernel/protocol";
import type { SketchRegion } from "../sketch/loops";
import type { SolveOutcome, SolveStatus } from "../sketch/solver";
import type { Sketch } from "../sketch/types";
import type { PlaneFrame } from "../types";

export type RebuildStatus = "ok" | "error";

export type FeatureStatus = "ok" | "error" | "skipped";

export interface RebuildDiagnostic {
  severity: "error" | "warning" | "info";
  /** Stable machine code, e.g. "solve-inconsistent" or "stale-regions". */
  code: string;
  message: string;
}

export interface SketchRebuildOutput {
  kind: "sketch";
  /** The document sketch after the solver's applied solution. */
  sketch: Sketch;
  regions: SketchRegion[];
  /** Local plane -> world. Omitted for the default XY plane. */
  frame?: PlaneFrame;
  dof: number;
  solveStatus: SolveStatus;
  /** Constraint ids the solver could not satisfy, for the DOF/conflict UI. */
  conflicting: string[];
  message?: string;
}

export interface DatumRebuildOutput {
  kind: "datum";
  frame: PlaneFrame;
}

export interface ExtrudeRebuildOutput {
  kind: "extrude";
  params: ExtrudeParams;
  /** The source sketch feature id. */
  sketchId: string;
  /** Region ids actually used (after stale-selection filtering). */
  regionIds: string[];
  /** True when the largest material face was used instead of stored ids. */
  auto: boolean;
  operation: ExtrudeOperation;
  symmetric: boolean;
  end: "blind" | "throughAll";
}

export interface FilletRebuildOutput {
  kind: "fillet";
  edges: EdgeRef[];
  radius: number;
}

export interface ChamferRebuildOutput {
  kind: "chamfer";
  edges: EdgeRef[];
  distance: number;
}

export interface ShellRebuildOutput {
  kind: "shell";
  /** Faces removed by the shell (the openings). */
  faces: TopoRef[];
  thickness: number;
}

export type FeatureOutput =
  | SketchRebuildOutput
  | ExtrudeRebuildOutput
  | DatumRebuildOutput
  | FilletRebuildOutput
  | ChamferRebuildOutput
  | ShellRebuildOutput;

export interface FeatureResult {
  featureId: string;
  type: Feature["type"];
  name: string;
  status: FeatureStatus;
  /** Hash of the canonical feature plus its upstream result key. */
  cacheKey: string;
  upstreamKey: string;
  /** True when this result came from the prefix cache. */
  cached: boolean;
  output: FeatureOutput | null;
  diagnostics: RebuildDiagnostic[];
}

export interface RebuildResult {
  generation: number;
  status: RebuildStatus;
  features: FeatureResult[];
  /** The current kernel input: the last successful extrude. */
  params: ExtrudeParams | null;
  /** The first sketch's solved output, kept for the legacy single-sketch canvas. */
  sketch: SketchRebuildOutput | null;
  /**
   * Every successful sketch output by feature id. The editor can target any
   * sketch feature, not just the first one.
   */
  sketchById: ReadonlyMap<string, SketchRebuildOutput>;
}

export interface RebuildInputs {
  generation?: number;
  /** Prefix cache shared across edits. Keys include the upstream key. */
  cache?: RebuildCache;
  /**
   * Solver outputs the editor already computed for this document. When a
   * sketch id is present, the engine does not solve it again.
   */
  sketchOutcomes?: ReadonlyMap<string, SolveOutcome>;
  /** Face refs the live resolver could not find on the source prefix solid. */
  lostFaceRefs?: ReadonlySet<string>;
}

export interface RebuildDeps {
  solveSketch: (sketch: Sketch) => SolveOutcome;
  regionsFromSketch: (sketch: Sketch) => SketchRegion[];
  extrudeParams: (
    regions: readonly SketchRegion[],
    height: number,
    options?: {
      symmetric?: boolean;
      end?: "blind" | "throughAll";
      frame?: PlaneFrame;
    },
  ) => ExtrudeParams;
}

/**
 * Main-thread prefix cache. Entries are keyed by
 * hash(feature, upstreamKey), so an unrelated downstream edit never evicts a
 * sketch result. The cache is in memory and dropped on reload.
 */
export class RebuildCache {
  private readonly entries = new Map<string, FeatureResult>();
  private readonly limit: number;

  constructor(limit = 128) {
    this.limit = limit;
  }

  get(key: string): FeatureResult | undefined {
    return this.entries.get(key);
  }

  set(key: string, result: FeatureResult): void {
    if (!this.entries.has(key) && this.entries.size >= this.limit) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, result);
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

export function isSketchResult(
  result: FeatureResult | undefined,
): result is FeatureResult & { output: SketchRebuildOutput } {
  return result?.output?.kind === "sketch";
}

export function isExtrudeResult(
  result: FeatureResult | undefined,
): result is FeatureResult & { output: ExtrudeRebuildOutput } {
  return result?.output?.kind === "extrude";
}

export function isFilletResult(
  result: FeatureResult | undefined,
): result is FeatureResult & { output: FilletRebuildOutput } {
  return result?.output?.kind === "fillet";
}

export function isChamferResult(
  result: FeatureResult | undefined,
): result is FeatureResult & { output: ChamferRebuildOutput } {
  return result?.output?.kind === "chamfer";
}

export type { Doc };
