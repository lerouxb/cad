import {
  Fragment,
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import { copyDocument, createBlankDocument } from "../core/doc/create";
import { createExampleDocument } from "../core/doc/example";
import {
  collectDatumFaceRefs,
  faceRefKey,
  refreshDatumFrames,
} from "../core/doc/datum";
import {
  datumDefinitionFrame,
  flipFrame,
  frameFromHint,
  frameFromNormalAndOrigin,
  framesClose,
  isDefaultSupport,
  stabilizeFrame,
  supportFrame,
  supportLabel,
  worldPlaneFrame,
} from "../core/doc/support";
import {
  applyProjectionGeometry,
  newProjectionId,
  projectPointToPlane,
  sameProjectedLoops,
} from "../core/sketch/projection";
import {
  deleteLocalFile,
  deserializeDoc,
  loadDoc,
  loadFileIndex,
  loadLocalFile,
  saveDoc,
  saveLocalFile,
  serializeDoc,
  type LocalFileEntry,
} from "../core/doc/persistence";
import {
  addChamferFeature,
  addDatumPlaneFeature,
  addExtrudeFeature,
  addFilletFeature,
  addSketchFeature,
  datumPlaneFeatures,
  deleteFeature,
  extrudesForSketch,
  findFeature,
  moveFeature,
  primaryExtrudeFeature,
  primarySketch,
  primarySketchFeature,
  renameDocument,
  renameFeature,
  setDatumPlaneHidden,
  setFeatureSuppressed,
  sketchFeatureById,
  updateChamferFeature,
  updateDatumPlaneFeature,
  updateEdgeBlendFeature,
  updateExtrudeFeature,
  updateFeature,
  updateFilletFeature,
  updateSketchFeature,
} from "../core/doc/selectors";
import {
  isChamferFeature,
  isDatumPlaneFeature,
  isEdgeBlendFeature,
  isExtrudeFeature,
  isFilletFeature,
  isSketchFeature,
  type DatumPlaneDefinition,
  type DatumPlaneFeature,
  type Doc,
  type EdgeBlendFeature,
  type ExtrudeFeature,
  type Feature,
  type PlaneRef,
  type SketchFeature,
  type WorldPlane,
} from "../core/doc/types";
import { extrudeParams, selectExtrudeRegions } from "../core/features/extrude";
import { KernelClient } from "../core/kernel/client";
import type {
  BodyMesh,
  EdgeRef,
  FeatureBuildStatus,
  KernelFeature,
} from "../core/kernel/protocol";
import { edgeRefKey } from "../core/kernel/protocol";
import { extractKernelFeatures, rebuildDocument } from "../core/rebuild/engine";
import { canonicalJson, stableHash } from "../core/rebuild/hash";
import {
  RebuildCache,
  type FeatureResult,
  type FeatureStatus,
} from "../core/rebuild/types";
import {
  addArc,
  addCircle,
  addFillet,
  addPoint,
  addPolyline,
  addRectangle,
  emptySketch,
  type DraftVertex,
} from "../core/sketch/create";
import {
  applicableConstraints,
  applyConstraint,
  constructionState,
  toggleConstruction,
  type ConstraintAction,
} from "../core/sketch/constraints";
import {
  addDimension,
  dimensionTargetForSelection,
  removeConstraint,
  setDimensionDriving,
  setDimensionPlacement,
  type DimensionPlacement,
  type DimensionTarget,
} from "../core/sketch/dimensions";
import { clampDemoDrag, isDemoSketch } from "../core/sketch/demo";
import { deleteEntities } from "../core/sketch/edit";
import {
  applySolution,
  arcGeometry,
  arcPointAt,
  curveRadius,
  distance,
  sketchGeometry,
  updateConstraintValue,
} from "../core/sketch/geometry";
import { formatGridStep, type GridStep } from "../core/sketch/grid";
import { regionsFromSketch } from "../core/sketch/loops";
import { frozenSupportPoints } from "../core/sketch/drag";
import {
  initSolver,
  isSolverReady,
  solveDragTargets,
  solveSketch,
  type DragTarget,
  type SolveOutcome,
} from "../core/sketch/solver";
import { trimCurveAt } from "../core/sketch/trim";
import { findSketchPoint, type Sketch } from "../core/sketch/types";
import type { PlaneFrame, ProfileLoop, Vec2, Vec3 } from "../core/types";
import {
  SketchCanvas,
  type SketchTool,
  type SketchTone,
} from "../sketch/SketchCanvas";
import { useHistory } from "../ui/useHistory";
import {
  applyTheme,
  highlighterColor,
  loadTheme,
  sketchPalette,
  type ThemeSettings,
} from "./theme";
import {
  Viewport,
  type BodyPick,
  type SketchOverlayData,
} from "../viewer/Viewport";
import { FeaturePopover } from "./FeaturePopover";
import { SupportPopover } from "./SupportPopover";
import {
  DatumPlanePopover,
  type DatumPlaneDraft,
  type DatumSupportOption,
} from "./DatumPlanePopover";
import { SelectionPopover } from "./SelectionPopover";
import { BodySelectionPopover } from "./BodySelectionPopover";
import { SolidBlendPopover } from "./SolidBlendPopover";
import { FilletPopover } from "./FilletPopover";
import type { PopoverPosition } from "./StagePopover";

type LoadState = "loading" | "ready" | "error";

interface EditorState {
  doc: Doc;
  /** Solver output for the sketch the editor last solved. Derived, not persisted. */
  solved: SolveOutcome | null;
  /** Which sketch feature `solved` belongs to. */
  solvedFor: string | null;
}

interface TreeFeatureState {
  status: FeatureStatus | "pending";
  messages: string[];
  result: FeatureResult | null;
  worker: FeatureBuildStatus | null;
  cached: boolean;
}

/** Timeline cards stay to the operation; full bases live in the selected-step line. */
function datumDefinitionLabel(definition: DatumPlaneDefinition): string {
  return definition.kind === "offset"
    ? `offset ${definition.distance} mm`
    : "midplane";
}

/** Start at the end of the history: selection is the render prefix. */
function initialActiveFeatureId(doc: Doc): string | null {
  return doc.features[doc.features.length - 1]?.id ?? null;
}

/** Resolve the selected step; null means "no step selected, show the end". */
function resolveActiveFeature(doc: Doc, featureId: string | null): Feature | null {
  return featureId ? findFeature(doc, featureId) ?? null : null;
}

/** A sketch feature is edited directly; an extrude edits the sketch it consumes. */
function sketchForFeature(doc: Doc, feature: Feature | null): SketchFeature | null {
  if (!feature) return null;
  if (feature.type === "sketch") return feature;
  if (feature.type === "extrude") {
    return sketchFeatureById(doc, feature.sketchId) ?? null;
  }
  return null;
}

/** What a step creates or references, shown as a chip on the step. */
type TimelineOutput = {
  op: "+" | "→";
  kind: "sketch" | "plane" | "body";
  name: string;
};

function featureTimelineOutput(feature: Feature): TimelineOutput {
  if (isSketchFeature(feature)) {
    return { op: "+", kind: "sketch", name: feature.name };
  }
  if (isDatumPlaneFeature(feature)) {
    return { op: "+", kind: "plane", name: feature.name };
  }
  if (isEdgeBlendFeature(feature)) {
    return { op: "→", kind: "body", name: "body" };
  }
  return {
    op: feature.operation === "new" ? "+" : "→",
    kind: "body",
    name: "body",
  };
}

/**
 * The extrude whose parameters the toolbar/region picker edits. Only an active
 * extrude step owns profile selection. A sketch step does not silently edit its
 * first consumer; use `extrude` to start a new draft or select the extrude step.
 */
function activeExtrudeFor(
  _doc: Doc,
  feature: Feature | null,
  _sketchFeature: SketchFeature | null,
): ExtrudeFeature | null {
  return feature?.type === "extrude" ? feature : null;
}

/**
 * What the feature popover should restore if the user cancels: the feature's
 * parameters and the mode from when the popover opened.
 */
type EditorBaseline = {
  feature: ExtrudeFeature;
  returnMode: "model" | "sketch";
};

/** A new extrude that exists only in the UI until profiles and parameters are
 * chosen. Nothing is written to the document until `extrude` is applied. */
interface ExtrudeDraft {
  sketchId: string;
  regions: string[];
  height: number;
  symmetric: boolean;
  operation: ExtrudeFeature["operation"];
  end: ExtrudeFeature["end"];
}

/**
 * The 3D fillet/chamfer form. A new blend is a UI-only draft that previews
 * through the kernel; editing an existing one commits value/edge changes live
 * and `cancel` restores its baseline.
 */
interface BlendDraft {
  kind: "fillet" | "chamfer";
  mode: "new" | "edit";
  featureId: string | null;
  edges: EdgeRef[];
  /** Fillet radius or chamfer distance, in millimetres. */
  value: number;
  /** Where a new feature is inserted; null appends at the end. */
  anchorId: string | null;
}

/** Default size: a fraction of the shortest selected edge, clamped to sane mm. */
function defaultBlendValue(
  mesh: BodyMesh | null,
  edges: readonly EdgeRef[],
): number {
  const lengths = edges
    .map((edge) => edge.hint.length)
    .filter((length): length is number => (length ?? 0) > 1e-6);
  const bounds = mesh?.stats.bounds;
  const minBody = bounds
    ? Math.min(bounds[3] - bounds[0], bounds[4] - bounds[1], bounds[5] - bounds[2])
    : 12;
  const basedOnEdge =
    lengths.length > 0 ? Math.min(...lengths) * 0.15 : minBody * 0.1;
  return Math.max(0.5, Math.min(5, Math.round(basedOnEdge * 10) / 10));
}

function edgeBodyPick(edge: EdgeRef): BodyPick {
  return {
    kind: "edge",
    id: `edge-${edgeRefKey(edge)}`,
    edgeRef: edge,
  };
}

const PENDING_CONFLICT_ID = "pending-conflict";

export function App() {
  const [initialEditor] = useState<EditorState>(() => {
    const saved = loadDoc();
    if (saved) return { doc: saved, solved: null, solvedFor: null };
    return {
      doc: createExampleDocument(),
      solved: null,
      solvedFor: null,
    };
  });
  const history = useHistory<EditorState>(initialEditor);
  const { state: editor, getState, commit, replace, reset, undo, redo, endMerge } =
    history;
  const doc = editor.doc;
  const [activeFeatureId, setActiveFeatureId] = useState<string | null>(() =>
    initialActiveFeatureId(initialEditor.doc),
  );
  const activeFeature = useMemo(
    () => resolveActiveFeature(doc, activeFeatureId),
    [doc, activeFeatureId],
  );
  const activeFeatureIndex = useMemo(
    () =>
      activeFeature
        ? doc.features.findIndex((feature) => feature.id === activeFeature.id)
        : -1,
    [doc, activeFeature],
  );
  const activeSketchFeature = useMemo(
    () => sketchForFeature(doc, activeFeature),
    [doc, activeFeature],
  );
  const activeExtrude = useMemo(
    () => activeExtrudeFor(doc, activeFeature, activeSketchFeature),
    [doc, activeFeature, activeSketchFeature],
  );
  const sketch = activeSketchFeature?.sketch ?? primarySketch(doc);
  const primarySketchId = primarySketchFeature(doc)?.id ?? null;
  const primaryExtrudeId = primaryExtrudeFeature(doc)?.id ?? null;
  const [extrudeDraft, setExtrudeDraft] = useState<ExtrudeDraft | null>(null);
  const [datumDraft, setDatumDraft] = useState<DatumPlaneDraft | null>(null);
  const extrudeHeight = activeExtrude?.height ?? 12;
  const storedRegionIds = extrudeDraft
    ? extrudeDraft.regions
    : activeExtrude?.regions;

  const [themeSettings, setThemeSettings] = useState<ThemeSettings>(() => loadTheme());
  const palette = useMemo(() => sketchPalette(themeSettings), [themeSettings]);
  const [mode, setMode] = useState<"model" | "sketch">("model");
  const [tool, setTool] = useState<SketchTool>("select");
  const [dimensionRequest, setDimensionRequest] = useState<{
    target: DimensionTarget;
    seq: number;
  } | null>(null);
  const dimensionRequestSeq = useRef(0);
  const [filletRadius, setFilletRadius] = useState(5);
  const [filletOpen, setFilletOpen] = useState(false);
  const [filletRadiusBefore, setFilletRadiusBefore] = useState<number | null>(
    null,
  );
  const [selection, setSelection] = useState<string[]>([]);
  const [cancelToken, setCancelToken] = useState(0);
  const [fitToken, setFitToken] = useState(0);
  const [referenceDimensions, setReferenceDimensions] = useState(false);
  const [gridStep, setGridStep] = useState<GridStep>("auto");
  const [resolvedGridStep, setResolvedGridStep] = useState(10);
  const [gridPixels, setGridPixels] = useState(20);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [zoomPreset, setZoomPreset] = useState("fit");
  const handleZoomChange = useCallback((percent: number): void => {
    setZoomPreset(String(percent));
  }, []);
  const [zoomRequest, setZoomRequest] = useState<{
    seq: number;
    value: "fit" | number;
  } | null>(null);
  const [solveError, setSolveError] = useState<SolveOutcome | null>(null);
  const [lostFaceRefs, setLostFaceRefs] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const markFaceRefLost = useCallback((key: string, lost: boolean): void => {
    setLostFaceRefs((current) => {
      if (current.has(key) === lost) return current;
      const next = new Set(current);
      if (lost) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);
  /** A constraint that would be valid on its own but made the sketch
   * inconsistent. It is shown as an active chip so the same click releases it;
   * it is not written to the document. */
  const [pendingConstraint, setPendingConstraint] =
    useState<ConstraintAction | null>(null);
  const [trimNotice, setTrimNotice] = useState<string | null>(null);
  const [solverState, setSolverState] = useState<LoadState>("loading");
  const [solverError, setSolverError] = useState<string | null>(null);
  const [mesh, setMesh] = useState<BodyMesh | null>(null);
  const [roundTripMs, setRoundTripMs] = useState<number | null>(null);
  const [kernelState, setKernelState] = useState<LoadState>("loading");
  const [kernelError, setKernelError] = useState<string | null>(null);
  const [workerStatuses, setWorkerStatuses] = useState<FeatureBuildStatus[]>([]);
  const [kernelVersion, setKernelVersion] = useState(0);
  const [bodyPick, setBodyPick] = useState<BodyPick | null>(null);
  /** Ephemeral model edge multi-selection; App owns the policy. */
  const [edgeSelection, setEdgeSelection] = useState<BodyPick[]>([]);
  const [bodyPopoverPosition, setBodyPopoverPosition] =
    useState<PopoverPosition>({ x: 22, y: 112 });
  const [blendDraft, setBlendDraft] = useState<BlendDraft | null>(null);
  const [blendBaseline, setBlendBaseline] = useState<EdgeBlendFeature | null>(
    null,
  );
  const [editorOpen, setEditorOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [supportPlane, setSupportPlane] = useState<WorldPlane>("XY");
  const [supportDatumId, setSupportDatumId] = useState<string | null>(null);
  const [supportFaceFlipped, setSupportFaceFlipped] = useState(false);
  const [creationAnchorId, setCreationAnchorId] = useState<string | null>(null);
  const [creationAtStart, setCreationAtStart] = useState(false);
  const [insertMenu, setInsertMenu] = useState<{
    anchorId: string | null;
    atStart: boolean;
    left: number;
  } | null>(null);
  const [editorBaseline, setEditorBaseline] = useState<EditorBaseline | null>(
    null,
  );
  const [popoverPosition, setPopoverPosition] = useState<PopoverPosition>({
    x: 22,
    y: 72,
  });
  const [draggingFeatureId, setDraggingFeatureId] = useState<string | null>(
    null,
  );
  const [historyNotice, setHistoryNotice] = useState<string | null>(null);
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [docRename, setDocRename] = useState<string | null>(null);
  const [fileIndex, setFileIndex] = useState<LocalFileEntry[]>(() =>
    loadFileIndex(),
  );
  const [fileDeleteId, setFileDeleteId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(
    null,
  );

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timelineTrackRef = useRef<HTMLDivElement>(null);
  const clientRef = useRef<KernelClient | null>(null);
  const viewportRef = useRef<Viewport | null>(null);
  const handleBodyPickRef = useRef<
    (pick: BodyPick | null, additive: boolean) => void
  >(() => {});
  const cancelBlendRef = useRef<() => void>(() => {});
  const blendDraftOpenRef = useRef(false);
  const faceBoundaryCache = useRef(
    new Map<string, { frame: PlaneFrame; loops: Vec3[][] }>(),
  );
  const faceBoundaryPending = useRef(new Set<string>());
  const [rebuildCache] = useState(() => new RebuildCache());

  const geometry = useMemo(() => sketchGeometry(sketch), [sketch]);
  // Region fills can render from the raw sketch before the solver is ready.
  // Once it is, the ordered rebuild owns the solved sketch and its regions.
  const localRegions = useMemo(() => regionsFromSketch(sketch), [sketch]);
  const sketchOutcomes = useMemo(() => {
    const outcomes = new Map<string, SolveOutcome>();
    if (activeSketchFeature && editor.solvedFor === activeSketchFeature.id && editor.solved) {
      outcomes.set(activeSketchFeature.id, editor.solved);
    }
    return outcomes;
  }, [activeSketchFeature, editor.solved, editor.solvedFor]);
  // Selection is the history cursor: the stage always renders the prefix
  // through the selected step. Downstream steps stay in the timeline, paused.
  const buildDoc = useMemo(
    () =>
      activeFeatureIndex >= 0 &&
      activeFeatureIndex < doc.features.length - 1
        ? { ...doc, features: doc.features.slice(0, activeFeatureIndex + 1) }
        : doc,
    [doc, activeFeatureIndex],
  );
  // Lost support is reported per face ref. Undo, document switches and deleted
  // features leave keys behind that no longer belong to this history; only
  // refs that still exist may affect diagnostics and cache keys.
  const currentFaceRefKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const feature of buildDoc.features) {
      if (isSketchFeature(feature) && feature.support.kind === "face") {
        keys.add(faceRefKey(feature.support.ref));
      }
    }
    for (const ref of collectDatumFaceRefs(buildDoc)) {
      keys.add(faceRefKey(ref));
    }
    return keys;
  }, [buildDoc]);
  const activeLostFaceRefs = useMemo(() => {
    if (lostFaceRefs.size === 0) return lostFaceRefs;
    let stale = false;
    const next = new Set<string>();
    for (const key of lostFaceRefs) {
      if (currentFaceRefKeys.has(key)) next.add(key);
      else stale = true;
    }
    return stale ? next : lostFaceRefs;
  }, [lostFaceRefs, currentFaceRefKeys]);
  const rebuild = useMemo(() => {
    if (solverState !== "ready") return null;
    return rebuildDocument(buildDoc, {
      cache: rebuildCache,
      sketchOutcomes,
      lostFaceRefs: activeLostFaceRefs,
    });
  }, [
    buildDoc,
    solverState,
    sketchOutcomes,
    rebuildCache,
    activeLostFaceRefs,
  ]);
  const activeSketchBuild = activeSketchFeature
    ? rebuild?.sketchById.get(activeSketchFeature.id) ?? null
    : null;
  const regions = activeSketchBuild?.regions ?? localRegions;
  const regionSelection = useMemo(() => {
    if (extrudeDraft) {
      const wanted = new Set(extrudeDraft.regions);
      const selected = regions.filter((region) => wanted.has(region.id));
      return {
        ids: selected.map((region) => region.id),
        regions: selected,
        auto: false,
        stale: false,
      };
    }
    return selectExtrudeRegions(regions, storedRegionIds ?? []);
  }, [regions, storedRegionIds, extrudeDraft]);
  const activeRegionIds = regionSelection.ids;
  const activeRegions = regionSelection.regions;
  const selectedRegions = useMemo(
    () =>
      new Set(activeExtrude || extrudeDraft ? activeRegionIds : []),
    [activeExtrude, extrudeDraft, activeRegionIds],
  );
  const modelSketchOverlay = useMemo<SketchOverlayData | null>(() => {
    if (
      mode !== "model" ||
      supportOpen ||
      datumDraft !== null ||
      !activeSketchFeature ||
      activeSketchFeature.suppressed
    ) {
      return null;
    }
    const points = geometry.points;
    const curves: Array<SketchOverlayData["curves"][number]> = [];
    const frame =
      activeSketchBuild?.frame ??
      (isDefaultSupport(activeSketchFeature.support)
        ? undefined
        : supportFrame(activeSketchFeature.support));

    // When an extrude step is active, show only the profile loops that extrude
    // actually uses. The full sketch is still visible in profile-selection mode.
    const usedProfiles =
      activeFeature?.type === "extrude" && activeRegions.length > 0;
    if (usedProfiles) {
      const seen = new Set<string>();
      const closeRing = (
        source: ReadonlyArray<Vec2>,
      ): Array<[number, number]> => {
        const closed = source.map(([x, y]) => [x, y] as [number, number]);
        if (closed.length > 1) {
          const first = closed[0]!;
          const last = closed[closed.length - 1]!;
          if (first[0] !== last[0] || first[1] !== last[1]) {
            closed.push([first[0], first[1]]);
          }
        }
        return closed;
      };
      const loopPoints = (loop: ProfileLoop): Vec2[] => {
        if (loop.kind === "circle") {
          return Array.from({ length: 65 }, (_, index) => {
            const angle = (index / 64) * Math.PI * 2;
            return [
              loop.center[0] + Math.cos(angle) * loop.radius,
              loop.center[1] + Math.sin(angle) * loop.radius,
            ];
          });
        }
        return loop.points;
      };
      const pushCurve = (source: ReadonlyArray<Vec2>): void => {
        if (source.length < 2) return;
        const closed = closeRing(source);
        const key = closed
          .map(([x, y]) => `${x.toFixed(4)},${y.toFixed(4)}`)
          .join(";");
        if (seen.has(key)) return;
        seen.add(key);
        curves.push({ points: closed });
      };
      const fills: Array<{
        outer: Array<[number, number]>;
        holes: Array<Array<[number, number]>>;
      }> = [];
      for (const region of activeRegions) {
        const outer = loopPoints(region.outer);
        const holes = region.holes.map(loopPoints);
        if (outer.length >= 3) {
          fills.push({
            outer: closeRing(outer),
            holes: holes
              .filter((hole) => hole.length >= 3)
              .map(closeRing),
          });
        }
        pushCurve(outer);
        for (const hole of holes) pushCurve(hole);
      }
      return { curves, points: [], fills, ...(frame ? { frame } : {}) };
    }

    for (const curve of activeSketchFeature.sketch.curves) {
      if (curve.type === "line") {
        const a = points[curve.a];
        const b = points[curve.b];
        if (a && b) {
          curves.push({
            points: [a, b],
            ...(curve.construction ? { construction: true } : {}),
          });
        }
      } else if (curve.type === "circle") {
        const center = points[curve.center];
        const radius = geometry.radii[curve.id] ?? curve.radius;
        if (!center) continue;
        const samples: Array<[number, number]> = [];
        for (let index = 0; index <= 64; index++) {
          const angle = (index / 64) * Math.PI * 2;
          samples.push([
            center[0] + Math.cos(angle) * radius,
            center[1] + Math.sin(angle) * radius,
          ]);
        }
        curves.push({
          points: samples,
          ...(curve.construction ? { construction: true } : {}),
        });
      } else {
        const arc = arcGeometry(curve, points);
        if (!arc) continue;
        curves.push({
          points: Array.from({ length: 33 }, (_, index) =>
            arcPointAt(arc, index / 32),
          ),
          ...(curve.construction ? { construction: true } : {}),
        });
      }
    }
    return {
      curves,
      points: activeSketchFeature.sketch.points.flatMap((point) => {
        const position = points[point.id];
        return position
          ? [
              {
                position,
                ...(point.construction ? { construction: true } : {}),
              },
            ]
          : [];
      }),
      ...(frame ? { frame } : {}),
    };
  }, [
    mode,
    activeSketchFeature,
    activeFeature,
    activeRegions,
    geometry,
    activeSketchBuild,
    supportOpen,
    datumDraft,
  ]);
  // While editing a sketch on a world or datum plane there is no supporting
  // face to project. Show the body that exists at this step as faint projected
  // edges, so the sketch has a spatial reference. Face sketches already get
  // the supporting boundary through their live projection.
  const bodyReferenceEdges = useMemo<
    Array<[number, number, number, number]>
  >(() => {
    if (
      mode !== "sketch" ||
      activeFeature?.type !== "sketch" ||
      !activeSketchFeature ||
      !mesh ||
      activeSketchFeature.support.kind === "face"
    ) {
      return [];
    }
    const frame =
      activeSketchBuild?.frame ??
      (isDefaultSupport(activeSketchFeature.support)
        ? undefined
        : supportFrame(activeSketchFeature.support));
    const origin = frame?.origin ?? [0, 0, 0];
    const xAxis = frame?.xAxis ?? [1, 0, 0];
    const yAxis = frame?.yAxis ?? [0, 1, 0];
    const positions = mesh.edgePositions;
    const edges: Array<[number, number, number, number]> = [];
    const project = (
      x: number,
      y: number,
      z: number,
    ): [number, number] => {
      const dx = x - origin[0];
      const dy = y - origin[1];
      const dz = z - origin[2];
      return [
        dx * xAxis[0] + dy * xAxis[1] + dz * xAxis[2],
        dx * yAxis[0] + dy * yAxis[1] + dz * yAxis[2],
      ];
    };
    for (let index = 0; index + 5 < positions.length; index += 6) {
      const a = project(
        positions[index]!,
        positions[index + 1]!,
        positions[index + 2]!,
      );
      const b = project(
        positions[index + 3]!,
        positions[index + 4]!,
        positions[index + 5]!,
      );
      edges.push([a[0], a[1], b[0], b[1]]);
    }
    return edges;
  }, [
    mode,
    activeFeature,
    activeSketchFeature,
    activeSketchBuild,
    mesh,
  ]);
  const activeVoidCount = useMemo(
    () => activeRegions.filter((region) => region.kind === "void").length,
    [activeRegions],
  );
  const hasVoids = useMemo(
    () => regions.some((region) => region.kind === "void"),
    [regions],
  );
  const fallbackParams = useMemo(
    () =>
      activeExtrude && activeRegions.length > 0
        ? extrudeParams(activeRegions, extrudeHeight, {
            symmetric: activeExtrude.symmetric,
            end: activeExtrude.end,
          })
        : null,
    [activeExtrude, activeRegions, extrudeHeight],
  );
  const selectedEdgeRefs = useMemo(
    () =>
      edgeSelection
        .map((pick) => pick.edgeRef)
        .filter((ref): ref is EdgeRef => ref !== undefined),
    [edgeSelection],
  );
  const solidFeatures = useMemo<KernelFeature[]>(() => {
    let features: KernelFeature[];
    if (rebuild) {
      features = extractKernelFeatures(rebuild);
    } else if (fallbackParams && activeExtrude) {
      const operation = activeExtrude.operation;
      features = [
        {
          kind: "extrude",
          featureId: activeExtrude.id,
          cacheKey: `fallback-${stableHash(
            canonicalJson({ params: fallbackParams, operation }),
          )}`,
          params: fallbackParams,
          operation,
        },
      ];
    } else {
      features = [];
    }
    // Preview a new fillet/chamfer through the kernel without writing it to
    // the document. The draft sits after the rendered prefix, exactly where
    // apply will insert it.
    if (
      blendDraft?.mode === "new" &&
      blendDraft.edges.length > 0 &&
      blendDraft.value > 0 &&
      features.length > 0
    ) {
      const draft = blendDraft;
      const common = {
        featureId: `${draft.kind}-draft`,
        cacheKey: `${draft.kind}-draft-${stableHash(
          canonicalJson({
            kind: draft.kind,
            edges: draft.edges,
            value: draft.value,
            upstream: features.map((feature) => feature.cacheKey),
          }),
        )}`,
        edges: draft.edges,
      };
      features = [
        ...features,
        draft.kind === "fillet"
          ? { kind: "fillet", ...common, radius: draft.value }
          : { kind: "chamfer", ...common, distance: draft.value },
      ];
    }
    return features;
  }, [rebuild, fallbackParams, activeExtrude, blendDraft]);
  const rebuildDiagnostics = useMemo(
    () =>
      rebuild?.features
        .flatMap((feature) =>
          feature.diagnostics.map((diagnostic) => ({
            feature: feature.name,
            diagnostic,
          })),
        ) ?? [],
    [rebuild],
  );
  const activeWorkerStatuses = useMemo(
    () =>
      workerStatuses.filter((status) =>
        solidFeatures.some((feature) => feature.featureId === status.featureId),
      ),
    [workerStatuses, solidFeatures],
  );
  const featureStates = useMemo(() => {
    const states = new Map<string, TreeFeatureState>();
    for (const feature of doc.features) {
      const result =
        rebuild?.features.find((candidate) => candidate.featureId === feature.id) ??
        null;
      const worker =
        activeWorkerStatuses.find((status) => status.featureId === feature.id) ??
        null;
      const messages: string[] = [];
      for (const diagnostic of result?.diagnostics ?? []) {
        if (diagnostic.severity === "error") messages.push(diagnostic.message);
      }
      if (worker && worker.status !== "ok") {
        messages.push(worker.message ?? `Solid build ${worker.status}.`);
      }
      const status: TreeFeatureState["status"] =
        worker && worker.status !== "ok"
          ? worker.status
          : result
            ? result.status
            : worker
              ? worker.status
              : "pending";
      states.set(feature.id, {
        status,
        messages,
        result,
        worker,
        cached: result?.cached ?? worker?.cached ?? false,
      });
    }
    return states;
  }, [doc.features, rebuild, activeWorkerStatuses]);
  const workerDiagnostics = useMemo(
    () =>
      activeWorkerStatuses
        .filter((status) => status.status !== "ok")
        .map((status) => ({
          feature: doc.features.find((feature) => feature.id === status.featureId)
            ?.name ?? status.featureId,
          diagnostic: {
            severity: "error" as const,
            code: `worker-${status.status}`,
            message: status.message ?? "Solid build failed.",
          },
        })),
    [activeWorkerStatuses, doc.features],
  );
  const allDiagnostics = useMemo(
    () => [
      ...rebuildDiagnostics,
      ...workerDiagnostics,
      ...(kernelError
        ? [
            {
              feature: "Kernel",
              diagnostic: {
                severity: "error" as const,
                code: "kernel-error",
                message: kernelError,
              },
            },
          ]
        : []),
    ],
    [rebuildDiagnostics, workerDiagnostics, kernelError],
  );
  const firstRebuildError = allDiagnostics.find(
    ({ diagnostic }) => diagnostic.severity === "error",
  );
  const rebuildStatus =
    rebuild?.status === "error" ||
    activeWorkerStatuses.some((s) => s.status !== "ok")
      ? "error"
      : rebuild
        ? "ok"
        : "pending";

  const selectedInfo = useMemo(
    () => describeSelection(sketch, geometry, selection),
    [sketch, geometry, selection],
  );

  const selectedSet = useMemo(() => new Set(selectedInfo.map((info) => info.id)), [selectedInfo]);
  const constraintActions = useMemo(() => {
    const actions = applicableConstraints(sketch, selection);
    const pending = pendingConstraint;
    if (!pending) return actions;
    return actions.map((action) =>
      action.type === pending.type && !action.applied
        ? { ...action, applied: true, id: PENDING_CONFLICT_ID }
        : action,
    );
  }, [sketch, selection, pendingConstraint]);

  const clearTransientSolve = (): void => {
    setPendingConstraint(null);
    setSolveError(null);
  };
  const construction = useMemo(
    () => constructionState(sketch, selection),
    [sketch, selection],
  );
  const dimensionTarget = useMemo(
    () => dimensionTargetForSelection(sketch, selection),
    [sketch, selection],
  );
  const radiusTarget = useMemo(
    () => dimensionTargetForSelection(sketch, selection, true),
    [sketch, selection],
  );
  const trimCurve = useMemo(() => {
    if (selection.length !== 1) return null;
    const curve = sketch.curves.find((candidate) => candidate.id === selection[0]);
    if (!curve) return null;
    if (curve.type === "line" && curve.reference) return null;
    return curve.type === "line" || curve.type === "arc" ? curve : null;
  }, [sketch.curves, selection]);
  const filletSelection = useMemo(() => {
    const lines = sketch.curves.filter(
      (curve): curve is Extract<typeof curve, { type: "line" }> =>
        curve.type === "line" && selectedSet.has(curve.id),
    );
    if (lines.length !== 2) return null;
    const [a, b] = lines;
    if (!a || !b) return null;
    const shared = [a.a, a.b].find((id) => id === b.a || id === b.b);
    return shared ? { a, b } : null;
  }, [sketch, selectedSet]);

  const resolveCurrent = () => {
    const current = getState();
    const feature = resolveActiveFeature(current.doc, activeFeatureId);
    const sketchFeature = sketchForFeature(current.doc, feature);
    const extrude = activeExtrudeFor(current.doc, feature, sketchFeature);
    return { current, feature, sketchFeature, extrude };
  };
  const currentSketch = (): Sketch =>
    resolveCurrent().sketchFeature?.sketch ?? emptySketch();
  const currentSolve = (): SolveOutcome | null => {
    const { current, sketchFeature: target } = resolveCurrent();
    return target && current.solvedFor === target.id ? current.solved : null;
  };

  const commitDoc = (
    nextSketch: Sketch,
    outcome: SolveOutcome | null,
    mergeKey?: string,
  ): void => {
    const { current, sketchFeature: target } = resolveCurrent();
    if (!target) return;
    commit(
      {
        doc: updateSketchFeature(current.doc, target.id, nextSketch),
        solved: outcome,
        solvedFor: target.id,
      },
      mergeKey,
    );
    setSolveError(null);
    setPendingConstraint(null);
  };

  /** Solve, then commit both the geometry and its diagnostics. */
  const solveAndCommit = (next: Sketch, mergeKey?: string): boolean => {
    if (!isSolverReady()) return false;
    const outcome = solveSketch(next);
    if (!outcome.ok) {
      setSolveError(outcome);
      return false;
    }
    commitDoc(applySolution(next, outcome), outcome, mergeKey);
    return true;
  };

  const changeTool = (next: SketchTool): void => {
    clearTransientSolve();
    setTool(next);
    setDimensionRequest(null);
    setSelection([]);
    setTrimNotice(null);
  };

  const requestZoom = (value: string): void => {
    setZoomPreset(value);
    setZoomRequest((current) => ({
      seq: (current?.seq ?? 0) + 1,
      value: value === "fit" ? "fit" : Number(value),
    }));
  };

  const handleExtrudeHeight = (height: number): void => {
    const { current, extrude } = resolveCurrent();
    if (!extrude) return;
    const next = updateExtrudeFeature(current.doc, extrude.id, (feature) =>
      feature.height === height ? feature : { ...feature, height },
    );
    if (next === current.doc) return;
    commit(
      { doc: next, solved: current.solved, solvedFor: current.solvedFor },
      "extrude-height",
    );
  };

  const updateActiveExtrude = (
    update: (feature: ExtrudeFeature) => ExtrudeFeature,
    mergeKey?: string,
  ): void => {
    const { current, extrude } = resolveCurrent();
    if (!extrude) return;
    const next = updateExtrudeFeature(current.doc, extrude.id, update);
    if (next === current.doc) return;
    commit(
      { doc: next, solved: current.solved, solvedFor: current.solvedFor },
      mergeKey,
    );
  };

  const dismissEditor = (): void => {
    setEditorOpen(false);
    setEditorBaseline(null);
    setExtrudeDraft(null);
    setBlendDraft(null);
    setBlendBaseline(null);
  };

  const openBlendEditor = (feature: EdgeBlendFeature): void => {
    dismissEditor();
    setDatumDraft(null);
    setSupportOpen(false);
    setBlendBaseline(feature);
    setBlendDraft({
      kind: feature.type === "fillet" ? "fillet" : "chamfer",
      mode: "edit",
      featureId: feature.id,
      edges: [...feature.edges],
      value: feature.type === "fillet" ? feature.radius : feature.distance,
      anchorId: null,
    });
    const picks = feature.edges.map(edgeBodyPick);
    setEdgeSelection(picks);
    viewportRef.current?.setEdgeSelection(picks);
    setMode("model");
    setSelection([]);
    setBodyPick(null);
  };

  /** Footer cancel / background click restores an edge blend as opened. */
  const cancelBlendEditor = (): void => {
    const baseline = blendBaseline;
    dismissEditor();
    if (baseline) {
      const current = getState();
      const next = updateEdgeBlendFeature(
        current.doc,
        baseline.id,
        () => baseline,
      );
      if (next !== current.doc) {
        commit({
          doc: next,
          solved: current.solved,
          solvedFor: current.solvedFor,
        });
      }
      setActiveFeatureId(baseline.id);
    }
    setEdgeSelection([]);
    setBodyPick(null);
    viewportRef.current?.clearPick();
    setSelection([]);
  };

  /** Start a UI-only fillet/chamfer draft from the selected edges. */
  const beginBlendDraft = (kind: "fillet" | "chamfer"): void => {
    const edges = selectedEdgeRefs;
    if (edges.length === 0) return;
    dismissEditor();
    setDatumDraft(null);
    setSupportOpen(false);
    setHistoryNotice(null);
    setBlendDraft({
      kind,
      mode: "new",
      featureId: null,
      edges: [...edges],
      value: defaultBlendValue(mesh, edges),
      anchorId: activeFeatureId,
    });
    setMode("model");
    setSelection([]);
    setBodyPick(null);
  };

  const updateBlendValue = (value: number): void => {
    if (!blendDraft || !Number.isFinite(value) || value <= 0) return;
    setBlendDraft({ ...blendDraft, value });
    if (blendDraft.mode === "edit" && blendDraft.featureId) {
      const current = getState();
      const id = blendDraft.featureId;
      const next =
        blendDraft.kind === "fillet"
          ? updateFilletFeature(current.doc, id, (feature) => ({
              ...feature,
              radius: value,
            }))
          : updateChamferFeature(current.doc, id, (feature) => ({
              ...feature,
              distance: value,
            }));
      if (next !== current.doc) {
        commit(
          { doc: next, solved: current.solved, solvedFor: current.solvedFor },
          `${blendDraft.kind}-size`,
        );
      }
    }
  };

  const updateBlendEdges = (edges: EdgeRef[]): void => {
    if (!blendDraft) return;
    setBlendDraft({ ...blendDraft, edges });
    const picks = edges.map(edgeBodyPick);
    setEdgeSelection(picks);
    viewportRef.current?.setEdgeSelection(picks);
    if (blendDraft.mode === "edit" && blendDraft.featureId) {
      const current = getState();
      const next = updateEdgeBlendFeature(
        current.doc,
        blendDraft.featureId,
        (feature) => ({ ...feature, edges }),
      );
      if (next !== current.doc) {
        commit({ doc: next, solved: current.solved, solvedFor: current.solvedFor });
      }
    }
  };

  /**
   * A pick from the 3D stage. Faces/datum stay single-select; edges accumulate
   * while Shift is held or a fillet draft is open, and toggle on a repeat click.
   */
  const handleBodyPick = (
    pick: BodyPick | null,
    additive: boolean,
  ): void => {
    setSupportDatumId(
      pick?.kind === "datum" ? pick.datumId ?? null : null,
    );
    if (!pick) {
      if (blendDraft) {
        cancelBlendEditor();
        return;
      }
      setBodyPick(null);
      setEdgeSelection([]);
      viewportRef.current?.setEdgeSelection([]);
      return;
    }
    if (pick.kind === "edge" && pick.edgeRef) {
      const ref = pick.edgeRef;
      const known = (source: string): boolean =>
        source !== "fillet-draft" &&
        source !== blendDraft?.featureId &&
        doc.features.some((feature) => feature.id === source);
      // The stage may be previewing the draft fillet itself. Edges on those
      // generated rounds (or on the feature being edited) cannot be inputs.
      if (!known(ref.faces[0].source) || !known(ref.faces[1].source)) return;

      const key = edgeRefKey(ref);
      const selected = edgeSelection.some(
        (item) =>
          item.edgeRef !== undefined && edgeRefKey(item.edgeRef) === key,
      );
      const toggle = additive || blendDraft !== null;
      let next: BodyPick[];
      if (toggle && selected) {
        next = edgeSelection.filter(
          (item) =>
            item.edgeRef === undefined || edgeRefKey(item.edgeRef) !== key,
        );
      } else if (toggle) {
        next = [...edgeSelection, pick];
      } else {
        next = [pick];
      }
      // While the fillet form is open it is the readout; the small pick badge
      // would overlap it and repeat the same selection.
      setBodyPick(!blendDraft && next.length > 0 ? pick : null);
      setEdgeSelection(next);
      viewportRef.current?.setEdgeSelection(next);
      if (blendDraft) {
        updateBlendEdges(
          next
            .map((item) => item.edgeRef)
            .filter((edge): edge is EdgeRef => edge !== undefined),
        );
      }
      return;
    }

    setBodyPick(pick);
    setEdgeSelection([]);
    viewportRef.current?.setEdgeSelection([]);
  };
  // The viewport and the global keyboard effect are created once; a ref keeps
  // them pointed at the current handlers without re-registering listeners.
  useEffect(() => {
    handleBodyPickRef.current = handleBodyPick;
    cancelBlendRef.current = cancelBlendEditor;
    blendDraftOpenRef.current = blendDraft !== null;
  });

  const applyBlendDraft = (): void => {
    const draft = blendDraft;
    if (!draft || draft.edges.length === 0 || !(draft.value > 0)) return;
    const current = getState();
    if (draft.mode === "new") {
      const result =
        draft.kind === "fillet"
          ? addFilletFeature(current.doc, draft.edges, draft.value, {
              afterFeatureId: draft.anchorId,
            })
          : addChamferFeature(current.doc, draft.edges, draft.value, {
              afterFeatureId: draft.anchorId,
            });
      commit({
        doc: result.doc,
        solved: current.solved,
        solvedFor: current.solvedFor,
      });
      setActiveFeatureId(result.feature.id);
    } else if (draft.featureId) {
      setActiveFeatureId(draft.featureId);
    }
    dismissEditor();
    setEdgeSelection([]);
    setBodyPick(null);
    viewportRef.current?.clearPick();
    setMode("model");
    setSelection([]);
    setHistoryNotice(null);
  };

  const openExtrudeEditor = (
    feature: ExtrudeFeature,
    returnMode: "model" | "sketch" = mode,
  ): void => {
    setEditorBaseline({ feature, returnMode });
    setEditorOpen(true);
  };

  /** Cancel restores the feature as it was when the popover opened. */
  const cancelFeatureEditor = (): void => {
    const baseline = editorBaseline;
    setEditorOpen(false);
    setEditorBaseline(null);
    if (!baseline) return;
    const current = getState();
    const next = updateExtrudeFeature(
      current.doc,
      baseline.feature.id,
      () => baseline.feature,
    );
    if (next !== current.doc) {
      commit({ doc: next, solved: current.solved, solvedFor: current.solvedFor });
    }
    setMode(baseline.returnMode);
    setSelection([]);
    setFitToken((token) => token + 1);
  };

  const handleExtrudeOperation = (
    operation: ExtrudeFeature["operation"],
  ): void => {
    updateActiveExtrude((feature) => ({
      ...feature,
      operation,
      // Through-all is only meaningful for a cut.
      end: operation === "cut" ? feature.end : "blind",
    }));
  };

  const handleExtrudeSketch = (sketchId: string): void => {
    updateActiveExtrude((feature) =>
      feature.sketchId === sketchId
        ? feature
        : { ...feature, sketchId, regions: [] },
    );
    setSelection([]);
    setFitToken((token) => token + 1);
  };

  const handleToggleSymmetric = (): void => {
    updateActiveExtrude((feature) => ({
      ...feature,
      symmetric: !feature.symmetric,
    }));
  };

  const handleExtrudeEnd = (end: ExtrudeFeature["end"]): void => {
    if (end === "throughAll") {
      updateActiveExtrude((feature) => ({
        ...feature,
        operation: "cut",
        end,
      }));
      return;
    }
    updateActiveExtrude((feature) => ({ ...feature, end }));
  };

  const handleToggleDatumVisibility = (feature: Feature): void => {
    if (!isDatumPlaneFeature(feature)) return;
    const current = getState();
    const next = setDatumPlaneHidden(
      current.doc,
      feature.id,
      feature.hidden !== true,
    );
    if (next === current.doc) return;
    commit({ doc: next, solved: current.solved, solvedFor: current.solvedFor });
    if (bodyPick?.kind === "datum" && bodyPick.datumId === feature.id) {
      setBodyPick(null);
      setEdgeSelection([]);
      viewportRef.current?.clearPick();
    }
  };

  const handleToggleSuppress = (feature: Feature): void => {
    const current = getState();
    const next = setFeatureSuppressed(
      current.doc,
      feature.id,
      feature.suppressed !== true,
    );
    if (next === current.doc) return;
    commit({ doc: next, solved: current.solved, solvedFor: current.solvedFor });
  };

  const handleDeleteFeature = (feature: Feature): void => {
    const current = getState();
    const result = deleteFeature(current.doc, feature.id);
    if (result.removedIds.length === 0) return;
    commit({
      doc: result.doc,
      solved: current.solved,
      solvedFor: current.solvedFor,
    });
    if (activeFeatureId && result.removedIds.includes(activeFeatureId)) {
      const fallback =
        result.doc.features[result.doc.features.length - 1] ?? null;
      setActiveFeatureId(fallback?.id ?? null);
    }
    if (result.removedIds.length > 1) {
      setHistoryNotice(
        `Deleted ${result.removedIds.length} features including dependants.`,
      );
    }
  };

  const handleMoveFeature = (featureId: string, toIndex: number): void => {
    const current = getState();
    const result = moveFeature(current.doc, featureId, toIndex);
    if ("error" in result) {
      setHistoryNotice(result.error);
      return;
    }
    commit({
      doc: result.doc,
      solved: current.solved,
      solvedFor: current.solvedFor,
    });
    setHistoryNotice(null);
  };

  /** Clear the history cursor: keep the whole document, select no step. */
  const clearActiveFeature = (): void => {
    clearTransientSolve();
    dismissEditor();
    setDatumDraft(null);
    setSupportOpen(false);
    setInsertMenu(null);
    setCreationAnchorId(null);
    setCreationAtStart(false);
    setActiveFeatureId(null);
    setMode("model");
    setSelection([]);
    setTrimNotice(null);
    setBodyPick(null);
    setEdgeSelection([]);
    viewportRef.current?.clearPick();
  };

  const activateFeature = (feature: Feature): void => {
    clearTransientSolve();
    dismissEditor();
    setDatumDraft(null);
    setSupportOpen(false);
    setCreationAtStart(false);
    setActiveFeatureId(feature.id);
    setMode(feature.type === "sketch" ? "sketch" : "model");
    setSelection([]);
    setTrimNotice(null);
    setBodyPick(null);
    setEdgeSelection([]);
    viewportRef.current?.clearPick();
    if (feature.type === "sketch") {
      setTool("select");
      setCancelToken((token) => token + 1);
      return;
    }
    // Selecting a step is how you edit it: a sketch opens its canvas, an
    // extrude or datum opens its parameter popover. There is no separate
    // "edit" command.
    if (feature.type === "extrude") {
      openExtrudeEditor(feature, "model");
    } else if (isEdgeBlendFeature(feature)) {
      openBlendEditor(feature);
    } else {
      openDatumEditor(feature);
    }
  };

  const finishSketch = (): void => {
    const { current, sketchFeature: currentSketchFeatureValue } = resolveCurrent();
    const consumers = currentSketchFeatureValue
      ? extrudesForSketch(current.doc, currentSketchFeatureValue.id).filter(
          (extrude) => extrude.suppressed !== true,
        )
      : [];
    // Only auto-select an extrude when the sketch has one clear consumer.
    // With multiple, staying on the sketch avoids editing a random extrude.
    if (consumers.length === 1) setActiveFeatureId(consumers[0]!.id);
    dismissEditor();
    setMode("model");
    setSelection([]);
  };

  /** Enter/Done while an extrude is active returns to the model without
   * switching the active feature to a different consuming extrude. */
  const finishActiveMode = (): void => {
    if (extrudeDraft) {
      commitExtrudeDraft();
      return;
    }
    if (activeFeature?.type === "extrude") {
      dismissEditor();
      setMode("model");
      setSelection([]);
      return;
    }
    finishSketch();
  };

  const selectExtrudeProfiles = (): void => {
    if (extrudeDraft) {
      setMode("sketch");
      setTool("select");
      setSelection([]);
      setCancelToken((token) => token + 1);
      setFitToken((token) => token + 1);
      return;
    }
    if (!editorOpen && activeFeature?.type === "extrude") {
      openExtrudeEditor(activeFeature);
    }
    setEditorOpen(true);
    setMode("sketch");
    setTool("select");
    setSelection([]);
    setCancelToken((token) => token + 1);
    setFitToken((token) => token + 1);
  };

  const resolvedDatumFrame = useCallback(
    (feature: DatumPlaneFeature): PlaneFrame => {
      const result = featureStates.get(feature.id)?.result;
      if (result?.status === "ok" && result.output?.kind === "datum") {
        return result.output.frame;
      }
      return feature.frame;
    },
    [featureStates],
  );

  const datumPlaneOverlays = useMemo(
    () =>
      datumPlaneFeatures(buildDoc)
        .filter((feature) => feature.suppressed !== true && feature.hidden !== true)
        .map((feature) => ({
          featureId: feature.id,
          frame: resolvedDatumFrame(feature),
        })),
    [buildDoc, resolvedDatumFrame],
  );

  const openDatumEditor = (feature: DatumPlaneFeature): void => {
    const definition = feature.definition;
    setDatumDraft({
      id: feature.id,
      name: feature.name,
      kind: definition.kind,
      base: definition.kind === "offset" ? definition.base : definition.a,
      second:
        definition.kind === "midplane"
          ? definition.b
          : { kind: "world", plane: "XZ" },
      distance: definition.kind === "offset" ? definition.distance : 10,
    });
    dismissEditor();
    setCreationAtStart(false);
    setActiveFeatureId(feature.id);
    setMode("model");
    setSelection([]);
    setBodyPick(null);
    setEdgeSelection([]);
    viewportRef.current?.clearPick();
  };

  const openDatumDraft = (
    anchorId: string | null = activeFeatureId,
    atStart = false,
  ): void => {
    dismissEditor();
    setExtrudeDraft(null);
    setCreationAnchorId(atStart ? null : anchorId);
    setCreationAtStart(atStart);
    setDatumDraft({
      id: null,
      kind: "offset",
      base: { kind: "world", plane: "XY" },
      second: { kind: "world", plane: "YZ" },
      distance: 10,
    });
    setSupportOpen(false);
    setFileMenuOpen(false);
    setHistoryNotice(null);
    setSelection([]);
    setMode("model");
  };

  /** Move the history cursor without opening an editor; used by insert gaps. */
  const moveCursor = (feature: Feature): void => {
    clearTransientSolve();
    dismissEditor();
    setDatumDraft(null);
    setSupportOpen(false);
    setActiveFeatureId(feature.id);
    setMode("model");
    setSelection([]);
  };

  const insertMenuLeft = (target: HTMLElement): number => {
    const timeline = target.closest(".timeline")?.getBoundingClientRect();
    const rect = target.getBoundingClientRect();
    const width = timeline?.width ?? 600;
    return Math.max(
      8,
      Math.min(
        rect.left + rect.width / 2 - (timeline?.left ?? 0) - 90,
        width - 200,
      ),
    );
  };

  const openInsertMenu = (feature: Feature, target: HTMLElement): void => {
    moveCursor(feature);
    setInsertMenu({
      anchorId: feature.id,
      atStart: false,
      left: insertMenuLeft(target),
    });
  };

  const openStartInsertMenu = (target: HTMLElement): void => {
    // The start gap has no step before it: keep the cursor where it is, but
    // leave the sketch canvas so the support picker is visible.
    dismissEditor();
    setDatumDraft(null);
    setSupportOpen(false);
    setSelection([]);
    setMode("model");
    setInsertMenu({
      anchorId: null,
      atStart: true,
      left: insertMenuLeft(target),
    });
  };

  const openInsertSketch = (
    anchorId: string | null,
    atStart = false,
  ): void => {
    dismissEditor();
    setDatumDraft(null);
    setSupportPlane("XY");
    setSupportDatumId(
      bodyPick?.kind === "datum" ? bodyPick.datumId ?? null : null,
    );
    setSupportFaceFlipped(false);
    setCreationAnchorId(atStart ? null : anchorId);
    setCreationAtStart(atStart);
    setSupportOpen(true);
    setFileMenuOpen(false);
    setInsertMenu(null);
  };

  const openInsertPlane = (
    anchorId: string | null,
    atStart = false,
  ): void => {
    openDatumDraft(anchorId, atStart);
    setInsertMenu(null);
  };

  const commitDatumDraft = (): void => {
    if (!datumDraft) return;
    const definition: DatumPlaneDefinition =
      datumDraft.kind === "offset"
        ? {
            kind: "offset",
            base: datumDraft.base,
            distance: datumDraft.distance,
          }
        : {
            kind: "midplane",
            a: datumDraft.base,
            b: datumDraft.second,
          };
    const frame = datumDefinitionFrame(definition);
    if (!frame) {
      setHistoryNotice(
        datumDraft.kind === "midplane"
          ? "A midplane needs two parallel supports."
          : "The datum plane base could not be resolved.",
      );
      return;
    }
    const current = getState();
    if (datumDraft.id) {
      const next = updateDatumPlaneFeature(current.doc, datumDraft.id, (feature) => ({
        ...feature,
        definition,
        frame,
      }));
      if (next === current.doc) {
        setDatumDraft(null);
        return;
      }
      commit({ doc: next, solved: current.solved, solvedFor: current.solvedFor });
      setActiveFeatureId(datumDraft.id);
    } else {
      const { doc, feature } = addDatumPlaneFeature(
        current.doc,
        definition,
        frame,
        { afterFeatureId: creationAnchorId, atStart: creationAtStart },
      );
      commit({ doc, solved: current.solved, solvedFor: current.solvedFor });
      setActiveFeatureId(feature.id);
    }
    setDatumDraft(null);
    setCreationAnchorId(null);
    setCreationAtStart(false);
    setHistoryNotice(null);
    setSelection([]);
    // The support pick that seeded this datum is no longer the subject.
    setBodyPick(null);
    setEdgeSelection([]);
    viewportRef.current?.clearPick();
  };

  const cancelDatumDraft = (): void => {
    setDatumDraft(null);
    setCreationAnchorId(null);
    setHistoryNotice(null);
  };

  /** Recover a sketch/datum whose live face support disappeared. */
  const reselectActiveSupport = (): void => {
    if (!activeFeature) return;
    if (activeFeature.type === "datum") {
      openDatumEditor(activeFeature);
      return;
    }
    if (activeFeature.type !== "sketch") return;
    const support = activeFeature.support;
    if (support.kind === "datum") {
      const datum = findFeature(getState().doc, support.featureId);
      if (datum?.type === "datum") openDatumEditor(datum);
      return;
    }
    if (support.kind !== "face") return;
    const faceRef = bodyPick?.kind === "face" ? (bodyPick.ref ?? null) : null;
    const rawFrame = faceRef ? frameFromHint(faceRef.hint) : null;
    const frame = rawFrame
      ? stabilizeFrame(rawFrame, support.frame)
      : null;
    if (!faceRef || !frame) {
      setHistoryNotice("Pick a planar face first, then reselect.");
      return;
    }
    const current = getState();
    markFaceRefLost(faceRefKey(support.ref), false);
    const nextDoc = updateFeature(current.doc, activeFeature.id, (feature) =>
      feature.type === "sketch"
        ? { ...feature, support: { kind: "face", ref: faceRef, frame } }
        : feature,
    );
    commit({ doc: nextDoc, solved: current.solved, solvedFor: current.solvedFor });
    setBodyPick(null);
    setEdgeSelection([]);
    viewportRef.current?.clearPick();
    setHistoryNotice(null);
  };

  const handleNewSketch = (): void => {
    const current = getState();
    const faceRef =
      bodyPick?.kind === "face" ? (bodyPick.ref ?? null) : null;
    if (bodyPick?.kind === "face" && !faceRef) {
      setHistoryNotice("This face has no stable reference; choose a world plane.");
      return;
    }
    const hintFrame = faceRef ? frameFromHint(faceRef.hint) : null;
    if (faceRef && !hintFrame) {
      setHistoryNotice("Only planar faces can support a sketch.");
      return;
    }
    const frame =
      hintFrame && supportFaceFlipped ? flipFrame(hintFrame) : hintFrame;
    const datumFeature =
      !faceRef && supportDatumId
        ? findFeature(current.doc, supportDatumId)
        : null;
    if (supportDatumId && (!datumFeature || !isDatumPlaneFeature(datumFeature))) {
      setHistoryNotice("The selected datum plane no longer exists.");
      return;
    }
    const datumFrame =
      datumFeature && isDatumPlaneFeature(datumFeature)
        ? resolvedDatumFrame(datumFeature)
        : null;
    if (datumFeature && !datumFrame) {
      setHistoryNotice("The selected datum plane could not be resolved.");
      return;
    }
    const support =
      faceRef && frame
        ? ({ kind: "face", ref: faceRef, frame } as const)
        : datumFeature && datumFrame
          ? ({
              kind: "datum",
              featureId: datumFeature.id,
              label: datumFeature.name,
              frame: datumFrame,
            } as const)
          : ({ kind: "world", plane: supportPlane } as const);
    // The projected boundary arrives from the kernel's exact face wire via the
    // live-reference effect below; do not materialize a mesh approximation here
    // or its first exact update would look like a topology change.
    const { doc: nextDoc, feature } = addSketchFeature(current.doc, {
      support,
      afterFeatureId: creationAnchorId,
      atStart: creationAtStart,
    });
    const outcome = isSolverReady() ? solveSketch(feature.sketch) : null;
    commit({ doc: nextDoc, solved: outcome, solvedFor: feature.id });
    setActiveFeatureId(feature.id);
    dismissEditor();
    setSupportOpen(false);
    setSupportDatumId(null);
    setSupportFaceFlipped(false);
    setCreationAnchorId(null);
    setCreationAtStart(false);
    setHistoryNotice(null);
    setMode("sketch");
    setSelection([]);
    setSolveError(null);
    setTool("select");
    setZoomPreset("fit");
    setFitToken((token) => token + 1);
    setBodyPick(null);
    setEdgeSelection([]);
    viewportRef.current?.clearPick();
  };

  const beginExtrudeDraft = (regions: readonly string[] = []): void => {
    const { current, sketchFeature: source } = resolveCurrent();
    if (!source) return;
    dismissEditor();
    setSupportOpen(false);
    setActiveFeatureId(source.id);
    // Default to join when the document already has a body. A join with
    // nothing to join would be a silent fallback; the draft says "new"
    // instead. (The new extrude appends after the existing history, so this
    // looks at the whole document, not just the prefix at the sketch cursor.)
    const hasBody = current.doc.features.some(
      (feature) => isExtrudeFeature(feature) && feature.suppressed !== true,
    );
    setExtrudeDraft({
      sketchId: source.id,
      regions: [...regions],
      height: primaryExtrudeFeature(current.doc)?.height ?? 12,
      symmetric: false,
      operation: hasBody ? "join" : "new",
      end: "blind",
    });
    // Stay in the sketch to choose profiles and edit the extrude parameters.
    setMode("sketch");
    setTool("select");
    setSelection([]);
    setTrimNotice(null);
    setBodyPick(null);
    setEdgeSelection([]);
    viewportRef.current?.clearPick();
  };

  const handleNewExtrude = (): void => {
    beginExtrudeDraft();
    setCancelToken((token) => token + 1);
    setZoomPreset("fit");
    setFitToken((token) => token + 1);
  };

  const updateExtrudeDraft = (
    update: (draft: ExtrudeDraft) => ExtrudeDraft,
  ): void => {
    setExtrudeDraft((draft) => (draft ? update(draft) : draft));
  };

  const commitExtrudeDraft = (): void => {
    const draft = extrudeDraft;
    // A profile is the one thing a new extrude cannot infer. Do not create the
    // feature until the user has explicitly chosen at least one region.
    if (!draft || draft.regions.length === 0) return;
    const current = getState();
    const result = addExtrudeFeature(current.doc, draft.sketchId, {
      height: draft.height,
      operation: draft.operation,
    });
    if (!result) return;
    const doc = updateExtrudeFeature(result.doc, result.feature.id, (feature) => ({
      ...feature,
      regions: [...draft.regions],
      symmetric: draft.symmetric,
      end: draft.end,
    }));
    commit({ doc, solved: current.solved, solvedFor: current.solvedFor });
    setExtrudeDraft(null);
    setActiveFeatureId(result.feature.id);
    setMode("model");
    setSelection([]);
  };

  const cancelExtrudeDraft = (): void => {
    setExtrudeDraft(null);
    setSelection([]);
    // The draft was started from a sketch step; cancelling returns to that sketch.
  };

  const beginRename = (feature: Feature): void => {
    setRenaming({ id: feature.id, value: feature.name });
  };

  const commitRename = (): void => {
    if (!renaming) return;
    const current = getState();
    const next = renameFeature(current.doc, renaming.id, renaming.value);
    setRenaming(null);
    if (next === current.doc) return;
    commit({
      doc: next,
      solved: current.solved,
      solvedFor: current.solvedFor,
    });
  };

  const handleSelect = (entityId: string | null, additive: boolean): void => {
    clearTransientSolve();
    if (filletOpen) {
      setFilletOpen(false);
      setFilletRadiusBefore(null);
    }
    if (entityId === null) {
      if (extrudeDraft) {
        cancelExtrudeDraft();
        return;
      }
      setSelection((current) => (current.length === 0 ? current : []));
      return;
    }
    setSelection((current) => {
      if (!additive) {
        return current.length === 1 && current[0] === entityId ? current : [entityId];
      }
      return current.includes(entityId)
        ? current.filter((id) => id !== entityId)
        : [...current, entityId];
    });
  };

  const deleteSelection = (): void => {
    if (filletOpen) {
      setFilletOpen(false);
      setFilletRadiusBefore(null);
    }
    const deletable = selectedInfo.filter((info) => info.kind !== "reference");
    if (deletable.length === 0) return;
    const base = currentSketch();
    const next = deleteEntities(
      base,
      deletable.map((info) => info.id),
    );
    if (next === base) return;
    setSelection([]);
    solveAndCommit(next);
  };

  // Key handlers are registered once but must see the current selection and
  // active feature. Tool shortcuts enter the active sketch (or its source).
  const deleteKey = useEffectEvent(() => deleteSelection());
  const enterSketchMode = useEffectEvent(() => {
    const { sketchFeature: target } = resolveCurrent();
    if (target) setActiveFeatureId(target.id);
    setMode("sketch");
  });

  useEffect(() => {
    let cancelled = false;
    initSolver()
      .then(() => {
        if (cancelled) return;
        const current = getState();
        const outcomes = new Map<string, SolveOutcome>();
        let nextDoc = current.doc;
        for (const feature of current.doc.features) {
          if (!isSketchFeature(feature)) continue;
          const outcome = solveSketch(feature.sketch);
          outcomes.set(feature.id, outcome);
          nextDoc = updateSketchFeature(
            nextDoc,
            feature.id,
            outcome.ok ? applySolution(feature.sketch, outcome) : feature.sketch,
          );
        }
        if (cancelled) return;
        // The model view starts on the first extrude, so solve its sketch last
        // for the editor's cached outcome.
        const firstExtrude = current.doc.features.find(isExtrudeFeature);
        const preferred =
          firstExtrude?.sketchId ?? outcomes.keys().next().value ?? null;
        replace({
          doc: nextDoc,
          solved: preferred ? outcomes.get(preferred) ?? null : null,
          solvedFor: preferred ?? null,
        });
        setSolverState("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setSolverError(error instanceof Error ? error.message : String(error));
        setSolverState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [getState, replace]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const initialTheme = loadTheme();
    const viewport = new Viewport(canvas, {
      theme: initialTheme.mode,
      highlightColor: highlighterColor(
        initialTheme.highlight,
        initialTheme.mode,
      ).color,
      onPick: (pick, additive) => {
        // The viewport is created once; route picks through the current
        // handler so edge multi-select sees fresh draft/selection state.
        handleBodyPickRef.current(pick, additive);
      },
    });
    viewportRef.current = viewport;

    const client = new KernelClient({
      onReady: () => setKernelState("ready"),
      onMesh: (nextMesh, elapsed, features) => {
        setMesh(nextMesh);
        setRoundTripMs(elapsed);
        setKernelState("ready");
        setKernelError(null);
        setWorkerStatuses(features);
        setKernelVersion((version) => version + 1);
        viewport.setMesh(nextMesh);
      },
      onError: (message, features) => {
        setKernelError(message);
        setKernelState("error");
        setWorkerStatuses(features ?? []);
      },
    });
    clientRef.current = client;

    return () => {
      client.dispose();
      viewport.dispose();
      clientRef.current = null;
      viewportRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (solidFeatures.length === 0) {
      viewportRef.current?.clearMesh();
      return;
    }
    const timer = window.setTimeout(
      () => clientRef.current?.rebuild(solidFeatures),
      60,
    );
    return () => window.clearTimeout(timer);
  }, [solidFeatures]);

  // Re-project face-supported sketches from the body prefix that owns the face.
  // The worker resolves the prefix solid by cacheKey, so downstream booleans
  // cannot move or split the reference outline.
  useEffect(() => {
    const client = clientRef.current;
    if (!client || !rebuild) return;

    const applyBoundary = (
      featureId: string,
      sourceSupport: Extract<PlaneRef, { kind: "face" }>,
      rawFrame: PlaneFrame,
      worldLoops: Vec3[][],
    ): void => {
      const latest = getState();
      const target = findFeature(latest.doc, featureId);
      if (!target || !isSketchFeature(target) || target.support.kind !== "face") {
        return;
      }
      const faceSupport = target.support;
      if (
        faceSupport.ref.source !== sourceSupport.ref.source ||
        faceSupport.ref.role !== sourceSupport.ref.role
      ) {
        return;
      }
      const frame = stabilizeFrame(rawFrame, faceSupport.frame);
      const loops = worldLoops.map((loop) =>
        loop.map((point) => projectPointToPlane(point, frame)),
      );
      const projection = target.projections?.find(
        (candidate) => candidate.kind === "faceBoundary",
      );
      const supportChanged = !framesClose(faceSupport.frame, frame);
      let sketch = target.sketch;
      let nextProjection = projection;
      let projections = target.projections;
      if (projection) {
        if (!sameProjectedLoops(projection.loops, loops)) {
          const next = applyProjectionGeometry(
            sketch,
            projection.id,
            projection.label,
            loops,
            true,
          );
          if (next) {
            sketch = next;
            nextProjection = { ...projection, loops, stale: undefined };
          } else {
            // The topology changed and the cached reference geometry cannot be
            // rewired. Mark it stale once; retrying with the same cached loops
            // would replace the document forever.
            nextProjection = projection.stale
              ? projection
              : { ...projection, stale: true };
          }
        }
      } else if (loops.length > 0) {
        const id = newProjectionId();
        const next = applyProjectionGeometry(
          sketch,
          id,
          "Projected face",
          loops,
        );
        if (next) {
          sketch = next;
          nextProjection = {
            id,
            kind: "faceBoundary",
            source: faceSupport.ref,
            label: "Projected face",
            loops,
          };
        }
      }
      if (!nextProjection) return;
      if (!supportChanged && nextProjection === projection) return;
      projections = [
        nextProjection,
        ...(projections ?? []).filter(
          (candidate) => candidate.id !== nextProjection!.id,
        ),
      ];
      const nextDoc = {
        ...latest.doc,
        features: latest.doc.features.map((candidate) =>
          candidate.id === target.id
            ? {
                ...target,
                support: { ...faceSupport, frame },
                sketch,
                projections,
              }
            : candidate,
        ),
      };
      // Re-solve so constraints against the moved references (point-on-line,
      // coincident, ...) are satisfied immediately rather than after the next
      // drag. This is a derived update: it must not add an undo step.
      const outcome = isSolverReady() ? solveSketch(sketch) : null;
      replace({
        doc: outcome?.ok
          ? updateSketchFeature(
              nextDoc,
              target.id,
              applySolution(sketch, outcome),
            )
          : nextDoc,
        solved: outcome,
        solvedFor: target.id,
      });
    };

    const current = getState();
    for (const feature of current.doc.features) {
      if (!isSketchFeature(feature) || feature.support.kind !== "face") continue;
      const sourceSupport = feature.support;
      const sourceResult = rebuild.features.find(
        (result) => result.featureId === sourceSupport.ref.source,
      );
      const lostKey = faceRefKey(sourceSupport.ref);
      if (!sourceResult || sourceResult.status !== "ok" || !sourceResult.cacheKey) {
        queueMicrotask(() => markFaceRefLost(lostKey, true));
        continue;
      }
      const key = `${sourceResult.cacheKey}|${sourceSupport.ref.role}`;
      const cached = faceBoundaryCache.current.get(key);
      if (cached) {
        queueMicrotask(() => markFaceRefLost(lostKey, false));
        applyBoundary(feature.id, sourceSupport, cached.frame, cached.loops);
        continue;
      }
      if (faceBoundaryPending.current.has(key)) continue;
      faceBoundaryPending.current.add(key);
      client
        .requestFaceBoundary(sourceResult.cacheKey, sourceSupport.ref)
        .then((result) => {
          faceBoundaryPending.current.delete(key);
          markFaceRefLost(lostKey, false);
          const rawFrame = frameFromNormalAndOrigin(
            result.normal,
            result.centroid,
          );
          if (!rawFrame) return;
          faceBoundaryCache.current.set(key, {
            frame: rawFrame,
            loops: result.loops,
          });
          applyBoundary(feature.id, sourceSupport, rawFrame, result.loops);
        })
        .catch((error: unknown) => {
          faceBoundaryPending.current.delete(key);
          if (
            error instanceof Error &&
            !error.message.includes("no longer cached")
          ) {
            markFaceRefLost(lostKey, true);
          }
        });
    }
  }, [rebuild, kernelVersion, getState, replace, markFaceRefLost]);

  // Datum planes can be based on a face. Resolve those frames from the source
  // feature's cached prefix solid (not the final body), then refresh the datum
  // chain and its dependent sketch snapshots. This is derived state: no undo
  // entry and no solver reset.
  useEffect(() => {
    const client = clientRef.current;
    if (!client || !rebuild) return;

    const applyCachedFrames = (): void => {
      const latest = getState();
      const frames = new Map<string, PlaneFrame>();
      for (const ref of collectDatumFaceRefs(latest.doc)) {
        const source = rebuild.features.find(
          (feature) => feature.featureId === ref.source,
        );
        if (!source || source.status !== "ok" || !source.cacheKey) {
          queueMicrotask(() => markFaceRefLost(faceRefKey(ref), true));
          continue;
        }
        const cached = faceBoundaryCache.current.get(
          `${source.cacheKey}|${ref.role}`,
        );
        if (cached) frames.set(faceRefKey(ref), cached.frame);
      }
      const nextDoc = refreshDatumFrames(latest.doc, frames);
      if (nextDoc === latest.doc) return;
      replace({
        doc: nextDoc,
        solved: latest.solved,
        solvedFor: latest.solvedFor,
      });
    };

    applyCachedFrames();

    for (const ref of collectDatumFaceRefs(getState().doc)) {
      const source = rebuild.features.find(
        (feature) => feature.featureId === ref.source,
      );
      const lostKey = faceRefKey(ref);
      if (!source || source.status !== "ok" || !source.cacheKey) {
        queueMicrotask(() => markFaceRefLost(lostKey, true));
        continue;
      }
      const key = `${source.cacheKey}|${ref.role}`;
      if (faceBoundaryCache.current.has(key)) {
        queueMicrotask(() => markFaceRefLost(lostKey, false));
        continue;
      }
      if (faceBoundaryPending.current.has(key)) continue;
      faceBoundaryPending.current.add(key);
      client
        .requestFaceBoundary(source.cacheKey, ref)
        .then((result) => {
          faceBoundaryPending.current.delete(key);
          markFaceRefLost(lostKey, false);
          const frame = frameFromNormalAndOrigin(result.normal, result.centroid);
          if (!frame) return;
          faceBoundaryCache.current.set(key, { frame, loops: result.loops });
          applyCachedFrames();
        })
        .catch((error: unknown) => {
          faceBoundaryPending.current.delete(key);
          if (
            error instanceof Error &&
            !error.message.includes("no longer cached")
          ) {
            markFaceRefLost(lostKey, true);
          }
        });
    }
  }, [rebuild, kernelVersion, getState, replace, markFaceRefLost]);

  useEffect(() => {
    viewportRef.current?.setActive(mode === "model");
  }, [mode]);

  useEffect(() => {
    viewportRef.current?.setEdgeSelection(edgeSelection);
  }, [edgeSelection]);

  useEffect(() => {
    viewportRef.current?.setSketchOverlay(modelSketchOverlay);
  }, [modelSketchOverlay]);

  // On an extrude step, the feature it created is the subject of the stage.
  // The sketch overlay still shows the profile it consumed.
  const featureHighlightId = useMemo(() => {
    if (
      mode !== "model" ||
      supportOpen ||
      datumDraft !== null ||
      extrudeDraft !== null
    ) {
      return null;
    }
    // The draft is a synthetic feature that owns its generated faces while it
    // previews.
    if (blendDraft?.mode === "new") return `${blendDraft.kind}-draft`;
    return activeFeature &&
      (isExtrudeFeature(activeFeature) || isEdgeBlendFeature(activeFeature)) &&
      !activeFeature.suppressed
      ? activeFeature.id
      : null;
  }, [
    mode,
    supportOpen,
    datumDraft,
    extrudeDraft,
    blendDraft,
    activeFeature,
  ]);

  useEffect(() => {
    viewportRef.current?.setFeatureHighlight(featureHighlightId);
  }, [featureHighlightId]);

  // The timeline only scrolls sideways, so a vertical wheel over it scrolls the
  // real native scroll container horizontally (shift+wheel and trackpad
  // gestures already do this natively). No virtual scrolling: the element
  // itself moves, and the native scrollbar stays the source of truth.
  useEffect(() => {
    const track = timelineTrackRef.current;
    if (!track) return;
    const onWheel = (event: WheelEvent): void => {
      const max = track.scrollWidth - track.clientWidth;
      if (max <= 0) return;
      const raw =
        Math.abs(event.deltaX) > Math.abs(event.deltaY)
          ? event.deltaX
          : event.deltaY;
      if (raw === 0) return;
      const delta = event.deltaMode === 1 ? raw * 16 : raw;
      const next = Math.max(0, Math.min(max, track.scrollLeft + delta));
      if (next === track.scrollLeft) return;
      track.scrollLeft = next;
      event.preventDefault();
    };
    track.addEventListener("wheel", onWheel, { passive: false });
    return () => track.removeEventListener("wheel", onWheel);
  }, []);

  // The insert menu is transient: Escape or a click outside dismisses it.
  // The gap that opened it is exempt so its own click can toggle it.
  useEffect(() => {
    if (!insertMenu) return;
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Element | null;
      if (target?.closest("[data-insert-menu]")) return;
      const gapSelector = insertMenu.atStart
        ? '[data-gap="start"]'
        : `[data-gap="${insertMenu.anchorId}"]`;
      if (target?.closest(gapSelector)) return;
      setInsertMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setInsertMenu(null);
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [insertMenu]);

  useEffect(() => {
    viewportRef.current?.setDatumPlanes(datumPlaneOverlays);
  }, [datumPlaneOverlays]);


  useEffect(() => {
    applyTheme(themeSettings);
  }, [themeSettings]);

  useEffect(() => {
    viewportRef.current?.setTheme(themeSettings.mode);
    viewportRef.current?.setHighlightColor(
      highlighterColor(themeSettings.highlight, themeSettings.mode).color,
    );
  }, [themeSettings]);

  useEffect(() => {
    if (!trimNotice) return;
    const timer = window.setTimeout(() => setTrimNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [trimNotice]);

  useEffect(() => {
    if (!historyNotice) return;
    const timer = window.setTimeout(() => setHistoryNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [historyNotice]);

  useEffect(() => {
    if (!fileMenuOpen) return;
    const close = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest(".doc-left")) setFileMenuOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [fileMenuOpen]);

  // The document is the source of truth; keep a local copy for reopening.
  // Debounce because a drag commits a new document on every pointer move.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      saveDoc(doc);
      saveLocalFile(doc);
      if (fileMenuOpen) setFileIndex(loadFileIndex());
    }, 200);
    return () => window.clearTimeout(timer);
  }, [doc, fileMenuOpen]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }

      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === "z") {
        event.preventDefault();
        setPendingConstraint(null);
        setSolveError(null);
        if (event.shiftKey) redo();
        else undo();
        setFitToken((token) => token + 1);
        return;
      }
      if (meta && event.key.toLowerCase() === "y") {
        event.preventDefault();
        setPendingConstraint(null);
        setSolveError(null);
        redo();
        setFitToken((token) => token + 1);
        return;
      }
      if (event.key === "Escape") {
        if (blendDraftOpenRef.current) {
          cancelBlendRef.current();
          return;
        }
        setPendingConstraint(null);
        setSolveError(null);
        setTool("select");
        setDimensionRequest(null);
        setFilletOpen(false);
        setFilletRadiusBefore(null);
        setSelection([]);
        setCancelToken((token) => token + 1);
        setBodyPick(null);
        setEdgeSelection([]);
        viewportRef.current?.clearPick();
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        deleteKey();
        return;
      }
      if (meta || event.altKey) return;

      switch (event.key.toLowerCase()) {
        case "v":
          enterSketchMode();
          setTool("select");
          setSelection([]);
          break;
        case "b":
          enterSketchMode();
          setTool("box");
          setSelection([]);
          break;
        case "g":
          enterSketchMode();
          setTool("lasso");
          setSelection([]);
          break;
        case "l":
          enterSketchMode();
          setTool("line");
          setSelection([]);
          break;
        case "p":
          enterSketchMode();
          setTool("point");
          setSelection([]);
          break;
        case "r":
          enterSketchMode();
          setTool("rect");
          setSelection([]);
          break;
        case "c":
          enterSketchMode();
          setTool("circle");
          setSelection([]);
          break;
        case "a":
          enterSketchMode();
          setTool("arc");
          setSelection([]);
          break;
        case "d":
          enterSketchMode();
          setTool("dimension");
          setSelection([]);
          break;
        case "t":
          enterSketchMode();
          setTool("trim");
          setSelection([]);
          break;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo]);

  const handleSetPointPosition = (pointId: string, x: number, y: number): void => {
    if (!isSolverReady()) return;
    const base = currentSketch();
    const outcome = solveDragTargets(base, [{ pointId, x, y }], {
      frozen: frozenSupportPoints(base, [pointId]),
    });
    if (!outcome) return;
    commitDoc(applySolution(base, outcome), outcome, `point:${pointId}`);
  };

  const handleDragPoint = (pointId: string, x: number, y: number): void => {
    if (!isSolverReady()) return;
    const base = currentSketch();
    const target: Vec2 =
      isDemoSketch(base) ? clampDemoDrag(base, pointId, [x, y]) : [x, y];
    const outcome = solveDragTargets(
      base,
      [{ pointId, x: target[0], y: target[1] }],
      { frozen: frozenSupportPoints(base, [pointId]) },
    );
    if (!outcome) return;
    commitDoc(applySolution(base, outcome), outcome, `drag:${pointId}`);
  };

  const handleDragLine = (lineId: string, targets: DragTarget[]): void => {
    if (!isSolverReady()) return;
    const base = currentSketch();
    // Dragging a line moves that line; its support geometry stays put. The
    // snapped endpoints slide along their point-on-line constraints instead of
    // dragging the box (or whatever they were drawn against) with them.
    const moving = targets.map((target) => target.pointId);
    const frozen = frozenSupportPoints(base, moving);
    const line = base.curves.find((curve) => curve.id === lineId);
    const outcome = solveDragTargets(base, targets, {
      frozen,
      ...(line?.type === "line"
        ? { preserveAngle: { a: line.a, b: line.b } }
        : {}),
    });
    if (!outcome) return;
    commitDoc(applySolution(base, outcome), outcome, `drag:${lineId}`);
  };

  const drawAndCommit = (base: Sketch, next: Sketch): void => {
    if (next === base) return;
    solveAndCommit(next);
    setFitToken((token) => token + 1);
  };

  const handlePolyline = (vertices: DraftVertex[], closed: boolean): void => {
    const base = currentSketch();
    const valid = vertices.map((vertex) => {
      const existing = vertex.existingPointId
        ? findSketchPoint(base, vertex.existingPointId)
        : undefined;
      return {
        point: vertex.point,
        ...(existing ? { existingPointId: existing.id } : {}),
        ...(vertex.referenceLineId
          ? { referenceLineId: vertex.referenceLineId }
          : {}),
        ...(vertex.referenceLineIds
          ? { referenceLineIds: vertex.referenceLineIds }
          : {}),
      };
    });
    drawAndCommit(base, addPolyline(base, valid, closed));
  };

  const handlePoint = (vertex: DraftVertex): void => {
    solveAndCommit(
      addPoint(
        currentSketch(),
        vertex.point,
        vertex.referenceLineId,
        vertex.referenceLineIds,
      ),
    );
    setSelection([]);
  };

  const handleRectangle = (a: Vec2, b: Vec2): void => {
    const base = currentSketch();
    drawAndCommit(base, addRectangle(base, a, b));
  };

  const handleCircle = (center: DraftVertex, radius: number): void => {
    const base = currentSketch();
    const valid = center.existingPointId
      ? {
          ...center,
          existingPointId: findSketchPoint(base, center.existingPointId)
            ? center.existingPointId
            : undefined,
        }
      : center;
    drawAndCommit(base, addCircle(base, valid, radius));
  };

  const handleArc = (
    start: DraftVertex,
    end: DraftVertex,
    through: Vec2,
  ): void => {
    const base = currentSketch();
    drawAndCommit(base, addArc(base, start, end, through));
  };

  const handleFillet = (): void => {
    if (!filletSelection) return;
    const base = currentSketch();
    const next = addFillet(
      base,
      filletSelection.a.id,
      filletSelection.b.id,
      filletRadius,
    );
    if (next === base) return;
    setSelection([]);
    solveAndCommit(next);
  };

  const openFillet = (): void => {
    setFilletRadiusBefore(filletRadius);
    setFilletOpen(true);
  };

  const cancelFillet = (): void => {
    setFilletOpen(false);
    if (filletRadiusBefore !== null) setFilletRadius(filletRadiusBefore);
    setFilletRadiusBefore(null);
  };

  const applyFillet = (): void => {
    handleFillet();
    setFilletOpen(false);
    setFilletRadiusBefore(null);
  };

  const handleTrimCurve = (curveId: string, point: Vec2): void => {
    const base = currentSketch();
    const result = trimCurveAt(base, curveId, point);
    if (!result.removed) return;
    setSelection([]);
    if (!solveAndCommit(result.sketch)) return;
    setTrimNotice(
      result.droppedConstraints > 0
        ? `Trim removed ${result.droppedConstraints} constraint${
            result.droppedConstraints === 1 ? "" : "s"
          } that could not be kept`
        : null,
    );
  };

  const commitRegions = (next: readonly string[]): void => {
    if (extrudeDraft) {
      setExtrudeDraft((draft) =>
        draft ? { ...draft, regions: [...next] } : draft,
      );
      return;
    }
    const { current, extrude } = resolveCurrent();
    if (!extrude) return;
    const doc = updateExtrudeFeature(current.doc, extrude.id, (feature) => {
      if (
        next.length === feature.regions.length &&
        next.every((id, index) => id === feature.regions[index])
      ) {
        return feature;
      }
      return { ...feature, regions: [...next] };
    });
    if (doc === current.doc) return;
    commit({ doc, solved: current.solved, solvedFor: current.solvedFor });
  };

  const handleSelectRegion = (regionId: string, additive: boolean): void => {
    // In ordinary sketch editing a click outside the selected geometry clears
    // the selection. Do not start a draft until the user clicks a profile with
    // nothing else selected.
    if (!activeExtrude && !extrudeDraft && selection.length > 0) {
      setSelection([]);
      return;
    }
    setSelection([]);
    if (!activeExtrude && !extrudeDraft) {
      if (activeSketchFeature) beginExtrudeDraft([regionId]);
      return;
    }
    const current = storedRegionIds ?? [];
    if (!additive) {
      commitRegions([regionId]);
      return;
    }
    commitRegions(
      current.includes(regionId)
        ? current.filter((id) => id !== regionId)
        : [...current, regionId],
    );
  };

  const handleMarqueeSelectRegions = (
    regionIds: string[],
    additive: boolean,
  ): void => {
    // An empty marquee is a no-op. Committing an empty list would fall back to
    // auto/largest material, which reads as "selected the wrong profile".
    if (regionIds.length === 0) return;
    setSelection([]);
    if (!activeExtrude && !extrudeDraft) {
      if (activeSketchFeature) beginExtrudeDraft(regionIds);
      return;
    }
    if (!additive) {
      commitRegions(regionIds);
      return;
    }
    const next = new Set(storedRegionIds ?? []);
    for (const id of regionIds) {
      if (next.has(id)) next.delete(id);
      else next.add(id);
    }
    commitRegions([...next]);
  };

  const selectAllRegions = (): void => {
    setSelection([]);
    commitRegions(
      regions
        .filter((region) => region.kind === "material")
        .map((region) => region.id),
    );
  };

  const selectAllVoids = (): void => {
    setSelection([]);
    commitRegions(
      regions
        .filter((region) => region.kind === "void")
        .map((region) => region.id),
    );
  };

  const autoSelectRegion = (): void => {
    setSelection([]);
    commitRegions([]);
  };

  const handleMoveDimension = (
    id: string,
    placement: DimensionPlacement,
  ): void => {
    const base = currentSketch();
    const next = setDimensionPlacement(base, id, placement);
    if (next === base) return;
    // Moving a label does not change geometry; keep the last solution and group
    // the whole pointer gesture into one undo entry.
    commitDoc(next, currentSolve(), `dim:${id}`);
  };

  const startDimension = (target: DimensionTarget): void => {
    dimensionRequestSeq.current += 1;
    setDimensionRequest({ target, seq: dimensionRequestSeq.current });
    setTool("dimension");
    setSelection([]);
  };

  const startTrim = (): void => {
    setTool("trim");
    setSelection([]);
  };

  const handleCreateDimension = (
    target: DimensionTarget,
    placement: DimensionPlacement,
  ): void => {
    const base = currentSketch();
    const next = addDimension(base, target, !referenceDimensions, placement);
    if (next === base) return;
    setDimensionRequest(null);
    setTool("select");
    setSelection([]);
    solveAndCommit(next);
  };

  const handleChangeDimension = (
    id: string,
    value: number,
    driving: boolean,
  ): void => {
    let next = currentSketch();
    if (driving) next = updateConstraintValue(next, id, value);
    next = setDimensionDriving(next, id, driving);
    if (next === currentSketch()) return;
    solveAndCommit(next);
  };

  const handleDeleteDimension = (id: string): void => {
    solveAndCommit(removeConstraint(currentSketch(), id));
  };

  const handleConstraintAction = (action: ConstraintAction): void => {
    if (action.applied) {
      // The conflict preview is UI-only: release it without touching the doc.
      if (action.id === PENDING_CONFLICT_ID) {
        setPendingConstraint(null);
        setSolveError(null);
        return;
      }
      if (action.id) {
        setPendingConstraint(null);
        const base = currentSketch();
        const next = removeConstraint(base, action.id);
        if (next === base) return;
        solveAndCommit(next);
        return;
      }
    }
    const base = currentSketch();
    const next = applyConstraint(base, action.type, selection);
    if (next === base) return;
    if (!isSolverReady()) return;
    const outcome = solveSketch(next);
    if (!outcome.ok) {
      // Keep the would-be constraint visible as an active chip so the user can
      // uncheck it. Rejected constraints are not written to the document.
      setPendingConstraint({
        type: action.type,
        label: action.label,
        applied: true,
        id: PENDING_CONFLICT_ID,
      });
      setSolveError(outcome);
      return;
    }
    setPendingConstraint(null);
    commitDoc(applySolution(next, outcome), outcome);
  };

  const handleConstruction = (): void => {
    const base = currentSketch();
    const next = toggleConstruction(base, selection);
    if (next === base) return;
    solveAndCommit(next);
  };

  const replaceActiveSketch = (
    nextSketch: Sketch,
    outcome: SolveOutcome | null,
  ): void => {
    const { current, sketchFeature: target, extrude } = resolveCurrent();
    if (!target) return;
    let nextDoc = updateSketchFeature(current.doc, target.id, nextSketch);
    if (extrude) {
      nextDoc = updateExtrudeFeature(nextDoc, extrude.id, (feature) =>
        feature.regions.length === 0 ? feature : { ...feature, regions: [] },
      );
    }
    commit({ doc: nextDoc, solved: outcome, solvedFor: target.id });
  };

  /** Sketch-scoped reset: empty this sketch, not the file. */
  const clearActiveSketch = (): void => {
    const empty = emptySketch();
    const outcome = isSolverReady() ? solveSketch(empty) : null;
    replaceActiveSketch(empty, outcome);
    setSolveError(null);
    setSelection([]);
    setTool("select");
    setZoomPreset("fit");
    setFitToken((token) => token + 1);
  };

  /** Development reset: keep the file identity, remove every history step. */
  const clearDocument = (): void => {
    const current = getState();
    const next: Doc = { ...current.doc, features: [] };
    rebuildCache.clear();
    faceBoundaryCache.current.clear();
    faceBoundaryPending.current.clear();
    setLostFaceRefs(new Set());
    setDatumDraft(null);
    reset({ doc: next, solved: null, solvedFor: null });
    setActiveFeatureId(null);
    dismissEditor();
    setSupportOpen(false);
    setInsertMenu(null);
    setCreationAnchorId(null);
    setCreationAtStart(false);
    setMode("model");
    setTool("select");
    setSelection([]);
    setSolveError(null);
    setBodyPick(null);
    setEdgeSelection([]);
    viewportRef.current?.clearPick();
    setZoomPreset("fit");
    setFitToken((token) => token + 1);
  };

  const loadExample = (): void => {
    // "Load the example" is a full reset, not an edit of the current sketch:
    // created features and document names must not survive it.
    const fresh = createExampleDocument();
    rebuildCache.clear();
    faceBoundaryCache.current.clear();
    faceBoundaryPending.current.clear();
    setLostFaceRefs(new Set());
    setDatumDraft(null);
    const firstSketch = primarySketchFeature(fresh);
    const outcome =
      firstSketch && isSolverReady() ? solveSketch(firstSketch.sketch) : null;
    const nextDoc =
      firstSketch && outcome?.ok
        ? updateSketchFeature(
            fresh,
            firstSketch.id,
            applySolution(firstSketch.sketch, outcome),
          )
        : fresh;
    commit({
      doc: nextDoc,
      solved: outcome,
      solvedFor: firstSketch?.id ?? null,
    });
    if (firstSketch) setActiveFeatureId(firstSketch.id);
    dismissEditor();
    setSupportOpen(false);
    setCreationAnchorId(null);
    setCreationAtStart(false);
    setMode("sketch");
    setSolveError(null);
    setSelection([]);
    setDimensionRequest(null);
    setReferenceDimensions(false);
    setFilletOpen(false);
    setFilletRadiusBefore(null);
    setTool("select");
    setZoomPreset("fit");
    setFitToken((token) => token + 1);
  };

  const openDocument = (next: Doc): void => {
    rebuildCache.clear();
    faceBoundaryCache.current.clear();
    faceBoundaryPending.current.clear();
    setLostFaceRefs(new Set());
    setDatumDraft(null);
    reset({ doc: next, solved: null, solvedFor: null });
    const active = initialActiveFeatureId(next);
    setActiveFeatureId(active);
    const feature = active ? findFeature(next, active) : null;
    dismissEditor();
    setSupportOpen(false);
    setCreationAnchorId(null);
    setCreationAtStart(false);
    setMode(feature?.type === "sketch" ? "sketch" : "model");
    setSelection([]);
    setSolveError(null);
    setFileError(null);
    setFileMenuOpen(false);
    setBodyPick(null);
    setEdgeSelection([]);
    viewportRef.current?.clearPick();
    saveDoc(next);
    saveLocalFile(next);
    setFileIndex(loadFileIndex());
  };

  const toggleFileMenu = (): void => {
    if (!fileMenuOpen) setFileIndex(loadFileIndex());
    setFileDeleteId(null);
    setFileMenuOpen((open) => !open);
  };

  const openLocalDocument = (entry: LocalFileEntry): void => {
    const next = loadLocalFile(entry.id);
    if (!next) {
      setFileError(`Could not open "${entry.name}".`);
      return;
    }
    setFileDeleteId(null);
    openDocument(next);
  };

  const requestDeleteLocalFile = (entry: LocalFileEntry): void => {
    if (fileDeleteId !== entry.id) {
      setFileDeleteId(entry.id);
      return;
    }
    deleteLocalFile(entry.id);
    setFileDeleteId(null);
    setFileIndex(loadFileIndex());
    setFileError(null);
  };

  const makeDocumentCopy = (): void => {
    const current = getState();
    const copy = copyDocument(current.doc);
    saveLocalFile(copy);
    openDocument(copy);
  };

  const downloadDocument = (): void => {
    const current = getState();
    const blob = new Blob([serializeDoc(current.doc)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${current.doc.name || "part"}.cad`;
    anchor.click();
    URL.revokeObjectURL(url);
    setFileMenuOpen(false);
  };

  const openDocumentFile = async (file: File): Promise<void> => {
    try {
      const next = deserializeDoc(await file.text());
      if (!next) {
        setFileError("That file is not a valid .cad document.");
        return;
      }
      openDocument(next);
    } catch (error) {
      setFileError(
        error instanceof Error ? error.message : "Could not open the file.",
      );
    }
  };

  const newDocument = (): void => {
    const next = createBlankDocument();
    openDocument(next);
    setMode("sketch");
    setTool("select");
    setFitToken((token) => token + 1);
  };

  const commitDocumentRename = (): void => {
    if (docRename === null) return;
    const current = getState();
    const next = renameDocument(current.doc, docRename);
    setDocRename(null);
    if (next === current.doc) return;
    commit({ doc: next, solved: current.solved, solvedFor: current.solvedFor });
  };

  const goBack = (): void => {
    clearTransientSolve();
    undo();
    setFitToken((token) => token + 1);
  };

  const goForward = (): void => {
    clearTransientSolve();
    redo();
    setFitToken((token) => token + 1);
  };

  const shownMesh = solidFeatures.length > 0 ? mesh : null;
  const shownRoundTrip = solidFeatures.length > 0 ? roundTripMs : null;
  const matchedSolve =
    editor.solved && editor.solvedFor === activeSketchFeature?.id
      ? editor.solved
      : null;
  const shown =
    solveError ??
    matchedSolve ??
    (activeSketchBuild
      ? {
          status: activeSketchBuild.solveStatus,
          dof: activeSketchBuild.dof,
          conflicting: activeSketchBuild.conflicting,
          ...(activeSketchBuild.message
            ? { message: activeSketchBuild.message }
            : {}),
        }
      : null);
  const tone: SketchTone =
    shown?.status === "inconsistent"
      ? "conflict"
      : shown?.dof === 0
        ? "full"
        : "under";

  const statusLabel =
    solverState === "loading"
      ? "Loading solver…"
      : solverState === "error"
        ? "Solver failed"
        : shown?.status === "inconsistent"
          ? "Conflicting constraints"
          : shown?.status === "did-not-converge"
            ? "Did not converge"
            : shown?.dof === 0
              ? "Fully constrained"
              : `${shown?.dof ?? "?"} DOF`;

  const profileMode =
    mode === "sketch" &&
    (activeFeature?.type === "extrude" || extrudeDraft !== null);
  const hint = extrudeDraft
    ? extrudeDraft.regions.length === 0
      ? "Pick at least one filled region for the new extrude; Shift adds. Set distance, direction and operation in the popover."
      : "Click filled regions to add or remove profiles; Shift adds. Extrude in the popover creates the feature."
    : profileMode
      ? "Click filled regions to choose this extrude's profiles; Shift adds. Height, operation, direction and end are in the feature popover. Enter or Done returns to the model."
      : tool === "dimension"
        ? "Click two points, a line, or a circle, then click to place the dimension. Drag a placed label to move it; double-click a value to edit it."
        : tool === "line"
          ? "Click to add points · Enter or double-click finishes the line · Esc cancels."
          : tool === "select" && activeFeature?.type === "sketch"
            ? "Click a filled region to start an extrude draft; Shift adds. Select an extrude step to edit its existing profiles."
            : "Select to inspect, or drag a box/lasso around profiles. L line · P point · B box · G lasso · R rectangle · C circle · A arc · D dimension · T trim · Delete removes.";

  const activeState = activeFeature
    ? featureStates.get(activeFeature.id)
    : undefined;
  const activeSupportLost =
    activeState?.result?.diagnostics.some(
      (diagnostic) => diagnostic.code === "support-lost",
    ) ?? false;
  const activeExtrudeOutput =
    activeState?.result?.output?.kind === "extrude"
      ? activeState.result.output
      : null;
  const activeRegionCount = extrudeDraft
    ? extrudeDraft.regions.length
    : activeExtrudeOutput?.regionIds.length ??
      (activeFeature && isExtrudeFeature(activeFeature)
        ? activeFeature.regions.length
        : 0);
  const sourceSketches =
    activeFeatureIndex > 0
      ? doc.features
          .slice(0, activeFeatureIndex)
          .filter((feature) => isSketchFeature(feature))
      : [];
  const draftFeature: ExtrudeFeature | null = extrudeDraft
    ? {
        id: "extrude-draft",
        type: "extrude",
        name: "New extrude",
        sketchId: extrudeDraft.sketchId,
        regions: extrudeDraft.regions,
        height: extrudeDraft.height,
        operation: extrudeDraft.operation,
        symmetric: extrudeDraft.symmetric,
        end: extrudeDraft.end,
      }
    : null;
  const supportFace =
    bodyPick?.kind === "face" ? (bodyPick.ref ?? null) : null;
  const supportFaceFrame = supportFace
    ? frameFromHint(supportFace.hint)
    : null;
  const supportFaceSupported = Boolean(supportFace && supportFaceFrame);
  const datumSupportOptions = useMemo<DatumSupportOption[]>(() => {
    const options: DatumSupportOption[] = [
      {
        key: "world:XY",
        label: "XY",
        ref: { kind: "world", plane: "XY" },
      },
      {
        key: "world:XZ",
        label: "XZ",
        ref: { kind: "world", plane: "XZ" },
      },
      {
        key: "world:YZ",
        label: "YZ",
        ref: { kind: "world", plane: "YZ" },
      },
    ];
    if (supportFace && supportFaceFrame) {
      options.push({
        key: `face:${supportFace.role}`,
        label: `Face · ${supportFace.role}`,
        ref: { kind: "face", ref: supportFace, frame: supportFaceFrame },
      });
    }
    for (const feature of datumPlaneFeatures(buildDoc)) {
      options.push({
        key: `datum:${feature.id}`,
        label: feature.name,
        ref: {
          kind: "datum",
          featureId: feature.id,
          label: feature.name,
          frame: resolvedDatumFrame(feature),
        },
      });
    }
    return options;
  }, [buildDoc, supportFace, supportFaceFrame, resolvedDatumFrame]);
  const supportPreviewActive = supportOpen || datumDraft !== null;
  const supportPreviewFrame = useMemo<PlaneFrame | null>(() => {
    if (!supportPreviewActive) return null;
    if (!supportOpen && datumDraft) {
      const definition: DatumPlaneDefinition =
        datumDraft.kind === "offset"
          ? {
              kind: "offset",
              base: datumDraft.base,
              distance: datumDraft.distance,
            }
          : {
              kind: "midplane",
              a: datumDraft.base,
              b: datumDraft.second,
            };
      return datumDefinitionFrame(definition);
    }
    if (supportFace && supportFaceFrame) {
      return supportFaceFlipped
        ? flipFrame(supportFaceFrame)
        : supportFaceFrame;
    }
    if (supportDatumId) {
      const feature = findFeature(doc, supportDatumId);
      if (feature?.type === "datum") return resolvedDatumFrame(feature);
    }
    return worldPlaneFrame(supportPlane);
  }, [
    supportPreviewActive,
    supportOpen,
    datumDraft,
    supportFace,
    supportFaceFrame,
    supportFaceFlipped,
    supportDatumId,
    doc,
    resolvedDatumFrame,
    supportPlane,
  ]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.setSupportPreview(supportPreviewFrame);
    viewport.setDimmed(supportPreviewActive);
  }, [supportPreviewFrame, supportPreviewActive]);

  const datumDraftOptions = useMemo(() => {
    // A new plane is inserted at the cursor, so only earlier datums exist for
    // it to use as a base. Editing one keeps its own position.
    const limit = datumDraft?.id
      ? doc.features.findIndex((feature) => feature.id === datumDraft.id)
      : activeFeatureIndex + 1;
    return datumSupportOptions.filter((option) => {
      const ref = option.ref;
      if (ref.kind !== "datum") return true;
      const index = doc.features.findIndex(
        (feature) => feature.id === ref.featureId,
      );
      return index >= 0 && index < limit;
    });
  }, [datumSupportOptions, datumDraft, doc.features, activeFeatureIndex]);

  return (
    <div className="app">
      <header className="doc-head">
        <div className="doc-left">
          <button
            className={`doc-file${fileMenuOpen ? " is-open" : ""}`}
            type="button"
            onClick={toggleFileMenu}
            aria-expanded={fileMenuOpen}
            title="File menu"
            data-testid="file-menu"
          >
            <span className="doc-name">{doc.name}</span>
            <span className="doc-ext">.cad</span>
            <span className="doc-caret">▾</span>
          </button>
          {fileMenuOpen ? (
            <div className="file-menu" data-testid="file-menu-popover">
              {docRename !== null ? (
                <input
                  className="file-rename"
                  value={docRename}
                  autoFocus
                  aria-label="Document name"
                  data-testid="doc-rename-input"
                  onChange={(event) => setDocRename(event.target.value)}
                  onBlur={commitDocumentRename}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      commitDocumentRename();
                    } else if (event.key === "Escape") {
                      event.preventDefault();
                      setDocRename(null);
                    }
                  }}
                />
              ) : null}
              <button
                className="text-action"
                type="button"
                onClick={downloadDocument}
                data-testid="download-doc"
              >
                download .cad
              </button>
              <button
                className="text-action"
                type="button"
                onClick={() => fileInputRef.current?.click()}
                data-testid="open-doc"
              >
                open .cad…
              </button>
              <button
                className="text-action"
                type="button"
                onClick={() => setDocRename(doc.name)}
                data-testid="rename-doc"
              >
                rename
              </button>
              <button
                className="text-action"
                type="button"
                onClick={makeDocumentCopy}
                data-testid="copy-doc"
              >
                make a copy
              </button>
              <button
                className="text-action"
                type="button"
                onClick={newDocument}
                data-testid="new-file"
              >
                new file
              </button>
              <div className="file-list" data-testid="local-file-list">
                <span className="file-list-head">
                  local files · {fileIndex.length}
                </span>
                {fileIndex.map((entry) => (
                  <div className="file-entry" key={entry.id}>
                    <button
                      className={`file-row${entry.id === doc.id ? " is-current" : ""}`}
                      type="button"
                      onClick={() => openLocalDocument(entry)}
                      data-testid={`local-file-${entry.id}`}
                    >
                      <span className="file-row-name">{entry.name}.cad</span>
                      <span className="file-row-meta">
                        {entry.featureCount} step
                        {entry.featureCount === 1 ? "" : "s"} ·{" "}
                        {formatFileWhen(entry.updatedAt)}
                      </span>
                    </button>
                    {entry.id !== doc.id ? (
                      <button
                        className="text-action is-quiet file-row-delete"
                        type="button"
                        onClick={() => requestDeleteLocalFile(entry)}
                        data-testid={`delete-file-${entry.id}`}
                      >
                        {fileDeleteId === entry.id ? "confirm" : "delete"}
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
              <span className="file-note">offline · no sharing</span>
              {fileError ? (
                <span className="file-error" role="alert">
                  {fileError}
                </span>
              ) : null}
            </div>
          ) : null}
          <input
            ref={fileInputRef}
            type="file"
            accept=".cad,.json,application/json"
            hidden
            data-testid="file-open-input"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void openDocumentFile(file);
              event.currentTarget.value = "";
            }}
          />
        </div>

        <div className="doc-actions" role="group" aria-label="Document actions">
          <button
            className="text-action"
            type="button"
            onClick={goBack}
            disabled={!history.canUndo}
            data-testid="undo"
          >
            undo
          </button>
          <button
            className="text-action"
            type="button"
            onClick={goForward}
            disabled={!history.canRedo}
            data-testid="redo"
          >
            redo
          </button>
          <span className="doc-sep" aria-hidden="true" />
          <button
            className="text-action"
            type="button"
            onClick={loadExample}
            data-testid="load-example"
          >
            example
          </button>
          <button
            className="text-action"
            type="button"
            onClick={clearDocument}
            title="Clear the file and remove every step"
            data-testid="clear-document"
          >
            clear
          </button>
          {mode === "sketch" ? (
            <>
              <span className="doc-sep" aria-hidden="true" />
              <button
                className="text-action is-primary"
                type="button"
                onClick={finishActiveMode}
                title={
                  activeFeature?.type === "extrude"
                    ? "Done selecting this extrude's profiles"
                    : "Finish the sketch"
                }
                data-testid="finish-sketch"
              >
                {activeFeature?.type === "extrude" ? "done" : "finish sketch"}{" "}
                <span className="key">↵</span>
              </button>
            </>
          ) : null}
        </div>

        <div className="doc-right">
          <div className="appearance-controls" data-testid="appearance-controls">
            <div className="theme-switch" role="group" aria-label="Theme">
              <button
                className={`appearance-theme${themeSettings.mode === "day" ? " is-active" : ""}`}
                type="button"
                onClick={() => setThemeSettings((settings) => ({ ...settings, mode: "day" }))}
                aria-label="Day appearance"
                aria-pressed={themeSettings.mode === "day"}
                data-testid="theme-day"
              >
                <span className="theme-swatch is-day" />
              </button>
              <button
                className={`appearance-theme${themeSettings.mode === "night" ? " is-active" : ""}`}
                type="button"
                onClick={() => setThemeSettings((settings) => ({ ...settings, mode: "night" }))}
                aria-label="Night appearance"
                aria-pressed={themeSettings.mode === "night"}
                data-testid="theme-night"
              >
                <span className="theme-swatch is-night" />
              </button>
            </div>
            <div className="highlight-dots" role="group" aria-label="Highlighter colour">
              {(["yellow", "pink", "blue", "green"] as const).map((highlight) => {
                const color = highlighterColor(highlight, themeSettings.mode);
                return (
                  <button
                    key={highlight}
                    className={`highlight-dot${themeSettings.highlight === highlight ? " is-active" : ""}`}
                    type="button"
                    style={{ background: color.color }}
                    onClick={() =>
                      setThemeSettings((settings) => ({ ...settings, highlight }))
                    }
                    aria-label={`${highlight} highlighter`}
                    aria-pressed={themeSettings.highlight === highlight}
                    data-testid={`highlight-${highlight}`}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </header>

      <main className="workspace">
        <section
          className="stage"
          onPointerDown={(event) => {
            // A click on the model background cancels the open feature/datum
            // editor, exactly like its footer cancel. Popovers, the sketch
            // tools and the stage-foot view controls keep their own clicks.
            if (mode !== "model") return;
            const target = event.target as Element | null;
            if (!target) return;
            if (target.closest(".stage-popover")) return;
            if (target.closest(".tool-line")) return;
            if (target.closest(".stage-foot")) return;
            // While a fillet editor is open the canvas is the pick surface:
            // an edge click must not cancel it, and an empty click is handled
            // by the viewport's null pick. Other editors still cancel here.
            if (target.closest(".viewport-canvas") && blendDraft) return;
            if (blendDraft) {
              cancelBlendEditor();
              return;
            }
            if (extrudeDraft) {
              cancelExtrudeDraft();
              return;
            }
            if (editorOpen) {
              cancelFeatureEditor();
              return;
            }
            if (datumDraft) {
              cancelDatumDraft();
            }
          }}
        >
          <div className={`model-layer${mode === "model" ? "" : " is-hidden"}`}>
            <canvas ref={canvasRef} className="viewport-canvas" />

            {bodyPick ? (
              <div
                className="body-pick"
                data-testid="body-pick"
                data-kind={bodyPick.kind}
                data-id={bodyPick.id}
                data-ref-role={bodyPick.ref?.role}
                data-ref={
                  bodyPick.ref ? JSON.stringify(bodyPick.ref) : undefined
                }
                data-edge-ref={
                  bodyPick.edgeRef ? JSON.stringify(bodyPick.edgeRef) : undefined
                }
                data-datum-id={bodyPick.datumId}
                role="status"
              >
                <span className="body-pick-dot" />
                <span>
                  {bodyPick.kind === "face"
                    ? "Face selected"
                    : bodyPick.kind === "datum"
                      ? "Datum plane selected"
                      : edgeSelection.length > 1
                        ? `${edgeSelection.length} edges selected`
                        : "Edge selected"}
                  {bodyPick.ref ? ` · ${bodyPick.ref.role}` : ""}
                  {bodyPick.kind === "datum" && bodyPick.datumId
                    ? ` · ${findFeature(doc, bodyPick.datumId)?.name ?? "plane"}`
                    : ""}
                </span>
              </div>
            ) : null}

            {kernelState === "loading" ? (
              <div className="viewport-message">
                <span className="spinner" />
                Loading geometry kernel…
              </div>
            ) : null}

            {solidFeatures.length === 0 && kernelState !== "loading" ? (
              <div className="viewport-message subtle">
                <strong>No solid</strong>
                <span>
                  Draw a closed loop, select a region, or fix the feature errors
                  in the history.
                </span>
              </div>
            ) : null}

            {kernelError ? (
              <div className="viewport-message error">
                <strong>Kernel error</strong>
                <span>{kernelError}</span>
              </div>
            ) : null}

          </div>

          <div className={`sketch-layer${mode === "sketch" ? "" : " is-hidden"}`}>
            <div className="sketch-stage">
              <div className="tool-line" role="toolbar" aria-label="Sketch tools">
                <ToolButton
                  label="select"
                  shortcut="v"
                  active={tool === "select"}
                  onClick={() => changeTool("select")}
                  testId="tool-select"
                />
                <ToolButton
                  label="box"
                  shortcut="b"
                  active={tool === "box"}
                  onClick={() => changeTool("box")}
                  testId="tool-box"
                />
                <ToolButton
                  label="lasso"
                  shortcut="g"
                  active={tool === "lasso"}
                  onClick={() => changeTool("lasso")}
                  testId="tool-lasso"
                />
                <span className="tool-separator" />
                <ToolButton
                  label="line"
                  shortcut="l"
                  active={tool === "line"}
                  onClick={() => changeTool("line")}
                  testId="tool-line"
                />
                <ToolButton
                  label="point"
                  shortcut="p"
                  active={tool === "point"}
                  onClick={() => changeTool("point")}
                  testId="tool-point"
                />
                <ToolButton
                  label="rect"
                  shortcut="r"
                  active={tool === "rect"}
                  onClick={() => changeTool("rect")}
                  testId="tool-rect"
                />
                <ToolButton
                  label="circle"
                  shortcut="c"
                  active={tool === "circle"}
                  onClick={() => changeTool("circle")}
                  testId="tool-circle"
                />
                <ToolButton
                  label="arc"
                  shortcut="a"
                  active={tool === "arc"}
                  onClick={() => changeTool("arc")}
                  testId="tool-arc"
                />
                <span className="tool-separator" />
                <button
                  className="text-action is-quiet"
                  type="button"
                  onClick={clearActiveSketch}
                  title="Clear this sketch's geometry"
                  data-testid="clear-sketch"
                >
                  clear sketch
                </button>
              </div>

              <div className="sketch-canvas-wrap">
                <SketchCanvas
                  sketch={sketch}
                  points={geometry.points}
                  radii={geometry.radii}
                  tone={tone}
                  palette={palette}
                  regions={regions}
                  bodyReference={bodyReferenceEdges}
                  selectedRegions={selectedRegions}
                  profileSelection={profileMode}
                  regionsSelectable={
                    activeExtrude !== null ||
                    extrudeDraft !== null ||
                    (mode === "sketch" && tool === "select")
                  }
                  onSelectRegion={handleSelectRegion}
                  onMarqueeSelectRegions={handleMarqueeSelectRegions}
                  tool={tool}
                  dimensionMode="distance"
                  radiusDimensions={false}
                  cancelToken={cancelToken}
                  fitToken={fitToken}
                  gridStep={gridStep}
                  snapEnabled={snapEnabled}
                  onGridStepResolved={setResolvedGridStep}
                  onGridScaleResolved={setGridPixels}
                  onZoomChange={handleZoomChange}
                  zoomRequest={zoomRequest}
                  selected={selectedSet}
                  onSelect={handleSelect}
                  onSetPointPosition={handleSetPointPosition}
                  dimensionRequest={dimensionRequest}
                  onDragPoint={handleDragPoint}
                  onDragLine={handleDragLine}
                  onDragEnd={endMerge}
                  onCreatePolyline={handlePolyline}
                  onCreateRectangle={handleRectangle}
                  onCreateCircle={handleCircle}
                  onCreateArc={handleArc}
                  onCreatePoint={handlePoint}
                  onTrimCurve={handleTrimCurve}
                  onCreateDimension={handleCreateDimension}
                  onChangeDimension={handleChangeDimension}
                  onMoveDimension={handleMoveDimension}
                  onDeleteDimension={handleDeleteDimension}
                  onFinishSketch={finishActiveMode}
                />
              </div>
            </div>

            {trimNotice ? (
              <div className="sketch-notice" data-testid="trim-notice" role="status">
                {trimNotice}
              </div>
            ) : null}

            {selectedInfo.length > 0 ? (
              filletOpen && filletSelection ? (
                <FilletPopover
                  radius={filletRadius}
                  onRadius={setFilletRadius}
                  onApply={applyFillet}
                  onCancel={cancelFillet}
                  position={popoverPosition}
                  onMove={setPopoverPosition}
                />
              ) : (
                <SelectionPopover
                  info={selectedInfo}
                  actions={constraintActions}
                  construction={construction}
                  onConstraint={handleConstraintAction}
                  onConstruction={handleConstruction}
                  onDelete={deleteSelection}
                  deletable={selectedInfo.some(
                    (info) => info.kind !== "reference",
                  )}
                  onOpenFillet={filletSelection ? openFillet : undefined}
                  dimension={
                    dimensionTarget
                      ? {
                          label:
                            dimensionTarget.kind === "angle"
                              ? "angle"
                              : dimensionTarget.kind === "diameter"
                                ? "diameter"
                                : "distance",
                          onSelect: () => startDimension(dimensionTarget),
                          ...(dimensionTarget.kind === "diameter" &&
                          radiusTarget
                            ? {
                                onRadius: () => startDimension(radiusTarget),
                              }
                            : {}),
                        }
                      : undefined
                  }
                  trim={trimCurve ? { onClick: startTrim } : undefined}
                  position={popoverPosition}
                  onMove={setPopoverPosition}
                />
              )
            ) : null}

            {tool === "dimension" ? (
              <div className="sketch-flyout">
                <label className="toggle-field">
                  <input
                    type="checkbox"
                    checked={referenceDimensions}
                    onChange={(event) => setReferenceDimensions(event.target.checked)}
                    data-testid="reference-toggle"
                  />
                  <span>Reference dimension (measure only)</span>
                </label>
              </div>
            ) : null}

            {(activeExtrude || extrudeDraft) && regions.length > 1 ? (
              <div className="region-panel" data-testid="region-panel">
                <span>
                  {extrudeDraft
                    ? extrudeDraft.regions.length === 0
                      ? "select profiles"
                      : `${activeRegionIds.length} of ${regions.length} regions${
                          activeVoidCount > 0
                            ? activeVoidCount === activeRegionIds.length
                              ? " · void"
                              : " · includes void"
                            : ""
                        }`
                    : !regionSelection.auto
                      ? `${activeRegionIds.length} of ${regions.length} regions${
                          activeVoidCount > 0
                            ? activeVoidCount === activeRegionIds.length
                              ? " · void"
                              : " · includes void"
                            : ""
                        }`
                      : "auto: largest material"}
                </span>
                <button
                  className="constraint-chip"
                  type="button"
                  onClick={selectAllRegions}
                  data-testid="all-regions"
                >
                  All
                </button>
                {hasVoids ? (
                  <button
                    className="constraint-chip"
                    type="button"
                    onClick={selectAllVoids}
                    data-testid="all-voids"
                  >
                    Voids
                  </button>
                ) : null}
                {!extrudeDraft && !regionSelection.auto ? (
                  <button
                    className="constraint-chip"
                    type="button"
                    onClick={autoSelectRegion}
                    data-testid="auto-region"
                  >
                    Auto
                  </button>
                ) : null}
              </div>
            ) : null}

            <div className="sketch-hint">{hint}</div>
          </div>

          <div className="stage-foot">
            <div className="stage-foot-left">
              <StatusBadge
                label="solver"
                state={solverState}
                title={solverError ?? undefined}
                testId="solver-status"
              />
              <StatusBadge
                label="kernel"
                state={kernelState}
                title={kernelError ?? undefined}
                testId="kernel-status"
              />
              <span className="stage-sep" aria-hidden="true" />
              {mode === "sketch" ? (
                <span className={`dof-row ${tone}`} data-testid="dof" data-tone={tone}>
                  <span className="dot" />
                  <span>{statusLabel}</span>
                  {shown && shown.conflicting.length > 0 ? (
                    <span className="mono conflict-list">
                      {shown.conflicting.join(", ")}
                    </span>
                  ) : null}
                </span>
              ) : null}
              {shownMesh ? (
                <span
                  className="mono stage-stats"
                  data-testid="mesh-stats"
                  data-volume={shownMesh.stats.volume.toFixed(2)}
                  data-faces={shownMesh.stats.faces}
                  data-edges={shownMesh.stats.edges}
                  data-triangles={shownMesh.stats.triangles}
                  data-bbox={shownMesh.stats.bounds
                    .map((value) => Number(value.toFixed(3)))
                    .join(",")}
                >
                  {formatVolume(shownMesh.stats.volume)} mm³ · {shownMesh.stats.faces}{" "}
                  faces · {formatInt(shownMesh.stats.triangles)} tris
                </span>
              ) : (
                <span className="mono stage-stats dim">no body</span>
              )}
              {shownRoundTrip !== null && mode === "model" ? (
                <span className="stage-meta">{shownRoundTrip.toFixed(0)} ms</span>
              ) : null}
            </div>
            <div className="stage-foot-right">
              {mode === "model" ? (
                <>
                  <span className="stage-meta">Z-up · mm</span>
                  <button
                    className="text-action"
                    type="button"
                    onClick={() => viewportRef.current?.frameAll()}
                    aria-label="Fit view"
                  >
                    fit
                  </button>
                </>
              ) : (
                <>
                  <label className="grid-control">
                    <span className="stage-meta">grid</span>
                    <input
                      className="grid-input"
                      type="number"
                      min="0.001"
                      step="any"
                      value={
                        gridStep === "auto"
                          ? formatGridStep(resolvedGridStep)
                          : String(gridStep)
                      }
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        if (Number.isFinite(value) && value > 0) {
                          setGridStep(value);
                        }
                      }}
                      aria-label="Grid step in millimetres"
                      data-testid="grid-step"
                    />
                    <span className="stage-meta">mm</span>
                  </label>
                  <span
                    className="scale-bar"
                    data-testid="grid-scale"
                    aria-hidden="true"
                  >
                    <i style={{ width: `${gridPixels}px` }} />
                  </span>
                  <button
                    className={`text-action${gridStep === "auto" ? " is-primary" : ""}`}
                    type="button"
                    onClick={() => setGridStep("auto")}
                    aria-pressed={gridStep === "auto"}
                    title="Adapt the grid step to the zoom level"
                    data-testid="grid-auto"
                  >
                    auto
                  </button>
                  <button
                    className="text-action"
                    type="button"
                    onClick={() => setSnapEnabled((enabled) => !enabled)}
                    data-testid="snap-toggle"
                  >
                    snap {snapEnabled ? "on" : "off"}
                  </button>
                  <label className="zoom-control">
                    <span className="stage-meta">zoom</span>
                    <select
                      className="zoom-select"
                      value={zoomPreset}
                      onChange={(event) => requestZoom(event.target.value)}
                      aria-label="Zoom"
                      data-testid="zoom-select"
                    >
                      {["fit", "50", "100", "200"].includes(zoomPreset) ? null : (
                        <option value={zoomPreset}>{zoomPreset}%</option>
                      )}
                      <option value="fit">fit</option>
                      <option value="50">50%</option>
                      <option value="100">100%</option>
                      <option value="200">200%</option>
                    </select>
                  </label>
                </>
              )}
            </div>
          </div>

          {supportOpen ? (
            <SupportPopover
              position={popoverPosition}
              onMove={setPopoverPosition}
              onCancel={() => {
                setSupportOpen(false);
                setCreationAnchorId(null);
              }}
              onApply={() => {
                handleNewSketch();
                setSupportOpen(false);
              }}
              faceLabel={supportFace?.role}
              faceSupported={supportFaceSupported}
              plane={supportPlane}
              onPlane={(plane) => {
                setSupportPlane(plane);
                setSupportDatumId(null);
              }}
              datums={datumPlaneFeatures(buildDoc).map((feature) => ({
                id: feature.id,
                name: feature.name,
              }))}
              datumId={supportDatumId}
              onDatum={setSupportDatumId}
              faceFlipped={supportFaceFlipped}
              onFlipFace={() => setSupportFaceFlipped((flipped) => !flipped)}
            />
          ) : null}

          {datumDraft ? (
            <DatumPlanePopover
              draft={datumDraft}
              options={datumDraftOptions}
              position={popoverPosition}
              onMove={setPopoverPosition}
              onCancel={cancelDatumDraft}
              onApply={commitDatumDraft}
              onKind={(kind) =>
                setDatumDraft((draft) => (draft ? { ...draft, kind } : draft))
              }
              onBase={(key) => {
                const option = datumDraftOptions.find(
                  (candidate) => candidate.key === key,
                );
                if (!option) return;
                setDatumDraft((draft) =>
                  draft ? { ...draft, base: option.ref } : draft,
                );
              }}
              onSecond={(key) => {
                const option = datumDraftOptions.find(
                  (candidate) => candidate.key === key,
                );
                if (!option) return;
                setDatumDraft((draft) =>
                  draft ? { ...draft, second: option.ref } : draft,
                );
              }}
              onDistance={(distance) =>
                setDatumDraft((draft) =>
                  draft ? { ...draft, distance } : draft,
                )
              }
            />
          ) : null}

          {extrudeDraft && draftFeature ? (
            <FeaturePopover
              feature={draftFeature}
              sketches={activeSketchFeature ? [activeSketchFeature] : []}
              regionCount={extrudeDraft.regions.length}
              mode={mode}
              position={popoverPosition}
              onMove={setPopoverPosition}
              onCancel={cancelExtrudeDraft}
              onApply={commitExtrudeDraft}
              onHeight={(height) =>
                updateExtrudeDraft((draft) => ({ ...draft, height }))
              }
              onHeightEnd={() => undefined}
              onSketchChange={() => undefined}
              showSketchRow={false}
              onToggleSymmetric={() =>
                updateExtrudeDraft((draft) => ({
                  ...draft,
                  symmetric: !draft.symmetric,
                }))
              }
              onOperation={(operation) =>
                updateExtrudeDraft((draft) => ({
                  ...draft,
                  operation,
                  end: operation === "cut" ? draft.end : "blind",
                }))
              }
              onEnd={(end) =>
                updateExtrudeDraft((draft) =>
                  end === "throughAll"
                    ? { ...draft, operation: "cut", end }
                    : { ...draft, end },
                )
              }
              onSelectProfiles={selectExtrudeProfiles}
              kicker="new feature"
              title={`Extrude ${activeSketchFeature?.name ?? ""}`.trim()}
              testId="extrude-draft-popover"
              primaryLabel="extrude"
              primaryDisabled={extrudeDraft.regions.length === 0}
              primaryTestId="extrude-apply"
              cancelTestId="extrude-cancel"
              hint={
                extrudeDraft.regions.length === 0
                  ? "pick at least one filled region; Shift adds"
                  : "draft only · extrude creates the feature"
              }
              summaryOverride={
                extrudeDraft.regions.length === 0
                  ? "no profile selected"
                  : undefined
              }
            />
          ) : null}

          {blendDraft ? (
            <SolidBlendPopover
              kind={blendDraft.kind}
              value={blendDraft.value}
              edges={blendDraft.edges}
              isDraft={blendDraft.mode === "new"}
              position={popoverPosition}
              onMove={setPopoverPosition}
              onValue={updateBlendValue}
              onValueEnd={endMerge}
              onRemoveEdge={(index) =>
                updateBlendEdges(
                  blendDraft.edges.filter((_, at) => at !== index),
                )
              }
              onApply={applyBlendDraft}
              onCancel={cancelBlendEditor}
            />
          ) : edgeSelection.length > 0 && mode === "model" ? (
            <BodySelectionPopover
              edges={selectedEdgeRefs}
              position={bodyPopoverPosition}
              onMove={setBodyPopoverPosition}
              onClear={() => {
                setEdgeSelection([]);
                setBodyPick(null);
                viewportRef.current?.clearPick();
              }}
              onFillet={() => beginBlendDraft("fillet")}
              onChamfer={() => beginBlendDraft("chamfer")}
            />
          ) : null}

          {editorOpen && activeFeature?.type === "extrude" ? (
            <FeaturePopover
              feature={activeFeature}
              sketches={sourceSketches}
              regionCount={activeRegionCount}
              mode={mode}
              position={popoverPosition}
              onMove={setPopoverPosition}
              onCancel={cancelFeatureEditor}
              onApply={finishActiveMode}
              onHeight={handleExtrudeHeight}
              onHeightEnd={endMerge}
              onSketchChange={handleExtrudeSketch}
              onToggleSymmetric={handleToggleSymmetric}
              onOperation={handleExtrudeOperation}
              onEnd={handleExtrudeEnd}
              onSelectProfiles={selectExtrudeProfiles}
            />
          ) : null}
        </section>

        <footer
          className="timeline"
          data-testid="timeline"
          data-active-feature={activeFeature?.id ?? ""}
          data-active-sketch={activeSketchFeature?.id ?? ""}
          data-active-extrude={activeExtrude?.id ?? ""}
          data-lost-supports={activeLostFaceRefs.size}
        >
          <div className="timeline-track" ref={timelineTrackRef}>
            <button
              className="timeline-empty"
              type="button"
              title="Clear step selection"
              aria-label="Clear step selection"
              data-testid="timeline-empty-start"
              onClick={clearActiveFeature}
            />
            <button
              className="insert-gap"
              type="button"
              title="Insert a step here"
              aria-label="Insert a step here"
              data-gap="start"
              data-testid="insert-gap-start"
              onClick={(event) => openStartInsertMenu(event.currentTarget)}
            />
            {doc.features.map((feature, index) => {
              const state = featureStates.get(feature.id);
              const paused = activeFeatureIndex >= 0 && index > activeFeatureIndex;
              const status = paused ? "paused" : (state?.status ?? "pending");
              const kind = isSketchFeature(feature)
                ? "sketch"
                : isDatumPlaneFeature(feature)
                  ? "plane"
                  : isFilletFeature(feature)
                    ? "fillet"
                    : isChamferFeature(feature)
                      ? "chamfer"
                      : "extrude";
              const meta = isSketchFeature(feature)
                ? `${supportLabel(feature.support)} · ${feature.sketch.curves.length} curves`
                : isDatumPlaneFeature(feature)
                  ? datumDefinitionLabel(feature.definition)
                  : isFilletFeature(feature)
                    ? `R ${feature.radius} mm · ${feature.edges.length} edge${feature.edges.length === 1 ? "" : "s"}`
                    : isChamferFeature(feature)
                      ? `${feature.distance} mm · ${feature.edges.length} edge${feature.edges.length === 1 ? "" : "s"}`
                      : `${
                          feature.end === "throughAll"
                            ? "through all"
                            : `${feature.height} mm`
                        } · ${feature.operation} · ${
                          feature.symmetric ? "symmetric" : "one side"
                        }`;
              // State (paused, suppressed, hidden, skipped) is conveyed by
              // dimming/underline only. Extra meta text would appear and
              // disappear as the cursor and visibility change, making the
              // steps jiggle; the block must keep a stable width.
              const statusClass =
                status === "paused"
                  ? " is-paused"
                  : status === "error"
                    ? " is-error"
                    : status === "skipped"
                      ? " is-skipped"
                      : feature.suppressed
                        ? " is-suppressed"
                        : "";
              const hiddenClass =
                isDatumPlaneFeature(feature) && feature.hidden
                  ? " is-hidden"
                  : "";
              const testId =
                feature.id === primarySketchId
                  ? "timeline-sketch"
                  : feature.id === primaryExtrudeId
                    ? "timeline-extrude"
                    : `feature-${feature.id}`;
              const output = featureTimelineOutput(feature);
              return (
                <Fragment key={feature.id}>
                  <div
                    className={`timeline-item${feature.id === activeFeature?.id ? " is-active" : ""}${statusClass}${hiddenClass}${draggingFeatureId === feature.id ? " is-dragging" : ""}`}
                    role="button"
                    tabIndex={0}
                    aria-pressed={feature.id === activeFeature?.id}
                    onClick={() => activateFeature(feature)}
                    onDoubleClick={() => beginRename(feature)}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const sourceId =
                        event.dataTransfer.getData("text/plain") ||
                        draggingFeatureId;
                      setDraggingFeatureId(null);
                      if (!sourceId || sourceId === feature.id) return;
                      handleMoveFeature(sourceId, index);
                    }}
                    onKeyDown={(event) => {
                      if (event.target !== event.currentTarget) return;
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        activateFeature(feature);
                      }
                    }}
                    data-testid={testId}
                    data-feature-id={feature.id}
                    data-feature-type={feature.type}
                    data-status={status}
                    data-hidden={
                      isDatumPlaneFeature(feature) && feature.hidden
                        ? "true"
                        : undefined
                    }
                    title={
                      paused
                        ? "Paused: select this step to build through it"
                        : state?.messages.length
                          ? state.messages.join("\n")
                          : "Double-click to rename"
                    }
                  >
                    <span className="step-head">
                      <span className="timeline-index">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span className="step-sep" aria-hidden="true">
                        ·
                      </span>
                      <span className="step-type">{kind}</span>
                    </span>
                    <span
                      className="step-grip"
                      draggable
                      aria-hidden="true"
                      title="Drag to reorder"
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", feature.id);
                        setDraggingFeatureId(feature.id);
                      }}
                      onDragEnd={() => setDraggingFeatureId(null)}
                    />
                    {renaming?.id === feature.id ? (
                      <input
                        className="timeline-rename"
                        value={renaming.value}
                        autoFocus
                        data-testid="feature-rename"
                        onChange={(event) =>
                          setRenaming({
                            id: feature.id,
                            value: event.target.value,
                          })
                        }
                        onBlur={commitRename}
                        onClick={(event) => event.stopPropagation()}
                        onDoubleClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => {
                          event.stopPropagation();
                          if (event.key === "Enter") {
                            event.preventDefault();
                            commitRename();
                          } else if (event.key === "Escape") {
                            event.preventDefault();
                            setRenaming(null);
                          }
                        }}
                      />
                    ) : (
                      <span className="step-name">
                        {status === "error" ? (
                          <span className="step-bang" aria-hidden="true">
                            !
                          </span>
                        ) : null}
                        {feature.name}
                      </span>
                    )}
                    <span className="tree-meta">{meta}</span>
                    <span className="step-bodies">
                      <span
                        className={`body-chip is-${output.kind}`}
                        data-output-op={output.op}
                        data-output-kind={output.kind}
                        title={
                          output.kind === "body"
                            ? "body"
                            : "Double-click to rename"
                        }
                        onDoubleClick={
                          output.kind === "body"
                            ? undefined
                            : (event) => {
                                event.stopPropagation();
                                beginRename(feature);
                              }
                        }
                      >
                        <span className="body-op">{output.op}</span>
                        <span
                          className={`body-dot is-${output.kind}`}
                          aria-hidden="true"
                        />
                        <span className="body-name">{output.name}</span>
                        {isDatumPlaneFeature(feature) ? (
                          <button
                            className={`chip-eye${feature.hidden ? " is-hidden" : ""}`}
                            type="button"
                            title={
                              feature.hidden ? "Show plane" : "Hide plane"
                            }
                            aria-label={
                              feature.hidden ? "Show plane" : "Hide plane"
                            }
                            aria-pressed={feature.hidden === true}
                            data-testid="toggle-datum-visibility"
                            onClick={(event) => {
                              event.stopPropagation();
                              handleToggleDatumVisibility(feature);
                            }}
                            onDoubleClick={(event) =>
                              event.stopPropagation()
                            }
                          >
                            <span
                              className="chip-eye-shape"
                              aria-hidden="true"
                            />
                          </button>
                        ) : null}
                      </span>
                    </span>
                  </div>
                  <button
                    className="insert-gap"
                    type="button"
                    title="Insert a step here"
                    aria-label="Insert a step here"
                    data-gap={feature.id}
                    data-testid="insert-gap"
                    onClick={(event) =>
                      openInsertMenu(feature, event.currentTarget)
                    }
                  />
                </Fragment>
              );
            })}
            <button
              className="timeline-empty"
              type="button"
              title="Clear step selection"
              aria-label="Clear step selection"
              data-testid="timeline-empty"
              onClick={clearActiveFeature}
            />
          </div>

          {insertMenu ? (
            <div
              className="insert-menu"
              role="menu"
              data-insert-menu=""
              style={{ left: `${insertMenu.left}px` }}
            >
              <div className="insert-menu-head" data-testid="insert-menu-head">
                {insertMenu.atStart
                  ? "insert at the start"
                  : `insert after ${String(
                      doc.features.findIndex(
                        (feature) => feature.id === insertMenu.anchorId,
                      ) + 1,
                    ).padStart(2, "0")}`}
              </div>
              <button
                className="grid-option"
                type="button"
                role="menuitem"
                data-testid="insert-sketch"
                onClick={() =>
                  openInsertSketch(insertMenu.anchorId, insertMenu.atStart)
                }
              >
                <span>sketch</span>
                <span className="grid-option-note">on a support</span>
              </button>
              <button
                className="grid-option"
                type="button"
                role="menuitem"
                data-testid="insert-plane"
                onClick={() =>
                  openInsertPlane(insertMenu.anchorId, insertMenu.atStart)
                }
              >
                <span>plane</span>
                <span className="grid-option-note">datum plane</span>
              </button>
            </div>
          ) : null}

          <div className="timeline-detail" data-testid="timeline-detail">
            {activeFeature ? (
              <>
                {activeSupportLost ? (
                  <span className="detail-item">
                    <span className="detail-key">support</span>
                    <span className="detail-value">lost · cached frame</span>
                  </span>
                ) : null}
                <span className="detail-actions">
                  {activeSupportLost ? (
                    <button
                      className="text-action"
                      type="button"
                      onClick={reselectActiveSupport}
                      data-testid="reselect-support"
                    >
                      reselect
                    </button>
                  ) : null}
                  {activeSupportLost ? (
                    <button
                      className="text-action"
                      type="button"
                      onClick={goBack}
                      data-testid="revert-support"
                    >
                      revert
                    </button>
                  ) : null}
                  {isSketchFeature(activeFeature) && !extrudeDraft ? (
                    <button
                      className="text-action"
                      type="button"
                      onClick={handleNewExtrude}
                      data-testid="new-extrude"
                    >
                      extrude
                    </button>
                  ) : null}
                  {activeSketchFeature ? (
                    <button
                      className="text-action"
                      type="button"
                      onClick={() => activateFeature(activeSketchFeature)}
                    >
                      open sketch
                    </button>
                  ) : null}
                  <button
                    className="text-action"
                    type="button"
                    onClick={() => handleToggleSuppress(activeFeature)}
                    aria-pressed={activeFeature.suppressed === true}
                    data-testid="feature-suppress"
                  >
                    {activeFeature.suppressed ? "unsuppress" : "suppress"}
                  </button>
                  <button
                    className="text-action"
                    type="button"
                    onClick={() => handleDeleteFeature(activeFeature)}
                    data-testid="feature-delete"
                  >
                    delete
                  </button>
                </span>
              </>
            ) : (
              <span className="detail-empty">
                {doc.features.length > 0 ? "No step selected" : "No features"}
              </span>
            )}
            {activeState?.messages.length ? (
              <span className="timeline-note is-error">
                {activeState.messages.join(" · ")}
              </span>
            ) : null}
            {historyNotice ? (
              <span className="timeline-note is-error">{historyNotice}</span>
            ) : null}
            <span
              className={`timeline-note${firstRebuildError ? " is-error" : ""}`}
              data-testid="rebuild-status"
              data-status={rebuildStatus}
              title={
                allDiagnostics.length > 0
                  ? allDiagnostics
                      .map(
                        ({ feature, diagnostic }) =>
                          `${feature}: ${diagnostic.message}`,
                      )
                      .join("\n")
                  : undefined
              }
            >
              {firstRebuildError
                ? firstRebuildError.diagnostic.message
                : "Autosaved locally"}
            </span>
          </div>
        </footer>
      </main>
    </div>
  );
}

interface SelectedEntity {
  id: string;
  kind: "line" | "circle" | "arc" | "point" | "reference";
  label: string;
  detail: string;
}

function describeSelection(
  sketch: Sketch,
  geometry: { points: Record<string, Vec2>; radii: Record<string, number> },
  ids: readonly string[],
): SelectedEntity[] {
  const result: SelectedEntity[] = [];
  for (const id of ids) {
    const referenceLine = sketch.references?.lines.find((line) => line.id === id);
    if (referenceLine) {
      result.push({
        id,
        kind: "reference",
        label:
          referenceLine.referenceLabel ??
          (referenceLine.id === "axis-x" ? "X axis" : "Y axis"),
        detail: referenceLine.projectionId
          ? "Projected reference · fixed"
          : "Fixed reference axis",
      });
      continue;
    }
    const referencePoint = sketch.references?.points.find((point) => point.id === id);
    if (referencePoint) {
      result.push({
        id,
        kind: "reference",
        label:
          referencePoint.referenceLabel ??
          (referencePoint.id === "origin" ? "Origin" : "Reference point"),
        detail: `${formatLength(referencePoint.x)}, ${formatLength(referencePoint.y)} mm · fixed${
          referencePoint.projectionId ? " · projected" : ""
        }`,
      });
      continue;
    }
    const curve = sketch.curves.find((candidate) => candidate.id === id);
    if (curve) {
      if (curve.type === "line") {
        const a = geometry.points[curve.a];
        const b = geometry.points[curve.b];
        result.push({
          id,
          kind: "line",
          label: curve.construction ? "Construction line" : "Line",
          detail: a && b ? `${formatLength(distance(a, b))} mm` : "—",
        });
      } else {
        const radius = curveRadius(curve, geometry.points, geometry.radii);
        result.push({
          id,
          kind: curve.type === "arc" ? "arc" : "circle",
          label: curve.type === "arc" ? "Arc" : "Circle",
          detail:
            radius === null
              ? "—"
              : curve.type === "arc"
                ? `R ${formatLength(radius)} mm`
                : `⌀ ${formatLength(radius * 2)} mm`,
        });
      }
      continue;
    }

    const point = sketch.points.find((candidate) => candidate.id === id);
    // Fixed/construction points are reference geometry and are not selectable.
    if (!point || point.fixed || point.construction) continue;
    const position = geometry.points[id] ?? [point.x, point.y];
    result.push({
      id,
      kind: "point",
      label: "Point",
      detail: `${formatLength(position[0])}, ${formatLength(position[1])} mm`,
    });
  }
  return result;
}

function ToolButton({
  label,
  shortcut,
  active,
  onClick,
  testId,
}: {
  label: string;
  shortcut?: string;
  active?: boolean;
  onClick: () => void;
  testId: string;
}) {
  const title = shortcut ? `${label} (${shortcut})` : label;
  return (
    <button
      className={`tool-button${active ? " is-active" : ""}`}
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      onClick={onClick}
      data-testid={testId}
    >
      <span className="tool-label">{label}</span>
      {shortcut ? <kbd className="tool-key">{shortcut}</kbd> : null}
    </button>
  );
}

function StatusBadge({
  label,
  state,
  title,
  testId,
}: {
  label: string;
  state: LoadState;
  title?: string;
  testId: string;
}) {
  return (
    <span className={`status-badge ${state}`} title={title} data-testid={testId}>
      <span className="dot" />
      <span className="status-label">{label}</span>
      <span className="status-state">
        {state === "loading" ? "loading" : state === "ready" ? "ready" : "error"}
      </span>
    </span>
  );
}

function formatInt(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function formatVolume(value: number): string {
  return value.toFixed(1);
}

function formatLength(value: number): string {
  return Number.isInteger(value) ? `${value}` : value.toFixed(1);
}

function formatFileWhen(updatedAt: number): string {
  const elapsed = Math.max(0, Date.now() - updatedAt);
  if (elapsed < 60_000) return "just now";
  if (elapsed < 3_600_000) {
    return `${Math.max(1, Math.floor(elapsed / 60_000))} min ago`;
  }
  if (elapsed < 86_400_000) {
    return `${Math.floor(elapsed / 3_600_000)} h ago`;
  }
  return new Date(updatedAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

