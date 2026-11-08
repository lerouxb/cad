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
  projectedCircle,
  projectionHasDependents,
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
  addOffsetFaceFeature,
  addSketchFeature,
  datumPlaneFeatures,
  deleteFeature,
  extrudesForSketch,
  findFeature,
  moveFeature,
  primaryExtrudeFeature,
  primarySketch,
  primarySketchFeature,
  addRevolveFeature,
  addShellFeature,
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
  updateOffsetFaceFeature,
  updateRevolveFeature,
  updateShellFeature,
  updateSketchFeature,
} from "../core/doc/selectors";
import {
  isChamferFeature,
  isDatumPlaneFeature,
  isEdgeBlendFeature,
  isExtrudeFeature,
  isFilletFeature,
  isOffsetFaceFeature,
  isRevolveFeature,
  isShellFeature,
  isSketchFeature,
  type DatumPlaneDefinition,
  type DatumPlaneFeature,
  type Doc,
  type EdgeBlendFeature,
  type ExtrudeFeature,
  type Feature,
  type OffsetFaceFeature,
  type PlaneRef,
  type RevolveAxis,
  type RevolveFeature,
  type ShellFeature,
  type SketchFeature,
  type WorldPlane,
} from "../core/doc/types";
import { extrudeParams, selectExtrudeRegions } from "../core/features/extrude";
import {
  revolveParams,
  revolveProfileError,
} from "../core/features/revolve";
import { KernelClient } from "../core/kernel/client";
import type {
  BodyMesh,
  EdgeRef,
  FeatureBuildStatus,
  KernelFeature,
  MeasureResult,
  MeasureTarget,
  TopoRef,
} from "../core/kernel/protocol";
import { edgeRefKey } from "../core/kernel/protocol";
import { formatLength } from "../core/format";
import { extractKernelFeatures, rebuildDocument } from "../core/rebuild/engine";
import { canonicalJson, stableHash } from "../core/rebuild/hash";
import {
  RebuildCache,
  type FeatureResult,
  type FeatureStatus,
} from "../core/rebuild/types";
import {
  addArc,
  addCenterArc,
  addCenterRectangle,
  addCircle,
  addCircleByDiameter,
  addCircleThroughPoints,
  addFillet,
  addOrientedRectangle,
  addPoint,
  addPolyline,
  addRectangle,
  addTangentArc,
  emptySketch,
  type DraftVertex,
} from "../core/sketch/create";
import {
  applicableConstraints,
  applyConstraint,
  constraintLabel,
  constructionState,
  toggleConstruction,
  type ConstraintAction,
} from "../core/sketch/constraints";
import {
  addDimension,
  dimensionCanDrive,
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
import { constraintParticipantSummary } from "../sketch/constraintMarks";
import {
  SketchCanvas,
  type ArcSpec,
  type ArcVariant,
  type CircleSpec,
  type CircleVariant,
  type RectangleSpec,
  type RectangleVariant,
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
  type ModelPickFilter,
  type ModelPickTool,
  type PickInfo,
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
import { ProfilePopover } from "./ProfilePopover";
import { BodySelectionPopover } from "./BodySelectionPopover";
import { ExportPopover } from "./ExportPopover";
import { MeasurePopover } from "./MeasurePopover";
import { FaceSelectionPopover } from "./FaceSelectionPopover";
import { ShellPopover } from "./ShellPopover";
import { OffsetFacePopover } from "./OffsetFacePopover";
import { RevolvePopover } from "./RevolvePopover";
import { SolidBlendPopover } from "./SolidBlendPopover";
import { FilletPopover } from "./FilletPopover";
import { ProjectPopover } from "./ProjectPopover";
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

/** Resolve the selected step; null means "no step selected, show the end". */
function resolveActiveFeature(doc: Doc, featureId: string | null): Feature | null {
  return featureId ? findFeature(doc, featureId) ?? null : null;
}

/** A sketch feature is edited directly; an extrude edits the sketch it consumes. */
function sketchForFeature(doc: Doc, feature: Feature | null): SketchFeature | null {
  if (!feature) return null;
  if (feature.type === "sketch") return feature;
  if (feature.type === "extrude" || feature.type === "revolve") {
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
  if (
    isEdgeBlendFeature(feature) ||
    isShellFeature(feature) ||
    isOffsetFaceFeature(feature)
  ) {
    return { op: "→", kind: "body", name: "body" };
  }
  if (isRevolveFeature(feature)) {
    return {
      op: feature.operation === "new" ? "+" : "→",
      kind: "body",
      name: "body",
    };
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

interface RevolveDraft {
  mode: "new" | "edit";
  featureId: string | null;
  sketchId: string;
  regions: string[];
  axis: RevolveAxis | null;
  angle: number;
  direction: "ccw" | "cw";
  operation: ExtrudeFeature["operation"];
  anchorId: string | null;
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

/** What the sketch cursor may pick. One filter at a time, from the tool row. */
type SketchSelectionFilter = "all" | "points" | "curves" | "dimensions";

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

/** A plausible starting wall: 10% of the body's shortest dimension. */
function defaultOffsetDistance(mesh: BodyMesh | null): number {
  const bounds = mesh?.stats.bounds;
  const shortest = bounds
    ? Math.min(bounds[3] - bounds[0], bounds[4] - bounds[1], bounds[5] - bounds[2])
    : 12;
  return Math.max(0.5, Math.min(5, Math.round(shortest * 0.1 * 10) / 10));
}

function defaultShellThickness(mesh: BodyMesh | null): number {
  const bounds = mesh?.stats.bounds;
  const shortest = bounds
    ? Math.min(bounds[3] - bounds[0], bounds[4] - bounds[1], bounds[5] - bounds[2])
    : 12;
  return Math.max(0.5, Math.min(5, Math.round(shortest * 0.1 * 10) / 10));
}

function edgeBodyPick(edge: EdgeRef): BodyPick {
  return {
    kind: "edge",
    id: `edge-${edgeRefKey(edge)}`,
    edgeRef: edge,
  };
}

function measureTargetKey(pick: BodyPick): string {
  if (pick.kind === "face" && pick.ref) return `face:${faceRefKey(pick.ref)}`;
  if (pick.kind === "edge" && pick.edgeRef) {
    return `edge:${edgeRefKey(pick.edgeRef)}`;
  }
  return pick.id;
}

function faceBodyPick(ref: TopoRef): BodyPick {
  return {
    kind: "face",
    id: `face-${faceRefKey(ref)}`,
    ref,
  };
}

function revolveAxisForPick(
  sketch: Sketch,
  entityId: string,
): RevolveAxis | null {
  if (entityId === "axis-x") return { kind: "reference", axis: "x" };
  if (entityId === "axis-y") return { kind: "reference", axis: "y" };
  const curve = sketch.curves.find(
    (candidate) =>
      candidate.id === entityId &&
      candidate.type === "line" &&
      candidate.reference !== true,
  );
  return curve ? { kind: "line", curveId: entityId } : null;
}

function resolveRevolveAxis(
  sketch: Sketch,
  axis: RevolveAxis,
): { at: [number, number]; direction: [number, number] } | null {
  if (axis.kind === "reference") {
    return {
      at: [0, 0],
      direction: axis.axis === "x" ? [1, 0] : [0, 1],
    };
  }
  const curve = sketch.curves.find(
    (candidate) => candidate.id === axis.curveId && candidate.type === "line",
  );
  if (!curve || curve.type !== "line") return null;
  const a = sketch.points.find((point) => point.id === curve.a);
  const b = sketch.points.find((point) => point.id === curve.b);
  if (!a || !b) return null;
  return {
    at: [a.x, a.y],
    direction: [b.x - a.x, b.y - a.y],
  };
}

interface ShellDraft {
  mode: "new" | "edit";
  featureId: string | null;
  faces: TopoRef[];
  thickness: number;
  anchorId: string | null;
}

interface OffsetDraft {
  mode: "new" | "edit";
  featureId: string | null;
  faces: TopoRef[];
  /** Signed: positive is out along each face normal. */
  distance: number;
  anchorId: string | null;
}

/** Project picked body faces into the active sketch as fixed references. */
interface ProjectDraft {
  sketchId: string;
  faces: TopoRef[];
  edges: EdgeRef[];
  returnMode: "model" | "sketch";
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
  // Opening a document leaves the history cursor empty; selecting a step is
  // explicit (TIMELINE.md).
  const [activeFeatureId, setActiveFeatureId] = useState<string | null>(null);
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
  const [revolveDraft, setRevolveDraft] = useState<RevolveDraft | null>(null);
  const [revolveBaseline, setRevolveBaseline] =
    useState<RevolveFeature | null>(null);
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
  /** The profile family: filled regions selected in ordinary sketch editing. */
  const [profileSelection, setProfileSelection] = useState<string[]>([]);
  /** A constraint selected through its mark; ephemeral, like geometry selection. */
  const [selectedConstraintId, setSelectedConstraintId] = useState<
    string | null
  >(null);
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
  const dimensionEditSeq = useRef(0);
  const [dimensionEditRequest, setDimensionEditRequest] = useState<{
    id: string;
    seq: number;
  } | null>(null);
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
  /** Ephemeral model face multi-selection; the shell's open-face input. */
  const [faceSelection, setFaceSelection] = useState<BodyPick[]>([]);
  const [modelFilter, setModelFilter] = useState<ModelPickFilter>("all");
  const [modelTool, setModelTool] = useState<ModelPickTool>("select");
  const [sketchFilter, setSketchFilter] =
    useState<SketchSelectionFilter>("all");
  const [rectVariant, setRectVariant] = useState<RectangleVariant>("corner");
  const [circleVariant, setCircleVariant] = useState<CircleVariant>("center");
  const [arcVariant, setArcVariant] = useState<ArcVariant>("3-point");
  const [selectOther, setSelectOther] = useState<PickInfo | null>(null);
  const [bodyPopoverPosition, setBodyPopoverPosition] =
    useState<PopoverPosition>({ x: 22, y: 138 });
  const [blendDraft, setBlendDraft] = useState<BlendDraft | null>(null);
  const [blendBaseline, setBlendBaseline] = useState<EdgeBlendFeature | null>(
    null,
  );
  const [shellDraft, setShellDraft] = useState<ShellDraft | null>(null);
  const [shellBaseline, setShellBaseline] = useState<ShellFeature | null>(null);
  const [offsetDraft, setOffsetDraft] = useState<OffsetDraft | null>(null);
  const [offsetBaseline, setOffsetBaseline] =
    useState<OffsetFaceFeature | null>(null);
  /** The body before the offset draft; shown as a ghost while previewing. */
  const [offsetGhostMesh, setOffsetGhostMesh] = useState<BodyMesh | null>(null);
  const [projectDraft, setProjectDraft] = useState<ProjectDraft | null>(null);
  const [projectBusy, setProjectBusy] = useState(false);
  const [projectError, setProjectError] = useState<string | null>(null);
  const projectApplySeq = useRef(0);
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
    y: 138,
  });
  const [draggingFeatureId, setDraggingFeatureId] = useState<string | null>(
    null,
  );
  const [historyNotice, setHistoryNotice] = useState<string | null>(null);
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<"stl" | "step" | null>(null);
  const [exportPosition, setExportPosition] = useState<PopoverPosition>({
    x: 22,
    y: 96,
  });
  const [measureOpen, setMeasureOpen] = useState(false);
  const [measureTargets, setMeasureTargets] = useState<BodyPick[]>([]);
  const [measurement, setMeasurement] = useState<MeasureResult | null>(null);
  const [measureBusy, setMeasureBusy] = useState(false);
  const [measureError, setMeasureError] = useState<string | null>(null);
  const [measurePosition, setMeasurePosition] = useState<PopoverPosition>({
    x: 22,
    y: 138,
  });
  /** A sketch draft/marquee/dimension target owns the canvas (MODES R1). */
  const [sketchGesture, setSketchGesture] = useState(false);
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

  const scrollTimelineToEnd = useCallback((): void => {
    const scroll = (): void => {
      const track = timelineTrackRef.current;
      if (!track) return;
      track.scrollLeft = track.scrollWidth - track.clientWidth;
    };
    scroll();
    requestAnimationFrame(() => requestAnimationFrame(scroll));
  }, []);
  useEffect(() => {
    scrollTimelineToEnd();
  }, [scrollTimelineToEnd]);
  const clientRef = useRef<KernelClient | null>(null);
  const viewportRef = useRef<Viewport | null>(null);
  const handleBodyPickRef = useRef<
    (pick: BodyPick | null, additive: boolean, info?: PickInfo) => void
  >(() => {});
  const handleMarqueeRef = useRef<
    (picks: readonly BodyPick[], additive: boolean) => void
  >(() => {});
  const cancelBlendRef = useRef<() => void>(() => {});
  const blendDraftOpenRef = useRef(false);
  const shellDraftOpenRef = useRef(false);
  const offsetDraftOpenRef = useRef(false);
  const cancelShellRef = useRef<() => void>(() => {});
  const cancelOffsetRef = useRef<() => void>(() => {});
  const exportOpenRef = useRef(false);
  const measureOpenRef = useRef(false);
  const toggleMeasureRef = useRef<() => void>(() => {});
  const endMeasureRef = useRef<() => void>(() => {});
  const cancelOpenOperationRef = useRef<
    (options?: { history?: boolean }) => void
  >(() => {});
  const faceBoundaryCache = useRef(
    new Map<string, { frame: PlaneFrame; loops: Vec3[][] }>(),
  );
  const faceBoundaryPending = useRef(new Set<string>());
  const edgeBoundaryCache = useRef(
    new Map<string, { points: Vec3[]; closed: boolean }>(),
  );
  const edgeBoundaryPending = useRef(new Set<string>());
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
    if (revolveDraft) {
      const wanted = new Set(revolveDraft.regions);
      const selected = regions.filter((region) => wanted.has(region.id));
      return {
        ids: selected.map((region) => region.id),
        regions: selected,
        auto: false,
        stale: false,
      };
    }
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
  }, [regions, storedRegionIds, extrudeDraft, revolveDraft]);
  const activeRegionIds = regionSelection.ids;
  const activeRegions = regionSelection.regions;
  const selectedRegions = useMemo(
    () =>
      new Set(
        activeExtrude || extrudeDraft || revolveDraft
          ? activeRegionIds
          : profileSelection,
      ),
    [
      activeExtrude,
      extrudeDraft,
      revolveDraft,
      activeRegionIds,
      profileSelection,
    ],
  );
  const revolveSketch = revolveDraft
    ? rebuild?.sketchById.get(revolveDraft.sketchId)?.sketch ?? null
    : null;
  const revolveAxisCandidates = useMemo(
    () =>
      revolveSketch?.curves.filter((curve) => curve.type === "line") ?? [],
    [revolveSketch],
  );
  const revolveSelectedRegions = useMemo(() => {
    if (!revolveDraft) return [];
    const wanted = new Set(revolveDraft.regions);
    return (rebuild?.sketchById.get(revolveDraft.sketchId)?.regions ?? regions)
      .filter((region) => wanted.has(region.id));
  }, [rebuild, regions, revolveDraft]);
  const revolveDraftError = useMemo(() => {
    if (!revolveDraft?.axis || !revolveSketch) return null;
    const axis = resolveRevolveAxis(revolveSketch, revolveDraft.axis);
    if (!axis) return "The revolve axis is not available in this sketch.";
    return revolveProfileError(revolveSelectedRegions, axis);
  }, [revolveDraft, revolveSelectedRegions, revolveSketch]);
  const revolvePreviewParams = useMemo(() => {
    if (!revolveDraft || !revolveDraft.axis || !revolveSketch) return null;
    const source = rebuild?.sketchById.get(revolveDraft.sketchId);
    const axis = resolveRevolveAxis(revolveSketch, revolveDraft.axis);
    if (!axis || revolveDraftError) return null;
    if (revolveSelectedRegions.length === 0) return null;
    return revolveParams(
      revolveSelectedRegions,
      axis,
      revolveDraft.angle,
      revolveDraft.direction,
      source?.frame,
    );
  }, [
    rebuild,
    revolveDraft,
    revolveDraftError,
    revolveSelectedRegions,
    revolveSketch,
  ]);

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
  const selectedFaceRefs = useMemo(
    () =>
      faceSelection
        .map((pick) => pick.ref)
        .filter((ref): ref is TopoRef => ref !== undefined),
    [faceSelection],
  );
  // The quick-adjust ceiling for a fillet/chamfer: a blend larger than half
  // the shortest selected edge or body dimension stops being plausible. The
  // number field still accepts a larger value for an explicit failure test.
  const blendValueMax = useMemo(() => {
    const lengths = (blendDraft?.edges ?? [])
      .map((edge) => edge.hint.length)
      .filter((length): length is number => (length ?? 0) > 1e-6);
    const bounds = mesh?.stats.bounds;
    const minBody = bounds
      ? Math.min(
          bounds[3] - bounds[0],
          bounds[4] - bounds[1],
          bounds[5] - bounds[2],
        )
      : 12;
    const shortest = lengths.length > 0 ? Math.min(...lengths) : minBody;
    const ceiling = Math.min(shortest, minBody) * 0.5;
    return Math.max(1, Math.round(ceiling * 10) / 10);
  }, [blendDraft, mesh]);
  // The offset quick-adjust ceiling: half the body's shortest dimension.
  const offsetDistanceMax = useMemo(() => {
    const bounds = mesh?.stats.bounds;
    const shortest = bounds
      ? Math.min(
          bounds[3] - bounds[0],
          bounds[4] - bounds[1],
          bounds[5] - bounds[2],
        )
      : 12;
    return Math.max(1, Math.round(shortest * 0.5 * 10) / 10);
  }, [mesh]);
  const offsetPreviewError = useMemo(() => {
    if (!offsetDraft) return null;
    const featureId =
      offsetDraft.mode === "new" ? "offset-draft" : offsetDraft.featureId;
    if (!featureId) return null;
    const status = workerStatuses.find(
      (candidate) => candidate.featureId === featureId,
    );
    return status && status.status !== "ok"
      ? (status.message ?? "Solid build failed.")
      : null;
  }, [offsetDraft, workerStatuses]);
  const revolvePreviewError = useMemo(() => {
    if (!revolveDraft) return null;
    const featureId =
      revolveDraft.mode === "new" ? "revolve-draft" : revolveDraft.featureId;
    if (!featureId) return null;
    const status = workerStatuses.find(
      (candidate) => candidate.featureId === featureId,
    );
    return status && status.status !== "ok"
      ? (status.message ?? "Solid build failed.")
      : null;
  }, [revolveDraft, workerStatuses]);
  // The shell quick-adjust ceiling: half the body's shortest dimension.
  const shellThicknessMax = useMemo(() => {
    const bounds = mesh?.stats.bounds;
    const shortest = bounds
      ? Math.min(
          bounds[3] - bounds[0],
          bounds[4] - bounds[1],
          bounds[5] - bounds[2],
        )
      : 12;
    return Math.max(1, Math.round(shortest * 0.5 * 10) / 10);
  }, [mesh]);
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
    // A new shell previews the same way: a synthetic feature after the prefix.
    if (
      shellDraft?.mode === "new" &&
      shellDraft.faces.length > 0 &&
      shellDraft.thickness > 0 &&
      features.length > 0
    ) {
      const draft = shellDraft;
      features = [
        ...features,
        {
          kind: "shell",
          featureId: "shell-draft",
          cacheKey: `shell-draft-${stableHash(
            canonicalJson({
              faces: draft.faces,
              thickness: draft.thickness,
              upstream: features.map((feature) => feature.cacheKey),
            }),
          )}`,
          faces: draft.faces,
          thickness: draft.thickness,
        },
      ];
    }
    // A new offset face previews through the kernel too.
    if (
      offsetDraft?.mode === "new" &&
      offsetDraft.faces.length > 0 &&
      offsetDraft.distance !== 0 &&
      features.length > 0
    ) {
      const draft = offsetDraft;
      features = [
        ...features,
        {
          kind: "offsetFace",
          featureId: "offset-draft",
          cacheKey: `offset-draft-${stableHash(
            canonicalJson({
              faces: draft.faces,
              distance: draft.distance,
              upstream: features.map((feature) => feature.cacheKey),
            }),
          )}`,
          faces: draft.faces,
          distance: draft.distance,
          preview: true,
        },
      ];
    }
    if (revolveDraft?.mode === "new" && revolvePreviewParams) {
      const draft = revolveDraft;
      features = [
        ...features,
        {
          kind: "revolve",
          featureId: "revolve-draft",
          cacheKey: `revolve-draft-${stableHash(
            canonicalJson({
              params: revolvePreviewParams,
              operation: draft.operation,
              upstream: features.map((feature) => feature.cacheKey),
            }),
          )}`,
          params: revolvePreviewParams,
          operation: draft.operation,
          preview: true,
        },
      ];
    }
    if (
      extrudeDraft &&
      extrudeDraft.regions.length > 0 &&
      (extrudeDraft.height > 0 || extrudeDraft.end === "throughAll")
    ) {
      const wanted = new Set(extrudeDraft.regions);
      const selected = (activeSketchBuild?.regions ?? regions).filter((region) =>
        wanted.has(region.id),
      );
      if (selected.length > 0) {
        features = [
          ...features,
          {
            kind: "extrude",
            featureId: "extrude-draft",
            cacheKey: `extrude-draft-${stableHash(
              canonicalJson({
                regions: extrudeDraft.regions,
                height: extrudeDraft.height,
                operation: extrudeDraft.operation,
                symmetric: extrudeDraft.symmetric,
                end: extrudeDraft.end,
                frame: activeSketchBuild?.frame ?? null,
                upstream: features.map((feature) => feature.cacheKey),
              }),
            )}`,
            params: extrudeParams(selected, extrudeDraft.height, {
              symmetric: extrudeDraft.symmetric,
              end: extrudeDraft.end,
              frame: activeSketchBuild?.frame,
            }),
            operation: extrudeDraft.operation,
            preview: true,
          },
        ];
      }
    }
    if (editorOpen && activeFeature?.type === "extrude") {
      features = features.map((feature) =>
        feature.kind === "extrude" &&
        feature.featureId === activeFeature.id
          ? {
              ...feature,
              preview: true,
              cacheKey: `${feature.cacheKey}|preview`,
            }
          : feature,
      );
    }
    if (revolveDraft?.mode === "edit" && revolveDraft.featureId) {
      features = features.map((feature) =>
        feature.kind === "revolve" &&
        feature.featureId === revolveDraft.featureId
          ? {
              ...feature,
              preview: true,
              cacheKey: `${feature.cacheKey}|preview`,
            }
          : feature,
      );
    }
    if (offsetDraft?.mode === "edit" && offsetDraft.featureId) {
      const id = offsetDraft.featureId;
      features = features.map((feature) =>
        feature.kind === "offsetFace" && feature.featureId === id
          ? { ...feature, preview: true }
          : feature,
      );
    }
    return features;
  }, [
    rebuild,
    fallbackParams,
    activeExtrude,
    activeFeature,
    activeSketchBuild,
    blendDraft,
    editorOpen,
    extrudeDraft,
    offsetDraft,
    regions,
    revolveDraft,
    revolvePreviewParams,
    shellDraft,
  ]);
  // The final solid in the rendered prefix, for export. Drafts are not in the
  // document, so they are excluded: export is always the applied body.
  const activeCacheKey = useMemo(() => {
    if (!rebuild) return null;
    for (let index = rebuild.features.length - 1; index >= 0; index -= 1) {
      const feature = rebuild.features[index]!;
      if (feature.status !== "ok" || !feature.output) continue;
      if (
        feature.output.kind === "extrude" ||
        feature.output.kind === "revolve" ||
        feature.output.kind === "fillet" ||
        feature.output.kind === "chamfer" ||
        feature.output.kind === "shell" ||
        feature.output.kind === "offsetFace"
      ) {
        return feature.cacheKey;
      }
    }
    return null;
  }, [rebuild]);

  /**
   * The model-stage empty state. It is only meaningful when the model stage is
   * idle: an open sketch, support picker, insert menu or feature editor is the
   * user actively fixing the missing solid, so the callout would sit behind
   * their work. The copy distinguishes an empty document from a failed feature.
   */
  const noSolidMessage = useMemo(() => {
    if (kernelState === "loading" || kernelError) return null;
    if (mode !== "model" || sketchGesture) return null;
    if (solidFeatures.length > 0) return null;
    if (
      supportOpen ||
      datumDraft !== null ||
      editorOpen ||
      extrudeDraft !== null ||
      blendDraft !== null ||
      shellDraft !== null ||
      offsetDraft !== null ||
      projectDraft !== null ||
      insertMenu !== null ||
      exportOpen ||
      measureOpen
    ) {
      return null;
    }
    if (doc.features.length === 0) {
      return {
        title: "No solid",
        body: "Start with a sketch: draw a closed loop to create the first solid.",
      };
    }
    const hasError = rebuild?.features.some(
      (feature) => feature.status === "error",
    );
    return {
      title: "No solid",
      body: hasError
        ? "Draw a closed loop, select a region, or fix the feature errors in the history."
        : "Draw a closed loop or select a region to create a solid.",
    };
  }, [
    blendDraft,
    datumDraft,
    doc.features.length,
    editorOpen,
    exportOpen,
    extrudeDraft,
    insertMenu,
    kernelError,
    kernelState,
    measureOpen,
    mode,
    offsetDraft,
    projectDraft,
    rebuild,
    shellDraft,
    sketchGesture,
    solidFeatures.length,
    supportOpen,
  ]);

  const hasBaseForForm = useMemo(() => {
    const exclude =
      activeFeature &&
      (activeFeature.type === "extrude" || activeFeature.type === "revolve")
        ? activeFeature.id
        : null;
    return buildDoc.features.some(
      (feature) =>
        feature.id !== exclude &&
        feature.suppressed !== true &&
        (isExtrudeFeature(feature) ||
          isRevolveFeature(feature) ||
          isFilletFeature(feature) ||
          isChamferFeature(feature) ||
          isShellFeature(feature) ||
          isOffsetFaceFeature(feature)),
    );
  }, [buildDoc, activeFeature]);

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
      solidFeatures.length === 0 ||
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
    solidFeatures,
  ]);
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
  const projectedSourceFace = useMemo(() => {
    if (!activeSketchFeature || selection.length === 0) return null;
    for (const projection of activeSketchFeature.projections ?? []) {
      const prefix = `${projection.id}-`;
      if (selection.some((id) => id.startsWith(prefix))) {
        return projection.source;
      }
    }
    return null;
  }, [activeSketchFeature, selection]);

  const selectedConstraint = useMemo(
    () =>
      selectedConstraintId
        ? sketch.constraints.find(
            (constraint) => constraint.id === selectedConstraintId,
          ) ?? null
        : null,
    [sketch.constraints, selectedConstraintId],
  );
  const constraintSelectionInfo = useMemo(() => {
    if (!selectedConstraint) return [];
    return [
      {
        id: selectedConstraint.id,
        kind: "constraint",
        label: constraintLabel(selectedConstraint.type),
        detail: constraintParticipantSummary(sketch, selectedConstraint.id),
      },
    ];
  }, [selectedConstraint, sketch]);
  const constraintSelected = constraintSelectionInfo.length > 0;
  const popoverInfo = constraintSelected
    ? constraintSelectionInfo
    : selectedInfo;
  const selectedDimensions = useMemo(
    () => selectedInfo.filter((info) => info.kind === "dimension"),
    [selectedInfo],
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
  const filletRadiusMax = useMemo(() => {
    if (!filletSelection) return 10;
    const lengths = [filletSelection.a, filletSelection.b].map((line) => {
      const a = geometry.points[line.a];
      const b = geometry.points[line.b];
      return a && b ? Math.hypot(b[0] - a[0], b[1] - a[1]) : 10;
    });
    const ceiling = Math.min(...lengths) * 0.45;
    return Math.max(1, Math.round(ceiling * 10) / 10);
  }, [filletSelection, geometry.points]);

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

  const changeTool = (
    next: SketchTool,
    options?: { cancelOperation?: boolean },
  ): void => {
    setSelectedConstraintId(null);
    setProfileSelection([]);
    // D6: a tool button/key while a form is open cancels the form, then arms.
    // The shortcut path cancels explicitly so it can choose the stage after
    // the cancel (the cancel restores its own baseline mode). Profile
    // selection is the exception: the sketch tools are inputs to the open
    // extrude form (box/lasso pick regions), so they never cancel it.
    const selectingProfiles =
      mode === "sketch" && (editorOpen || extrudeDraft !== null);
    if (options?.cancelOperation !== false && !selectingProfiles) {
      cancelOpenOperationRef.current();
    }
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
    setShellDraft(null);
    setShellBaseline(null);
    setOffsetDraft(null);
    setOffsetBaseline(null);
    setOffsetGhostMesh(null);
    setRevolveDraft(null);
    setRevolveBaseline(null);
  };

  /** Filters and Select Other are ephemeral; a new/loaded document starts clean. */
  const resetSelectionFilters = (): void => {
    setModelFilter("all");
    setModelTool("select");
    setSketchFilter("all");
    setSelectOther(null);
    setSelectedConstraintId(null);
    setProfileSelection([]);
  };

  /** Leave the measure mode and drop its targets/overlays. */
  const endMeasure = (): void => {
    setMeasureOpen(false);
    setMeasureTargets([]);
    setMeasurement(null);
    setMeasureError(null);
    setMeasureBusy(false);
    viewportRef.current?.setEdgeSelection([]);
    viewportRef.current?.setFaceSelection([]);
  };

  /** Enter measure mode: it is page-level, so editors/drafts and the
   * selection close first (their edits are already committed). */
  const toggleMeasure = (): void => {
    if (measureOpen) {
      endMeasure();
      return;
    }
    cancelOpenOperationRef.current();
    setSupportOpen(false);
    setExportOpen(false);
    setBodyPick(null);
    setEdgeSelection([]);
    setFaceSelection([]);
    setSelectOther(null);
    viewportRef.current?.clearPick();
    viewportRef.current?.setFaceSelection([]);
    setModelTool("select");
    setMeasureError(null);
    setMeasurement(null);
    setMeasureTargets([]);
    setMeasureOpen(true);
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

  /**
   * Footer cancel / background click restores an edge blend's edges and size as
   * opened. Suppression and the name are timeline actions, not form fields, so
   * they are left as the user set them.
   */
  const cancelBlendEditor = (history = true): void => {
    const baseline = blendBaseline;
    dismissEditor();
    if (baseline) {
      const current = getState();
      const next = updateEdgeBlendFeature(
        current.doc,
        baseline.id,
        (feature) => {
          if (feature.type === "fillet" && baseline.type === "fillet") {
            return {
              ...feature,
              edges: baseline.edges,
              radius: baseline.radius,
            };
          }
          if (feature.type === "chamfer" && baseline.type === "chamfer") {
            return {
              ...feature,
              edges: baseline.edges,
              distance: baseline.distance,
            };
          }
          return feature;
        },
      );
      if (next !== current.doc) {
        const state = {
          doc: next,
          solved: current.solved,
          solvedFor: current.solvedFor,
        };
        if (history) commit(state);
        else replace(state);
      }
      setActiveFeatureId(baseline.id);
    }
    setEdgeSelection([]);
    setBodyPick(null);
    setSelectOther(null);
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

  /** Open the shell feature form; edits commit live like the blend form. */
  const openShellEditor = (feature: ShellFeature): void => {
    dismissEditor();
    setDatumDraft(null);
    setSupportOpen(false);
    setShellBaseline(feature);
    setShellDraft({
      mode: "edit",
      featureId: feature.id,
      faces: [...feature.faces],
      thickness: feature.thickness,
      anchorId: null,
    });
    const picks = feature.faces.map(faceBodyPick);
    setFaceSelection(picks);
    viewportRef.current?.setFaceSelection(picks);
    setModelFilter("faces");
    setMode("model");
    setSelection([]);
    setBodyPick(null);
  };

  /** Cancel restores the shell's open faces and thickness, never suppression. */
  const cancelShellEditor = (history = true): void => {
    const baseline = shellBaseline;
    setShellDraft(null);
    setShellBaseline(null);
    if (baseline) {
      const current = getState();
      const next = updateShellFeature(current.doc, baseline.id, (feature) => ({
        ...feature,
        faces: baseline.faces,
        thickness: baseline.thickness,
      }));
      if (next !== current.doc) {
        const state = {
          doc: next,
          solved: current.solved,
          solvedFor: current.solvedFor,
        };
        if (history) commit(state);
        else replace(state);
      }
      setActiveFeatureId(baseline.id);
    }
    setFaceSelection([]);
    viewportRef.current?.setFaceSelection([]);
    setBodyPick(null);
    setSelectOther(null);
    viewportRef.current?.clearPick();
    setSelection([]);
    setModelFilter("all");
  };

  /** Start a UI-only shell draft from the selected faces. */
  const beginShellDraft = (): void => {
    const faces = selectedFaceRefs;
    if (faces.length === 0) return;
    dismissEditor();
    setDatumDraft(null);
    setSupportOpen(false);
    setHistoryNotice(null);
    setShellDraft({
      mode: "new",
      featureId: null,
      faces: [...faces],
      thickness: defaultShellThickness(mesh),
      anchorId: activeFeatureId,
    });
    setModelFilter("faces");
    setMode("model");
    setSelection([]);
    setBodyPick(null);
  };

  const updateShellValue = (value: number): void => {
    if (!shellDraft || !Number.isFinite(value) || value <= 0) return;
    setShellDraft({ ...shellDraft, thickness: value });
    if (shellDraft.mode === "edit" && shellDraft.featureId) {
      const current = getState();
      const next = updateShellFeature(
        current.doc,
        shellDraft.featureId,
        (feature) => ({ ...feature, thickness: value }),
      );
      if (next !== current.doc) {
        commit(
          { doc: next, solved: current.solved, solvedFor: current.solvedFor },
          "shell-thickness",
        );
      }
    }
  };

  const updateShellFaces = (faces: TopoRef[]): void => {
    if (!shellDraft) return;
    setShellDraft({ ...shellDraft, faces });
    const picks = faces.map(faceBodyPick);
    setFaceSelection(picks);
    viewportRef.current?.setFaceSelection(picks);
    if (shellDraft.mode === "edit" && shellDraft.featureId) {
      const current = getState();
      const next = updateShellFeature(
        current.doc,
        shellDraft.featureId,
        (feature) => ({ ...feature, faces }),
      );
      if (next !== current.doc) {
        commit({
          doc: next,
          solved: current.solved,
          solvedFor: current.solvedFor,
        });
      }
    }
  };

  const applyShellDraft = (): void => {
    const draft = shellDraft;
    if (!draft || draft.faces.length === 0 || !(draft.thickness > 0)) return;
    const current = getState();
    if (draft.mode === "new") {
      const result = addShellFeature(
        current.doc,
        draft.faces,
        draft.thickness,
        { afterFeatureId: draft.anchorId },
      );
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
    setFaceSelection([]);
    viewportRef.current?.setFaceSelection([]);
    setBodyPick(null);
    setSelectOther(null);
    viewportRef.current?.clearPick();
    setMode("model");
    setSelection([]);
    setHistoryNotice(null);
    setModelFilter("all");
  };

  /** Open the offset-face form; edits commit live like the shell form. */
  const openOffsetEditor = (feature: OffsetFaceFeature): void => {
    dismissEditor();
    setDatumDraft(null);
    setSupportOpen(false);
    setOffsetBaseline(feature);
    setOffsetGhostMesh(mesh);
    setOffsetDraft({
      mode: "edit",
      featureId: feature.id,
      faces: [...feature.faces],
      distance: feature.distance,
      anchorId: null,
    });
    const picks = feature.faces.map(faceBodyPick);
    setFaceSelection(picks);
    viewportRef.current?.setFaceSelection(picks);
    setModelFilter("faces");
    setMode("model");
    setSelection([]);
    setBodyPick(null);
  };

  /** Cancel restores the offset's faces and distance, never suppression. */
  const cancelOffsetEditor = (history = true): void => {
    const baseline = offsetBaseline;
    setOffsetDraft(null);
    setOffsetBaseline(null);
    setOffsetGhostMesh(null);
    if (baseline) {
      const current = getState();
      const next = updateOffsetFaceFeature(
        current.doc,
        baseline.id,
        (feature) => ({
          ...feature,
          faces: baseline.faces,
          distance: baseline.distance,
        }),
      );
      if (next !== current.doc) {
        const state = {
          doc: next,
          solved: current.solved,
          solvedFor: current.solvedFor,
        };
        if (history) commit(state);
        else replace(state);
      }
      setActiveFeatureId(baseline.id);
    }
    setFaceSelection([]);
    viewportRef.current?.setFaceSelection([]);
    setBodyPick(null);
    setSelectOther(null);
    viewportRef.current?.clearPick();
    setSelection([]);
    setModelFilter("all");
  };

  /**
   * Project arbitrary body faces into the active sketch. This is a sketch edit:
   * it switches to the model to pick, then writes fixed reference loops back
   * into the same sketch and returns to it.
   */
  const beginProjectDraft = (): void => {
    const { feature } = resolveCurrent();
    if (!feature || feature.type !== "sketch") return;
    const current = getState();
    const target = findFeature(current.doc, feature.id);
    if (!target || !isSketchFeature(target)) return;
    cancelOpenOperationRef.current();
    setSelectedConstraintId(null);
    setProfileSelection([]);
    setProjectError(null);
    setProjectBusy(false);
    projectApplySeq.current += 1;
    setProjectDraft({
      sketchId: target.id,
      faces: [],
      edges: [],
      returnMode: mode,
    });
    setMode("model");
    setModelTool("select");
    setModelFilter("all");
    setSelection([]);
    setFaceSelection([]);
    setEdgeSelection([]);
    setBodyPick(null);
    setSelectOther(null);
    viewportRef.current?.clearPick();
    viewportRef.current?.setFaceSelection([]);
    setCancelToken((token) => token + 1);
    setFitToken((token) => token + 1);
  };

  const cancelProjectDraft = (): void => {
    const draft = projectDraft;
    if (!draft) return;
    projectApplySeq.current += 1;
    setProjectDraft(null);
    setProjectBusy(false);
    setProjectError(null);
    setFaceSelection([]);
    setEdgeSelection([]);
    viewportRef.current?.setFaceSelection([]);
    viewportRef.current?.setEdgeSelection([]);
    setBodyPick(null);
    setSelectOther(null);
    viewportRef.current?.clearPick();
    setSelection([]);
    setModelFilter("all");
    if (draft.returnMode === "sketch") {
      setMode("sketch");
      setTool("select");
      setFitToken((token) => token + 1);
    }
  };

  const projectLoop = async (
    client: KernelClient,
    cacheKey: string,
    face: TopoRef,
    frame: PlaneFrame,
  ): Promise<{ face: TopoRef; loops: Vec2[][] }> => {
    const boundary = await client.requestFaceBoundary(cacheKey, face);
    return {
      face,
      loops: boundary.loops.map((loop) =>
        loop.map((point) => projectPointToPlane(point, frame)),
      ),
    };
  };

  const projectEdgeLoop = async (
    client: KernelClient,
    cacheKey: string,
    edge: EdgeRef,
    frame: PlaneFrame,
  ): Promise<{ edge: EdgeRef; points: Vec2[]; closed: boolean }> => {
    const boundary = await client.requestEdgeBoundary(cacheKey, edge);
    return {
      edge,
      points: boundary.points.map((point) =>
        projectPointToPlane(point, frame),
      ),
      closed: boundary.closed,
    };
  };

  const applyProjectDraft = (): void => {
    const draft = projectDraft;
    const client = clientRef.current;
    if (
      !draft ||
      (draft.faces.length === 0 && draft.edges.length === 0) ||
      !client ||
      projectBusy
    ) {
      return;
    }
    const seq = ++projectApplySeq.current;
    const latest = getState();
    const target = findFeature(latest.doc, draft.sketchId);
    if (!target || !isSketchFeature(target)) {
      cancelProjectDraft();
      return;
    }
    const frame =
      rebuild?.sketchById.get(target.id)?.frame ??
      (isDefaultSupport(target.support)
        ? worldPlaneFrame("XY")
        : supportFrame(target.support));
    setProjectBusy(true);
    setProjectError(null);

    // Project the body as it exists at this sketch's step, not the source
    // feature: a later boolean may have trimmed or split it.
    const bodyKey = activeCacheKey;
    if (!bodyKey) {
      setProjectBusy(false);
      setProjectError("There is no body at this step to project.");
      return;
    }

    void Promise.all([
      Promise.all(
        draft.faces.map((face) => projectLoop(client, bodyKey, face, frame)),
      ),
      Promise.all(
        draft.edges.map((edge) =>
          projectEdgeLoop(client, bodyKey, edge, frame),
        ),
      ),
    ])
      .then(([faceResults, edgeResults]) => {
        if (seq !== projectApplySeq.current) return null;
        const current = getState();
        const sketchFeature = findFeature(current.doc, draft.sketchId);
        if (!sketchFeature || !isSketchFeature(sketchFeature)) return null;
        let sketch = sketchFeature.sketch;
        const projections = [...(sketchFeature.projections ?? [])];
        const added: string[] = [];
        for (const result of faceResults) {
          if (result.loops.length === 0) continue;
          const id = newProjectionId();
          const label = `Projected ${result.face.role}`;
          const next = applyProjectionGeometry(sketch, id, label, result.loops);
          if (!next) continue;
          sketch = next;
          projections.push({
            id,
            kind: "faceBoundary",
            source: result.face,
            label,
            loops: result.loops,
          });
          added.push(id);
        }
        for (const result of edgeResults) {
          if (result.points.length < 2) continue;
          const id = newProjectionId();
          const label = "Projected edge";
          const next = applyProjectionGeometry(
            sketch,
            id,
            label,
            [result.points],
            false,
            result.closed,
          );
          if (!next) continue;
          sketch = next;
          projections.push({
            id,
            kind: "edgeBoundary",
            source: result.edge.faces[0],
            edge: result.edge,
            label,
            loops: [result.points],
            closed: result.closed,
          });
          added.push(id);
        }
        if (added.length === 0) {
          throw new Error("No boundary could be projected from that selection.");
        }
        const outcome = isSolverReady() ? solveSketch(sketch) : null;
        const nextDoc = {
          ...current.doc,
          features: current.doc.features.map((feature) =>
            feature.id === sketchFeature.id
              ? {
                  ...sketchFeature,
                  sketch: outcome?.ok ? applySolution(sketch, outcome) : sketch,
                  projections,
                }
              : feature,
          ),
        };
        return { nextDoc, outcome, sketchFeatureId: sketchFeature.id };
      })
      .then((result) => {
        if (!result || seq !== projectApplySeq.current) return;
        commit({
          doc: result.nextDoc,
          solved: result.outcome,
          solvedFor: result.sketchFeatureId,
        });
        setProjectDraft(null);
        setProjectBusy(false);
        setProjectError(null);
        setFaceSelection([]);
        setEdgeSelection([]);
        viewportRef.current?.setFaceSelection([]);
        viewportRef.current?.setEdgeSelection([]);
        setBodyPick(null);
        setSelectOther(null);
        viewportRef.current?.clearPick();
        setSelection([]);
        setModelFilter("all");
        if (draft.returnMode === "sketch") {
          setMode("sketch");
          setTool("select");
          setFitToken((token) => token + 1);
        }
      })
      .catch((error: unknown) => {
        if (seq !== projectApplySeq.current) return;
        setProjectBusy(false);
        setProjectError(
          error instanceof Error ? error.message : String(error),
        );
      });
  };

  /** Start a UI-only offset-face draft from the selected faces. */
  const beginOffsetDraft = (): void => {
    const faces = selectedFaceRefs;
    if (faces.length === 0) return;
    dismissEditor();
    setDatumDraft(null);
    setSupportOpen(false);
    setHistoryNotice(null);
    setOffsetGhostMesh(mesh);
    setOffsetDraft({
      mode: "new",
      featureId: null,
      faces: [...faces],
      distance: defaultOffsetDistance(mesh),
      anchorId: activeFeatureId,
    });
    setModelFilter("faces");
    setMode("model");
    setSelection([]);
    setBodyPick(null);
  };

  const updateOffsetValue = (value: number): void => {
    if (!offsetDraft || !Number.isFinite(value) || value <= 0) return;
    const signed = offsetDraft.distance < 0 ? -value : value;
    setOffsetDraft({ ...offsetDraft, distance: signed });
    if (offsetDraft.mode === "edit" && offsetDraft.featureId) {
      const current = getState();
      const next = updateOffsetFaceFeature(
        current.doc,
        offsetDraft.featureId,
        (feature) => ({ ...feature, distance: signed }),
      );
      if (next !== current.doc) {
        commit(
          { doc: next, solved: current.solved, solvedFor: current.solvedFor },
          "offset-distance",
        );
      }
    }
  };

  const updateOffsetDirection = (direction: "out" | "in"): void => {
    if (!offsetDraft) return;
    const magnitude = Math.abs(offsetDraft.distance);
    if (magnitude === 0) return;
    const signed = direction === "in" ? -magnitude : magnitude;
    if (signed === offsetDraft.distance) return;
    setOffsetDraft({ ...offsetDraft, distance: signed });
    if (offsetDraft.mode === "edit" && offsetDraft.featureId) {
      const current = getState();
      const next = updateOffsetFaceFeature(
        current.doc,
        offsetDraft.featureId,
        (feature) => ({ ...feature, distance: signed }),
      );
      if (next !== current.doc) {
        commit({
          doc: next,
          solved: current.solved,
          solvedFor: current.solvedFor,
        });
      }
    }
  };

  const updateOffsetFaces = (faces: TopoRef[]): void => {
    if (!offsetDraft) return;
    setOffsetDraft({ ...offsetDraft, faces });
    const picks = faces.map(faceBodyPick);
    setFaceSelection(picks);
    viewportRef.current?.setFaceSelection(picks);
    if (offsetDraft.mode === "edit" && offsetDraft.featureId) {
      const current = getState();
      const next = updateOffsetFaceFeature(
        current.doc,
        offsetDraft.featureId,
        (feature) => ({ ...feature, faces }),
      );
      if (next !== current.doc) {
        commit({
          doc: next,
          solved: current.solved,
          solvedFor: current.solvedFor,
        });
      }
    }
  };

  const applyOffsetDraft = (): void => {
    const draft = offsetDraft;
    if (!draft || draft.faces.length === 0 || draft.distance === 0) return;
    const current = getState();
    if (draft.mode === "new") {
      const result = addOffsetFaceFeature(
        current.doc,
        draft.faces,
        draft.distance,
        { afterFeatureId: draft.anchorId },
      );
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
    setOffsetGhostMesh(null);
    setFaceSelection([]);
    viewportRef.current?.setFaceSelection([]);
    setBodyPick(null);
    setSelectOther(null);
    viewportRef.current?.clearPick();
    setMode("model");
    setSelection([]);
    setHistoryNotice(null);
    setModelFilter("all");
  };

  /**
   * Which feature sources may be inputs right now? Edges/faces from a draft's
   * generated geometry, or from the feature being edited, would reference
   * their own output.
   */
  const sourceKnown = (source: string): boolean => {
    if (source === "fillet-draft" || source === "chamfer-draft") return false;
    if (source === "shell-draft" || source === "offset-draft") return false;
    if (blendDraft?.featureId === source) return false;
    if (shellDraft?.featureId === source) return false;
    if (offsetDraft?.featureId === source) return false;
    return doc.features.some((feature) => feature.id === source);
  };

  /**
   * A pick from the 3D stage. Edges and faces are separate multi-sets: Shift
   * (or an open blend/shell draft) adds or toggles within the kind that is
   * already collecting, and a plain pick replaces the other set. Mixed sets are
   * not supported yet, so an additive pick of the other kind is ignored.
   */
  const handleBodyPick = (
    pick: BodyPick | null,
    additive: boolean,
    info?: PickInfo,
  ): void => {
    // A filtered-out hit is not a background click: keep the selection.
    if (info?.blocked) return;
    if (measureOpen) {
      // Measure mode consumes face/edge picks; clicking a target toggles it
      // and a third target replaces the oldest.
      setSelectOther(null);
      if (!pick) return;
      if (!(pick.kind === "face" && pick.ref) && !(pick.kind === "edge" && pick.edgeRef)) {
        return;
      }
      const key = measureTargetKey(pick);
      const selected = measureTargets.some(
        (target) => measureTargetKey(target) === key,
      );
      setMeasureTargets(
        selected
          ? measureTargets.filter(
              (target) => measureTargetKey(target) !== key,
            )
          : [...measureTargets, pick].slice(-2),
      );
      setBodyPick(null);
      return;
    }
    if (projectDraft) {
      // The project form is a multi-face input: every click toggles a face in
      // its list; the canvas stays a pick surface until the form closes.
      setSelectOther(null);
      setBodyPick(null);
      if (!pick) return;
      let faces = projectDraft.faces;
      let edges = projectDraft.edges;
      if (pick.kind === "face" && pick.ref) {
        if (!sourceKnown(pick.ref.source)) return;
        const key = faceRefKey(pick.ref);
        const selected = faces.some((face) => faceRefKey(face) === key);
        faces = selected
          ? faces.filter((face) => faceRefKey(face) !== key)
          : [...faces, pick.ref];
      } else if (pick.kind === "edge" && pick.edgeRef) {
        const ref = pick.edgeRef;
        if (
          !sourceKnown(ref.faces[0].source) ||
          !sourceKnown(ref.faces[1].source)
        ) {
          return;
        }
        const key = edgeRefKey(ref);
        const selected = edges.some((edge) => edgeRefKey(edge) === key);
        edges = selected
          ? edges.filter((edge) => edgeRefKey(edge) !== key)
          : [...edges, ref];
      } else {
        return;
      }
      setProjectDraft({ ...projectDraft, faces, edges });
      setProjectError(null);
      const facePicks = faces.map(faceBodyPick);
      const edgePicks = edges.map(edgeBodyPick);
      setFaceSelection(facePicks);
      viewportRef.current?.setFaceSelection(facePicks);
      setEdgeSelection(edgePicks);
      viewportRef.current?.setEdgeSelection(edgePicks);
      viewportRef.current?.setPickedFace(null);
      return;
    }
    setSelectOther(
      info &&
      info.candidates.length > 1 &&
      !blendDraft &&
      !shellDraft &&
      !offsetDraft
        ? info
        : null,
    );
    setSupportDatumId(
      pick?.kind === "datum" ? pick.datumId ?? null : null,
    );
    if (!pick) {
      if (blendDraft) {
        cancelBlendEditor();
        return;
      }
      if (shellDraft) {
        cancelShellEditor();
        return;
      }
      if (offsetDraft) {
        cancelOffsetEditor();
        return;
      }
      // A Shift-click on empty space is additive too: it must not throw away
      // the selection collected so far (a draft would lose its inputs).
      if (additive && (edgeSelection.length > 0 || faceSelection.length > 0)) {
        return;
      }
      setBodyPick(null);
      setEdgeSelection([]);
      setFaceSelection([]);
      viewportRef.current?.setEdgeSelection([]);
      viewportRef.current?.setFaceSelection([]);
      return;
    }
    if (pick.kind === "edge" && pick.edgeRef) {
      // Mixed sets are not a thing yet.
      if (additive && faceSelection.length > 0) return;
      const ref = pick.edgeRef;
      // The stage may be previewing the draft itself. Edges on its generated
      // rounds (or on the feature being edited) cannot be inputs.
      if (
        !sourceKnown(ref.faces[0].source) ||
        !sourceKnown(ref.faces[1].source)
      ) {
        return;
      }

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
      const stillSelected = next.some(
        (item) =>
          item.edgeRef !== undefined && edgeRefKey(item.edgeRef) === key,
      );
      // The badge names the last picked edge; a toggled-off edge must not stay
      // as the anchor, or it reads as selected while the set no longer has it.
      const anchor = stillSelected
        ? pick
        : ([...next].reverse().find((item) => item.edgeRef !== undefined) ??
          null);
      // While the blend form is open it is the readout; the small pick badge
      // would overlap it and repeat the same selection.
      setBodyPick(!blendDraft && anchor ? anchor : null);
      setEdgeSelection(next);
      viewportRef.current?.setEdgeSelection(next);
      if (!toggle) {
        setFaceSelection([]);
        viewportRef.current?.setFaceSelection([]);
        // The edge pick replaces the face set; drop its single overlay too.
        viewportRef.current?.setPickedFace(null);
      }
      if (blendDraft) {
        updateBlendEdges(
          next
            .map((item) => item.edgeRef)
            .filter((edge): edge is EdgeRef => edge !== undefined),
        );
      }
      return;
    }
    if (pick.kind === "face" && pick.ref) {
      if (additive && edgeSelection.length > 0) return;
      const ref = pick.ref;
      if (!sourceKnown(ref.source)) return;
      const key = faceRefKey(ref);
      const selected = faceSelection.some(
        (item) => item.ref !== undefined && faceRefKey(item.ref) === key,
      );
      const toggle = additive || shellDraft !== null || offsetDraft !== null;
      let next: BodyPick[];
      if (toggle && selected) {
        next = faceSelection.filter(
          (item) => item.ref === undefined || faceRefKey(item.ref) !== key,
        );
      } else if (toggle) {
        next = [...faceSelection, pick];
      } else {
        next = [pick];
      }
      const stillSelected = next.some(
        (item) => item.ref !== undefined && faceRefKey(item.ref) === key,
      );
      const anchor = stillSelected
        ? pick
        : (next[next.length - 1] ?? null);
      // The single overlay mirrors the face set's anchor; leaving the clicked
      // (now removed) face there kept it washed until the next click.
      setBodyPick(!shellDraft && !offsetDraft && anchor ? anchor : null);
      setFaceSelection(next);
      viewportRef.current?.setFaceSelection(next);
      viewportRef.current?.setPickedFace(
        shellDraft || offsetDraft ? null : anchor,
      );
      if (!toggle) {
        setEdgeSelection([]);
        viewportRef.current?.setEdgeSelection([]);
      }
      if (shellDraft) {
        updateShellFaces(
          next
            .map((item) => item.ref)
            .filter((item): item is TopoRef => item !== undefined),
        );
      } else if (offsetDraft) {
        updateOffsetFaces(
          next
            .map((item) => item.ref)
            .filter((item): item is TopoRef => item !== undefined),
        );
      }
      return;
    }

    // A datum/body pick is a single selection: drop both sets.
    setBodyPick(pick);
    setEdgeSelection([]);
    setFaceSelection([]);
    viewportRef.current?.setEdgeSelection([]);
    viewportRef.current?.setFaceSelection([]);
  };

  /**
   * A box/lasso gesture over the model. Which kind it collects follows the
   * pick filter: `faces` yields faces (the shell input), anything else edges.
   * An empty marquee is a no-op, never "select nothing".
   */
  const handleBodyMarquee = (
    picks: readonly BodyPick[],
    additive: boolean,
  ): void => {
    const kind = picks[0]?.kind;
    if (kind === "face") {
      const usable = picks.filter(
        (pick): pick is BodyPick & { ref: TopoRef } =>
          pick.kind === "face" &&
          pick.ref !== undefined &&
          sourceKnown(pick.ref.source),
      );
      if (usable.length === 0) return;
      if (projectDraft) {
        const merged = new Map<string, TopoRef>();
        if (additive) {
          for (const face of projectDraft.faces) {
            merged.set(faceRefKey(face), face);
          }
        }
        for (const item of usable) merged.set(faceRefKey(item.ref), item.ref);
        const faces = [...merged.values()];
        setProjectDraft({ ...projectDraft, faces });
        setProjectError(null);
        const picks = faces.map(faceBodyPick);
        const edgePicks = projectDraft.edges.map(edgeBodyPick);
        setBodyPick(null);
        setSelectOther(null);
        setFaceSelection(picks);
        viewportRef.current?.setFaceSelection(picks);
        viewportRef.current?.setPickedFace(null);
        setEdgeSelection(edgePicks);
        viewportRef.current?.setEdgeSelection(edgePicks);
        return;
      }
      const merged = new Map<string, BodyPick>();
      if (additive || shellDraft || offsetDraft) {
        for (const item of faceSelection) {
          if (item.ref) merged.set(faceRefKey(item.ref), item);
        }
      }
      for (const item of usable) {
        merged.set(faceRefKey(item.ref), item);
      }
      const next = [...merged.values()];
      const anchor = next[next.length - 1] ?? null;
      setSelectOther(null);
      setBodyPick(shellDraft || offsetDraft ? null : anchor);
      setFaceSelection(next);
      viewportRef.current?.setFaceSelection(next);
      viewportRef.current?.setPickedFace(
        shellDraft || offsetDraft ? null : anchor,
      );
      setEdgeSelection([]);
      viewportRef.current?.setEdgeSelection([]);
      if (shellDraft) {
        updateShellFaces(
          next
            .map((item) => item.ref)
            .filter((item): item is TopoRef => item !== undefined),
        );
      } else if (offsetDraft) {
        updateOffsetFaces(
          next
            .map((item) => item.ref)
            .filter((item): item is TopoRef => item !== undefined),
        );
      }
      return;
    }
    const usable = picks.filter(
      (pick): pick is BodyPick & { edgeRef: EdgeRef } =>
        pick.kind === "edge" &&
        pick.edgeRef !== undefined &&
        sourceKnown(pick.edgeRef.faces[0].source) &&
        sourceKnown(pick.edgeRef.faces[1].source),
    );
    if (usable.length === 0) return;
    if (projectDraft) {
      const merged = new Map<string, EdgeRef>();
      if (additive) {
        for (const edge of projectDraft.edges) {
          merged.set(edgeRefKey(edge), edge);
        }
      }
      for (const item of usable) merged.set(edgeRefKey(item.edgeRef), item.edgeRef);
      const edges = [...merged.values()];
      setProjectDraft({ ...projectDraft, edges });
      setProjectError(null);
      const facePicks = projectDraft.faces.map(faceBodyPick);
      const edgePicks = edges.map(edgeBodyPick);
      setBodyPick(null);
      setSelectOther(null);
      setFaceSelection(facePicks);
      viewportRef.current?.setFaceSelection(facePicks);
      viewportRef.current?.setPickedFace(null);
      setEdgeSelection(edgePicks);
      viewportRef.current?.setEdgeSelection(edgePicks);
      return;
    }
    const merged = new Map<string, BodyPick>();
    // A blend form always accumulates: losing inputs mid-edit is never useful.
    if (additive || blendDraft) {
      for (const item of edgeSelection) {
        if (item.edgeRef) merged.set(edgeRefKey(item.edgeRef), item);
      }
    }
    for (const item of usable) {
      merged.set(edgeRefKey(item.edgeRef), item);
    }
    const next = [...merged.values()];
    setSelectOther(null);
    setBodyPick(blendDraft ? null : (next[next.length - 1] ?? null));
    setEdgeSelection(next);
    viewportRef.current?.setEdgeSelection(next);
    setFaceSelection([]);
    viewportRef.current?.setFaceSelection([]);
    viewportRef.current?.setPickedFace(null);
    if (blendDraft) {
      updateBlendEdges(
        next
          .map((item) => item.edgeRef)
          .filter((edge): edge is EdgeRef => edge !== undefined),
      );
    }
  };
  // The viewport and the global keyboard effect are created once; a ref keeps
  // them pointed at the current handlers without re-registering listeners.
  useEffect(() => {
    handleBodyPickRef.current = handleBodyPick;
    handleMarqueeRef.current = handleBodyMarquee;
    cancelBlendRef.current = cancelBlendEditor;
    blendDraftOpenRef.current = blendDraft !== null;
    cancelShellRef.current = cancelShellEditor;
    shellDraftOpenRef.current = shellDraft !== null;
    cancelOffsetRef.current = cancelOffsetEditor;
    offsetDraftOpenRef.current = offsetDraft !== null;
    exportOpenRef.current = exportOpen;
    measureOpenRef.current = measureOpen;
    toggleMeasureRef.current = toggleMeasure;
    endMeasureRef.current = endMeasure;
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
    setSelectOther(null);
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

  /**
   * Cancel restores the *parameters* the popover edits, as they were when it
   * opened. History actions taken while it was open (suppress, rename) are not
   * part of the form and must survive: restoring the whole feature re-suppressed
   * a step that the user had just unsuppressed from the same timeline detail.
   */
  const cancelFeatureEditor = (history = true): void => {
    const baseline = editorBaseline;
    setEditorOpen(false);
    setEditorBaseline(null);
    if (!baseline) return;
    const original = baseline.feature;
    const current = getState();
    const next = updateExtrudeFeature(
      current.doc,
      original.id,
      (feature) => ({
        ...feature,
        sketchId: original.sketchId,
        regions: original.regions,
        height: original.height,
        operation: original.operation,
        end: original.end,
        symmetric: original.symmetric,
      }),
    );
    if (next !== current.doc) {
      const state = {
        doc: next,
        solved: current.solved,
        solvedFor: current.solvedFor,
      };
      // Undo/redo cancel first and must not make the cancel itself the entry
      // that the undo then pops (D9/F13).
      if (history) commit(state);
      else replace(state);
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
      setSelectOther(null);
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
    setSelectedConstraintId(null);
    setProfileSelection([]);
    cancelOpenOperationRef.current();
    endMeasure();
    setExportOpen(false);
    setInsertMenu(null);
    setFileMenuOpen(false);
    setDatumDraft(null);
    setSupportOpen(false);
    setSupportDatumId(null);
    setSupportFaceFlipped(false);
    setCreationAnchorId(null);
    setCreationAtStart(false);
    setFilletOpen(false);
    setFilletRadiusBefore(null);
    setActiveFeatureId(null);
    setMode("model");
    setSelection([]);
    setTrimNotice(null);
    setBodyPick(null);
    setEdgeSelection([]);
    setFaceSelection([]);
    setSelectOther(null);
    viewportRef.current?.clearPick();
    viewportRef.current?.setFaceSelection([]);
    // Abort any hidden sketch gesture (MODES F4/R6).
    setCancelToken((token) => token + 1);
    scrollTimelineToEnd();
  };

  const activateFeature = (feature: Feature): void => {
    clearTransientSolve();
    setSelectedConstraintId(null);
    setProfileSelection([]);
    // Timeline navigation leaves the current operation exactly as its cancel
    // would (MODES D5/R9) and never keeps a hidden draft (F4/R6).
    cancelOpenOperationRef.current();
    endMeasure();
    setExportOpen(false);
    setInsertMenu(null);
    setFileMenuOpen(false);
    setDatumDraft(null);
    setSupportOpen(false);
    setSupportDatumId(null);
    setSupportFaceFlipped(false);
    setCreationAtStart(false);
    setFilletOpen(false);
    setFilletRadiusBefore(null);
    setActiveFeatureId(feature.id);
    setMode(feature.type === "sketch" ? "sketch" : "model");
    setSelection([]);
    setTrimNotice(null);
    setBodyPick(null);
    setEdgeSelection([]);
    setFaceSelection([]);
    setSelectOther(null);
    viewportRef.current?.clearPick();
    viewportRef.current?.setFaceSelection([]);
    setCancelToken((token) => token + 1);
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
    } else if (isShellFeature(feature)) {
      openShellEditor(feature);
    } else if (isOffsetFaceFeature(feature)) {
      openOffsetEditor(feature);
    } else if (isRevolveFeature(feature)) {
      openRevolveEditor(feature);
    } else {
      openDatumEditor(feature);
    }
  };

  const finishSketch = (): void => {
    setSelectedConstraintId(null);
    setProfileSelection([]);
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
    // Leaving the sketch stage aborts any gesture and disarms the tool (R6);
    // the sketch canvas stays mounted but must not keep a hidden draft.
    setCancelToken((token) => token + 1);
    setTool("select");
    setDimensionRequest(null);
    setTrimNotice(null);
    setMode("model");
    setSelection([]);
  };

  /** Enter/Done while an extrude is active returns to the model without
   * switching the active feature to a different consuming extrude. */
  const finishActiveMode = (): void => {
    setSelectedConstraintId(null);
    setProfileSelection([]);
    if (revolveDraft) {
      commitRevolveDraft();
      return;
    }
    if (extrudeDraft) {
      commitExtrudeDraft();
      return;
    }
    if (activeFeature?.type === "extrude" || activeFeature?.type === "revolve") {
      dismissEditor();
      setCancelToken((token) => token + 1);
      setTool("select");
      setMode("model");
      setSelection([]);
      return;
    }
    finishSketch();
  };

  const selectExtrudeProfiles = (): void => {
    setSelectedConstraintId(null);
    setProfileSelection([]);
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
    setSelectOther(null);
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
    setSelectedConstraintId(null);
    setProfileSelection([]);
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
    cancelOpenOperationRef.current();
    endMeasure();
    setExportOpen(false);
    setCancelToken((token) => token + 1);
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
    cancelOpenOperationRef.current();
    endMeasure();
    setExportOpen(false);
    setCancelToken((token) => token + 1);
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
    // Keep the picked face as the support candidate, but the face multi-set is
    // a shell input, not a support choice; its popover would overlap this one.
    setFaceSelection([]);
    viewportRef.current?.setFaceSelection([]);
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
    setSelectOther(null);
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
    setSelectOther(null);
    viewportRef.current?.clearPick();
    setHistoryNotice(null);
  };

  const handleNewSketch = (): boolean => {
    const current = getState();
    const faceRef =
      bodyPick?.kind === "face" ? (bodyPick.ref ?? null) : null;
    if (bodyPick?.kind === "face" && !faceRef) {
      setHistoryNotice("This face has no stable reference; choose a world plane.");
      return false;
    }
    const hintFrame = faceRef ? frameFromHint(faceRef.hint) : null;
    if (faceRef && !hintFrame) {
      setHistoryNotice("Only planar faces can support a sketch.");
      return false;
    }
    const frame =
      hintFrame && supportFaceFlipped ? flipFrame(hintFrame) : hintFrame;
    const datumFeature =
      !faceRef && supportDatumId
        ? findFeature(current.doc, supportDatumId)
        : null;
    if (supportDatumId && (!datumFeature || !isDatumPlaneFeature(datumFeature))) {
      setHistoryNotice("The selected datum plane no longer exists.");
      return false;
    }
    const datumFrame =
      datumFeature && isDatumPlaneFeature(datumFeature)
        ? resolvedDatumFrame(datumFeature)
        : null;
    if (datumFeature && !datumFrame) {
      setHistoryNotice("The selected datum plane could not be resolved.");
      return false;
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
    setFaceSelection([]);
    setSelectOther(null);
    viewportRef.current?.clearPick();
    viewportRef.current?.setFaceSelection([]);
    return true;
  };

  const beginExtrudeDraft = (regions: readonly string[] = []): void => {
    setSelectedConstraintId(null);
    setProfileSelection([]);
    const { current, sketchFeature: source } = resolveCurrent();
    if (!source) return;
    cancelOpenOperationRef.current();
    setDatumDraft(null);
    setSupportOpen(false);
    setFilletOpen(false);
    setFilletRadiusBefore(null);
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
    setSelectOther(null);
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

  const beginRevolveDraft = (): void => {
    const source = activeSketchFeature;
    const ids = [...profileSelection];
    if (!source || ids.length === 0) return;
    const current = getState();
    const hasBody = current.doc.features.some(
      (feature) =>
        (isExtrudeFeature(feature) || isRevolveFeature(feature)) &&
        feature.suppressed !== true,
    );
    setSupportOpen(false);
    setDatumDraft(null);
    setHistoryNotice(null);
    setRevolveDraft({
      mode: "new",
      featureId: null,
      sketchId: source.id,
      regions: ids,
      axis: null,
      angle: 360,
      direction: "ccw",
      operation: hasBody ? "join" : "new",
      anchorId: activeFeatureId,
    });
    setProfileSelection([]);
    setSelection([]);
    setSelectedConstraintId(null);
    setTool("select");
    setMode("sketch");
    setBodyPick(null);
    setEdgeSelection([]);
    setFaceSelection([]);
    setSelectOther(null);
    viewportRef.current?.clearPick();
  };

  const updateRevolveDraft = (
    update: (draft: RevolveDraft) => RevolveDraft,
    mergeKey?: string,
  ): void => {
    const currentDraft = revolveDraft;
    if (!currentDraft) return;
    const next = update(currentDraft);
    setRevolveDraft(next);
    if (next.mode !== "edit" || !next.featureId || next.axis === null) return;
    const current = getState();
    const doc = updateRevolveFeature(
      current.doc,
      next.featureId,
      (feature) => ({
        ...feature,
        regions: next.regions,
        axis: next.axis!,
        angle: next.angle,
        direction: next.direction,
        operation: next.operation,
      }),
    );
    if (doc !== current.doc) {
      commit(
        { doc, solved: current.solved, solvedFor: current.solvedFor },
        mergeKey,
      );
    }
  };

  const cancelRevolveEditor = (history = true): void => {
    const baseline = revolveBaseline;
    const draft = revolveDraft;
    setRevolveDraft(null);
    setRevolveBaseline(null);
    if (draft?.mode === "edit" && baseline) {
      const current = getState();
      const doc = updateRevolveFeature(current.doc, baseline.id, (feature) => ({
        ...feature,
        regions: baseline.regions,
        axis: baseline.axis,
        angle: baseline.angle,
        direction: baseline.direction,
        operation: baseline.operation,
      }));
      if (doc !== current.doc) {
        const state = {
          doc,
          solved: current.solved,
          solvedFor: current.solvedFor,
        };
        if (history) commit(state);
        else replace(state);
      }
      setActiveFeatureId(baseline.id);
      setMode("model");
    }
    setSelection([]);
  };

  const openRevolveEditor = (feature: RevolveFeature): void => {
    dismissEditor();
    setDatumDraft(null);
    setSupportOpen(false);
    setRevolveBaseline(feature);
    setRevolveDraft({
      mode: "edit",
      featureId: feature.id,
      sketchId: feature.sketchId,
      regions: [...feature.regions],
      axis: feature.axis,
      angle: feature.angle,
      direction: feature.direction,
      operation: feature.operation,
      anchorId: null,
    });
    setActiveFeatureId(feature.id);
    setMode("sketch");
    setTool("select");
    setSelection([]);
    setProfileSelection([]);
    setBodyPick(null);
    setEdgeSelection([]);
    setFaceSelection([]);
    setSelectOther(null);
    viewportRef.current?.clearPick();
  };

  const commitRevolveDraft = (): void => {
    const draft = revolveDraft;
    if (!draft || draft.regions.length === 0 || draft.axis === null) return;
    if (!(draft.angle >= 1 && draft.angle <= 360)) return;
    if (revolveDraftError) return;
    const current = getState();
    if (draft.mode === "new") {
      const result = addRevolveFeature(
        current.doc,
        draft.sketchId,
        draft.regions,
        draft.axis,
        draft.angle,
        draft.operation,
        draft.direction,
        { afterFeatureId: draft.anchorId },
      );
      commit({
        doc: result.doc,
        solved: current.solved,
        solvedFor: current.solvedFor,
      });
      setActiveFeatureId(result.feature.id);
    } else if (draft.featureId) {
      setActiveFeatureId(draft.featureId);
    }
    setRevolveDraft(null);
    setRevolveBaseline(null);
    setSelection([]);
    setProfileSelection([]);
    setMode("model");
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
    if (revolveDraft) {
      // The revolve form is the active surface. A sketch line or the X/Y
      // reference sets the axis; every other sketch click is swallowed so a
      // second selection popover cannot stack over the form.
      if (entityId) {
        const axis = revolveAxisForPick(revolveSketch ?? sketch, entityId);
        if (axis) {
          updateRevolveDraft((draft) => ({ ...draft, axis }));
        }
      }
      setSelection([]);
      setSelectedConstraintId(null);
      setProfileSelection([]);
      return;
    }
    if (additive && (profileSelection.length > 0 || selectedConstraintId)) {
      return;
    }
    setSelectedConstraintId(null);
    setProfileSelection([]);
    if (filletOpen) {
      setFilletOpen(false);
      setFilletRadiusBefore(null);
    }
    if (entityId === null) {
      // D7: an empty click during profile selection clears the regions and
      // keeps the draft; its own footer is the only cancel.
      if (extrudeDraft) {
        updateExtrudeDraft((draft) =>
          draft && draft.regions.length > 0 ? { ...draft, regions: [] } : draft,
        );
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

  const selectConstraint = (
    id: string | null,
    additive = false,
  ): void => {
    // A constraint is one family; Shift from geometry/dimensions/profiles is
    // blocked, and a plain click replaces them (SELECTION.md S2/S8).
    if (additive && (selection.length > 0 || profileSelection.length > 0)) {
      return;
    }
    clearTransientSolve();
    setSelectedConstraintId(id);
    setProfileSelection([]);
    setSelection([]);
    setDimensionRequest(null);
    setPendingConstraint(null);
    setTrimNotice(null);
  };

  const deleteSelection = (): void => {
    if (selectedConstraintId) {
      const constraint = sketch.constraints.find(
        (candidate) => candidate.id === selectedConstraintId,
      );
      setSelectedConstraintId(null);
      setSelection([]);
      if (!constraint) return;
      const base = currentSketch();
      const next = removeConstraint(base, constraint.id);
      if (next === base) return;
      solveAndCommit(next);
      return;
    }
    if (profileSelection.length > 0) {
      setProfileSelection([]);
      return;
    }
    if (filletOpen) {
      setFilletOpen(false);
      setFilletRadiusBefore(null);
    }
    const deletable = selectedInfo.filter((info) => info.kind !== "reference");
    if (deletable.length === 0) return;
    const base = currentSketch();
    let next = deleteEntities(
      base,
      deletable
        .filter((info) => info.kind !== "dimension")
        .map((info) => info.id),
    );
    for (const info of deletable) {
      if (info.kind === "dimension") {
        next = removeConstraint(next, info.id);
      }
    }
    if (next === base) return;
    setSelection([]);
    solveAndCommit(next);
  };

  // Key handlers are registered once but must see the current selection and
  // active feature. Tool shortcuts enter the active sketch (or its source).
  const pickProjectedSourceFace = (): void => {
    if (!projectedSourceFace) return;
    const pick = faceBodyPick(projectedSourceFace);
    setMode("model");
    setModelFilter("faces");
    setSelection([]);
    setSelectedConstraintId(null);
    setProfileSelection([]);
    setBodyPick(pick);
    setFaceSelection([pick]);
    setEdgeSelection([]);
    setSelectOther(null);
    viewportRef.current?.setFaceSelection([pick]);
    viewportRef.current?.setPickedFace(pick);
  };

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
      onPick: (pick, additive, info) => {
        // The viewport is created once; route picks through the current
        // handler so edge multi-select sees fresh draft/selection state.
        handleBodyPickRef.current(pick, additive, info);
      },
      onMarquee: (picks, additive) => {
        handleMarqueeRef.current(picks, additive);
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
      // This effect owns only the sketch's supporting-face projection. User
      // projections (the project tool) can share the plane and must survive.
      const projection = target.projections?.find(
        (candidate) =>
          candidate.kind === "faceBoundary" &&
          faceRefKey(candidate.source) === faceRefKey(faceSupport.ref),
      );
      const supportChanged = !framesClose(faceSupport.frame, frame);
      let sketch = target.sketch;
      let nextProjection = projection;
      let projections = target.projections;
      if (projection) {
        // Documents projected before v15 cache polyline chords for circular
        // boundaries. Upgrade the representation once, unless a user already
        // constrained geometry to those chords.
        const wantsCircle = loops.some(
          (loop) => projectedCircle(loop) !== null,
        );
        const hasCircle = (sketch.references?.circles ?? []).some(
          (circle) => circle.projectionId === projection.id,
        );
        const representationStale = wantsCircle !== hasCircle;
        if (
          representationStale &&
          !projectionHasDependents(sketch, projection.id)
        ) {
          const next = applyProjectionGeometry(
            sketch,
            projection.id,
            projection.label,
            loops,
          );
          if (next) {
            sketch = next;
            nextProjection = { ...projection, loops, stale: undefined };
          }
        } else if (!sameProjectedLoops(projection.loops, loops)) {
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

    /**
     * User projections are derived references too: re-resolve them against the
     * body as it exists at that sketch's step. The support projection above is
     * owned by the support effect, so the first projection matching the
     * support face is skipped.
     */
    const markProjectionStale = (
      featureId: string,
      projectionId: string,
    ): void => {
      const latest = getState();
      const target = findFeature(latest.doc, featureId);
      if (!target || !isSketchFeature(target)) return;
      const projection = target.projections?.find(
        (candidate) => candidate.id === projectionId,
      );
      if (!projection || projection.stale) return;
      replace({
        doc: {
          ...latest.doc,
          features: latest.doc.features.map((feature) =>
            feature.id === target.id
              ? {
                  ...target,
                  projections: target.projections?.map((candidate) =>
                    candidate.id === projectionId
                      ? { ...candidate, stale: true }
                      : candidate,
                  ),
                }
              : feature,
          ),
        },
        solved: latest.solved,
        solvedFor: latest.solvedFor,
      });
    };

    const applyUserProjection = (
      featureId: string,
      projectionId: string,
      worldLoops: Vec3[][],
      closed: boolean,
    ): void => {
      const latest = getState();
      const target = findFeature(latest.doc, featureId);
      if (!target || !isSketchFeature(target) || target.suppressed) return;
      const projection = target.projections?.find(
        (candidate) => candidate.id === projectionId,
      );
      if (!projection) return;
      const frame =
        rebuild.sketchById.get(featureId)?.frame ??
        (isDefaultSupport(target.support)
          ? worldPlaneFrame("XY")
          : supportFrame(target.support));
      const loops = worldLoops.map((loop) =>
        loop.map((point) => projectPointToPlane(point, frame)),
      );
      const same = sameProjectedLoops(projection.loops, loops);
      const wantsCircle =
        closed &&
        loops.some((loop) => projectedCircle(loop) !== null);
      const hasCircle = (target.sketch.references?.circles ?? []).some(
        (circle) => circle.projectionId === projectionId,
      );
      const representationStale = closed && wantsCircle !== hasCircle;
      if (same && !representationStale) return;
      let sketch: Sketch | null = null;
      if (
        representationStale &&
        !projectionHasDependents(target.sketch, projectionId)
      ) {
        sketch = applyProjectionGeometry(
          target.sketch,
          projectionId,
          projection.label,
          loops,
          false,
          closed,
        );
      } else if (!same) {
        sketch = applyProjectionGeometry(
          target.sketch,
          projectionId,
          projection.label,
          loops,
          true,
          closed,
        );
      }
      if (!sketch) {
        if (!same) markProjectionStale(featureId, projectionId);
        return;
      }
      const nextProjection = { ...projection, loops, stale: undefined };
      const outcome = isSolverReady() ? solveSketch(sketch) : null;
      replace({
        doc: {
          ...latest.doc,
          features: latest.doc.features.map((feature) =>
            feature.id === target.id
              ? {
                  ...target,
                  sketch: outcome?.ok ? applySolution(sketch, outcome) : sketch,
                  projections:
                    target.projections?.map((candidate) =>
                      candidate.id === projectionId
                        ? nextProjection
                        : candidate,
                    ) ?? [nextProjection],
                }
              : feature,
          ),
        },
        solved: outcome,
        solvedFor: target.id,
      });
    };

    const isSolidOutput = (kind: string | undefined): boolean =>
      kind === "extrude" ||
      kind === "revolve" ||
      kind === "fillet" ||
      kind === "chamfer" ||
      kind === "shell" ||
      kind === "offsetFace";

    // The body available to each sketch: the last solid result before it. A
    // sketch after the history cursor is not in `rebuild`, so it is skipped
    // rather than marked stale.
    const prefixBySketch = new Map<string, string | null>();
    let prefixKey: string | null = null;
    for (const result of rebuild.features) {
      if (result.output?.kind === "sketch") {
        prefixBySketch.set(result.featureId, prefixKey);
      } else if (
        result.status === "ok" &&
        result.cacheKey &&
        isSolidOutput(result.output?.kind)
      ) {
        prefixKey = result.cacheKey;
      }
    }

    for (const feature of current.doc.features) {
      if (!isSketchFeature(feature) || feature.suppressed) continue;
      const projections = feature.projections ?? [];
      if (projections.length === 0) continue;
      if (!prefixBySketch.has(feature.id)) continue;
      const bodyKey = prefixBySketch.get(feature.id);
      if (!bodyKey) continue;
      const supportKey =
        feature.support.kind === "face"
          ? faceRefKey(feature.support.ref)
          : null;
      let supportProjectionId: string | null = null;
      if (supportKey) {
        supportProjectionId =
          projections.find(
            (projection) =>
              projection.kind === "faceBoundary" &&
              faceRefKey(projection.source) === supportKey,
          )?.id ?? null;
      }
      for (const projection of projections) {
        if (projection.id === supportProjectionId) continue;
        if (projection.kind === "edgeBoundary") {
          if (!projection.edge) continue;
          const key = `${bodyKey}|edge|${edgeRefKey(projection.edge)}`;
          const cached = edgeBoundaryCache.current.get(key);
          if (cached) {
            queueMicrotask(() =>
              applyUserProjection(
                feature.id,
                projection.id,
                [cached.points],
                cached.closed,
              ),
            );
            continue;
          }
          if (edgeBoundaryPending.current.has(key)) continue;
          edgeBoundaryPending.current.add(key);
          client
            .requestEdgeBoundary(bodyKey, projection.edge)
            .then((result) => {
              edgeBoundaryPending.current.delete(key);
              edgeBoundaryCache.current.set(key, {
                points: result.points,
                closed: result.closed,
              });
              applyUserProjection(
                feature.id,
                projection.id,
                [result.points],
                result.closed,
              );
            })
            .catch((error: unknown) => {
              edgeBoundaryPending.current.delete(key);
              if (
                error instanceof Error &&
                !error.message.includes("no longer cached")
              ) {
                markProjectionStale(feature.id, projection.id);
              }
            });
          continue;
        }
        const key = `${bodyKey}|${faceRefKey(projection.source)}`;
        const cached = faceBoundaryCache.current.get(key);
        if (cached) {
          queueMicrotask(() =>
            applyUserProjection(
              feature.id,
              projection.id,
              cached.loops,
              true,
            ),
          );
          continue;
        }
        if (faceBoundaryPending.current.has(key)) continue;
        faceBoundaryPending.current.add(key);
        client
          .requestFaceBoundary(bodyKey, projection.source)
          .then((result) => {
            faceBoundaryPending.current.delete(key);
            const frame = frameFromNormalAndOrigin(
              result.normal,
              result.centroid,
            );
            if (!frame) return;
            faceBoundaryCache.current.set(key, {
              frame,
              loops: result.loops,
            });
            applyUserProjection(
              feature.id,
              projection.id,
              result.loops,
              true,
            );
          })
          .catch((error: unknown) => {
            faceBoundaryPending.current.delete(key);
            if (
              error instanceof Error &&
              !error.message.includes("no longer cached")
            ) {
              markProjectionStale(feature.id, projection.id);
            }
          });
      }
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
    viewportRef.current?.setFaceSelection(faceSelection);
  }, [faceSelection]);

  // Measure is a mode: its targets drive the same overlays but never the
  // document selection, and the kernel answers exact properties.
  useEffect(() => {
    if (!measureOpen) return;
    viewportRef.current?.setEdgeSelection(
      measureTargets.filter((pick) => pick.kind === "edge"),
    );
    viewportRef.current?.setFaceSelection(
      measureTargets.filter((pick) => pick.kind === "face"),
    );
  }, [measureOpen, measureTargets]);

  useEffect(() => {
    if (!measureOpen) return;
    const client = clientRef.current;
    if (!activeCacheKey || !client) {
      setMeasurement(null);
      setMeasureError("There is no body at this step to measure.");
      return;
    }
    const targets: MeasureTarget[] = [];
    for (const pick of measureTargets) {
      if (pick.kind === "face" && pick.ref) {
        targets.push({ kind: "face", ref: pick.ref });
      } else if (pick.kind === "edge" && pick.edgeRef) {
        targets.push({ kind: "edge", ref: pick.edgeRef });
      }
    }
    let cancelled = false;
    setMeasureBusy(true);
    client
      .measure(activeCacheKey, targets)
      .then((result) => {
        if (cancelled) return;
        setMeasurement(result);
        setMeasureError(null);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setMeasurement(null);
        setMeasureError(
          error instanceof Error ? error.message : String(error),
        );
      })
      .finally(() => {
        if (!cancelled) setMeasureBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [measureOpen, measureTargets, activeCacheKey]);

  useEffect(() => {
    viewportRef.current?.setPickFilter(modelFilter);
  }, [modelFilter]);

  useEffect(() => {
    viewportRef.current?.setPickTool(modelTool);
  }, [modelTool]);

  useEffect(() => {
    viewportRef.current?.setSketchOverlay(modelSketchOverlay);
  }, [modelSketchOverlay]);

  // On an extrude step, the feature it created is the subject of the stage.
  // The sketch overlay still shows the profile it consumed.
  const featureHighlightId = useMemo(() => {
    if (
      mode !== "model" ||
      supportOpen ||
      projectDraft !== null ||
      datumDraft !== null ||
      extrudeDraft !== null
    ) {
      return null;
    }
    // The draft is a synthetic feature that owns its generated faces while it
    // previews.
    if (blendDraft?.mode === "new") return `${blendDraft.kind}-draft`;
    if (shellDraft?.mode === "new") return "shell-draft";
    if (offsetDraft?.mode === "new") return "offset-draft";
    if (revolveDraft?.mode === "new") return "revolve-draft";
    return activeFeature &&
      (isExtrudeFeature(activeFeature) ||
        isEdgeBlendFeature(activeFeature) ||
        isShellFeature(activeFeature) ||
        isOffsetFaceFeature(activeFeature) ||
        isRevolveFeature(activeFeature)) &&
      !activeFeature.suppressed
      ? activeFeature.id
      : null;
  }, [
    mode,
    supportOpen,
    projectDraft,
    datumDraft,
    extrudeDraft,
    blendDraft,
    shellDraft,
    offsetDraft,
    revolveDraft,
    activeFeature,
  ]);

  useEffect(() => {
    viewportRef.current?.setFeatureHighlight(featureHighlightId);
  }, [featureHighlightId]);

  useEffect(() => {
    viewportRef.current?.setGhostMesh(offsetGhostMesh);
  }, [offsetGhostMesh]);

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
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
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

  const drawAndCommit = (base: Sketch, next: Sketch): boolean => {
    if (next === base) return false;
    const ok = solveAndCommit(next);
    if (ok) setFitToken((token) => token + 1);
    return ok;
  };

  const handlePolyline = (
    vertices: DraftVertex[],
    closed: boolean,
  ): boolean => {
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
        ...(vertex.referenceCircleId
          ? { referenceCircleId: vertex.referenceCircleId }
          : {}),
      };
    });
    return drawAndCommit(base, addPolyline(base, valid, closed));
  };

  const handlePoint = (vertex: DraftVertex): void => {
    solveAndCommit(
      addPoint(
        currentSketch(),
        vertex.point,
        vertex.referenceLineId,
        vertex.referenceLineIds,
        vertex.referenceCircleId,
      ),
    );
    setSelection([]);
  };

  const handleRectangle = (spec: RectangleSpec): void => {
    const base = currentSketch();
    const next =
      spec.kind === "center"
        ? addCenterRectangle(base, spec.a, spec.b)
        : spec.kind === "3-point"
          ? addOrientedRectangle(base, spec.a, spec.b, spec.c)
          : addRectangle(base, spec.a, spec.b);
    drawAndCommit(base, next);
  };

  const handleCircle = (spec: CircleSpec): void => {
    const base = currentSketch();
    if (spec.kind === "2-point") {
      drawAndCommit(base, addCircleByDiameter(base, spec.a, spec.b));
      return;
    }
    if (spec.kind === "3-point") {
      drawAndCommit(base, addCircleThroughPoints(base, spec.a, spec.b, spec.c));
      return;
    }
    const valid = spec.center.existingPointId
      ? {
          ...spec.center,
          existingPointId: findSketchPoint(base, spec.center.existingPointId)
            ? spec.center.existingPointId
            : undefined,
        }
      : spec.center;
    drawAndCommit(base, addCircle(base, valid, spec.radius));
  };

  const handleArc = (spec: ArcSpec): void => {
    const base = currentSketch();
    const next =
      spec.kind === "center"
        ? addCenterArc(base, spec.center, spec.start, spec.end)
        : spec.kind === "tangent"
          ? addTangentArc(base, spec.start, spec.end, spec.lineId)
          : addArc(base, spec.start, spec.end, spec.through);
    drawAndCommit(base, next);
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

  const profileEditing = activeExtrude !== null || extrudeDraft !== null;

  const handleSelectRegion = (regionId: string, additive: boolean): void => {
    // Profile mode (a draft or an existing extrude editor) edits the operation's
    // regions; ordinary select selects the profile family and never starts a
    // feature (SELECTION.md S1/S4).
    if (!profileEditing) {
      if (additive && (selection.length > 0 || selectedConstraintId)) return;
      setSelection([]);
      setSelectedConstraintId(null);
      setProfileSelection((current) =>
        additive
          ? current.includes(regionId)
            ? current.filter((id) => id !== regionId)
            : [...current, regionId]
          : [regionId],
      );
      return;
    }
    setSelectedConstraintId(null);
    setProfileSelection([]);
    setSelection([]);
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
    if (!profileEditing) {
      if (additive && (selection.length > 0 || selectedConstraintId)) return;
      setSelection([]);
      setSelectedConstraintId(null);
      setProfileSelection((current) => {
        if (!additive) return regionIds;
        const next = new Set(current);
        for (const id of regionIds) {
          if (next.has(id)) next.delete(id);
          else next.add(id);
        }
        return [...next];
      });
      return;
    }
    setSelection([]);
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

  const handleMarqueeSelectEntities = (
    ids: string[],
    additive: boolean,
  ): void => {
    // Empty marquee: no-op. It must not clear the current selection.
    if (ids.length === 0) return;
    if (additive && (profileSelection.length > 0 || selectedConstraintId)) {
      return;
    }
    setSelectedConstraintId(null);
    setProfileSelection([]);
    setSelection((current) => {
      if (!additive) return ids;
      const next = new Set(current);
      for (const id of ids) {
        if (next.has(id)) next.delete(id);
        else next.add(id);
      }
      return [...next];
    });
  };

  const selectedProfileRegions = useMemo(
    () =>
      profileSelection
        .map((id) => regions.find((region) => region.id === id))
        .filter((region): region is NonNullable<typeof region> => Boolean(region)),
    [profileSelection, regions],
  );

  const selectAllProfileRegions = (): void => {
    setProfileSelection(
      regions
        .filter((region) => region.kind === "material")
        .map((region) => region.id),
    );
  };

  const selectAllProfileVoids = (): void => {
    setProfileSelection(
      regions
        .filter((region) => region.kind === "void")
        .map((region) => region.id),
    );
  };

  const autoSelectProfileRegions = (): void => {
    setProfileSelection(selectExtrudeRegions(regions, []).ids);
  };

  const extrudeSelectedProfiles = (): void => {
    const ids = selectedProfileRegions.map((region) => region.id);
    if (ids.length === 0) return;
    beginExtrudeDraft(ids);
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
    // A measurement made only of fixed/projected geometry can be a reference
    // annotation but never a driving constraint.
    const canDrive = driving && dimensionCanDrive(next, id);
    if (canDrive) next = updateConstraintValue(next, id, value);
    next = setDimensionDriving(next, id, canDrive);
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
    endMeasure();
    const current = getState();
    const next: Doc = { ...current.doc, features: [] };
    rebuildCache.clear();
    faceBoundaryCache.current.clear();
    faceBoundaryPending.current.clear();
    edgeBoundaryCache.current.clear();
    edgeBoundaryPending.current.clear();
    setLostFaceRefs(new Set());
    setDatumDraft(null);
    reset({ doc: next, solved: null, solvedFor: null });
    resetSelectionFilters();
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
    setSelectOther(null);
    viewportRef.current?.clearPick();
    setZoomPreset("fit");
    setFitToken((token) => token + 1);
    scrollTimelineToEnd();
  };

  const loadExample = (): void => {
    endMeasure();
    // "Load the example" is a full reset, not an edit of the current sketch:
    // created features and document names must not survive it.
    const fresh = createExampleDocument();
    rebuildCache.clear();
    faceBoundaryCache.current.clear();
    faceBoundaryPending.current.clear();
    edgeBoundaryCache.current.clear();
    edgeBoundaryPending.current.clear();
    setLostFaceRefs(new Set());
    setDatumDraft(null);
    resetSelectionFilters();
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
    setActiveFeatureId(null);
    dismissEditor();
    setSupportOpen(false);
    setCreationAnchorId(null);
    setCreationAtStart(false);
    setMode("model");
    setSolveError(null);
    setSelection([]);
    setDimensionRequest(null);
    setReferenceDimensions(false);
    setFilletOpen(false);
    setFilletRadiusBefore(null);
    setTool("select");
    setZoomPreset("fit");
    setFitToken((token) => token + 1);
    setBodyPick(null);
    setEdgeSelection([]);
    setFaceSelection([]);
    setSelectOther(null);
    setExportOpen(false);
    setMesh(null);
    viewportRef.current?.clearPick();
    viewportRef.current?.clearMesh();
    viewportRef.current?.setFaceSelection([]);
    scrollTimelineToEnd();
  };

  const openDocument = (next: Doc): void => {
    endMeasure();
    rebuildCache.clear();
    faceBoundaryCache.current.clear();
    faceBoundaryPending.current.clear();
    edgeBoundaryCache.current.clear();
    edgeBoundaryPending.current.clear();
    setLostFaceRefs(new Set());
    setDatumDraft(null);
    reset({ doc: next, solved: null, solvedFor: null });
    resetSelectionFilters();
    setActiveFeatureId(null);
    dismissEditor();
    setSupportOpen(false);
    setCreationAnchorId(null);
    setCreationAtStart(false);
    setMode("model");
    setSelection([]);
    setSolveError(null);
    setExportOpen(false);
    setMesh(null);
    setFaceSelection([]);
    viewportRef.current?.clearMesh();
    viewportRef.current?.setFaceSelection([]);
    scrollTimelineToEnd();
    setFileError(null);
    setFileMenuOpen(false);
    setBodyPick(null);
    setEdgeSelection([]);
    setFaceSelection([]);
    setSelectOther(null);
    setExportOpen(false);
    setMesh(null);
    viewportRef.current?.clearPick();
    viewportRef.current?.clearMesh();
    viewportRef.current?.setFaceSelection([]);
    saveDoc(next);
    saveLocalFile(next);
    setFileIndex(loadFileIndex());
  };

  const toggleFileMenu = (): void => {
    if (!fileMenuOpen) {
      // A page-level header surface leaves the open operation the same way its
      // cancel would (MODES D5/F17), so a form never lingers behind the menu.
      cancelOpenOperationRef.current();
      setCancelToken((token) => token + 1);
      endMeasure();
      setExportOpen(false);
      setFileIndex(loadFileIndex());
    }
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
    downloadBlob(
      new Blob([serializeDoc(current.doc)], { type: "application/json" }),
      `${current.doc.name || "part"}.cad`,
    );
    setFileMenuOpen(false);
  };

  /** Export the rendered prefix solid, derived from the worker's cache. */
  const exportModel = async (format: "stl" | "step"): Promise<void> => {
    const cacheKey = activeCacheKey;
    const client = clientRef.current;
    if (!cacheKey || !client || exporting) return;
    setExporting(format);
    setExportError(null);
    try {
      const data = await client.exportSolid(format, cacheKey);
      const current = getState();
      downloadBlob(
        new Blob([data], {
          type: format === "stl" ? "model/stl" : "application/step",
        }),
        `${current.doc.name || "part"}.${format}`,
      );
      setExportOpen(false);
    } catch (error) {
      setExportError(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setExporting(null);
    }
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
    setSelectedConstraintId(null);
    setProfileSelection([]);
    // Cancel without adding a history entry: the undo below must act on the
    // document change the user means, not on the cancellation itself (D9).
    cancelOpenOperationRef.current({ history: false });
    endMeasure();
    setExportOpen(false);
    undo();
    setFitToken((token) => token + 1);
  };

  const goForward = (): void => {
    clearTransientSolve();
    setSelectedConstraintId(null);
    setProfileSelection([]);
    cancelOpenOperationRef.current({ history: false });
    endMeasure();
    setExportOpen(false);
    redo();
    setFitToken((token) => token + 1);
  };

  // Opening a page-level surface (measure/export) or leaving an operation
  // (timeline, undo) cancels it exactly as its footer cancel would (MODES R9,
  // D5, D9). Assigned after every cancel callback exists; read through a ref by
  // the openers above so the ordering does not create a use-before-declare.
  useEffect(() => {
    cancelOpenOperationRef.current = (options) => {
      const history = options?.history !== false;
      if (filletOpen) {
        cancelFillet();
        return;
      }
      if (supportOpen) {
        setSupportOpen(false);
        setCreationAnchorId(null);
        setCreationAtStart(false);
        setSupportFaceFlipped(false);
        setSupportDatumId(null);
        return;
      }
      if (projectDraft) {
        cancelProjectDraft();
        return;
      }
      if (blendDraft) {
        cancelBlendEditor(history);
        return;
      }
      if (shellDraft) {
        cancelShellEditor(history);
        return;
      }
      if (offsetDraft) {
        cancelOffsetEditor(history);
        return;
      }
      if (revolveDraft) {
        cancelRevolveEditor(history);
        return;
      }
      if (extrudeDraft) {
        cancelExtrudeDraft();
        return;
      }
      if (editorOpen) {
        cancelFeatureEditor(history);
        return;
      }
      if (datumDraft) {
        cancelDatumDraft();
      }
    };
  });

  // The one keydown precedence table (MODES.md R1/R2/R7/R8, §3.3). Re-registered
  // each render so every branch sees the current operation/gesture; local
  // listeners only handle the line draft and the two inline editors.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      const textField = Boolean(
        target &&
          (tag === "INPUT" ||
            tag === "TEXTAREA" ||
            tag === "SELECT" ||
            target.isContentEditable),
      );
      if (event.key === "Escape") {
        if (textField || event.defaultPrevented) return;
        // R1: one press pops one layer: menu, operation, gesture, tool, selection.
        if (insertMenu) {
          setInsertMenu(null);
          return;
        }
        if (fileMenuOpen) {
          setFileMenuOpen(false);
          return;
        }
        if (filletOpen) {
          cancelFillet();
          return;
        }
        if (supportOpen) {
          setSupportOpen(false);
          setCreationAnchorId(null);
          setCreationAtStart(false);
          setSupportFaceFlipped(false);
          setSupportDatumId(null);
          return;
        }
        if (measureOpen) {
          endMeasure();
          return;
        }
        if (exportOpen) {
          setExportOpen(false);
          return;
        }
        if (projectDraft) {
          cancelProjectDraft();
          return;
        }
        if (blendDraft) {
          cancelBlendEditor();
          return;
        }
        if (shellDraft) {
          cancelShellEditor();
          return;
        }
        if (offsetDraft) {
          cancelOffsetEditor();
          return;
        }
        if (revolveDraft) {
          commitRevolveDraft();
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
          return;
        }
        if (mode === "sketch" && sketchGesture) {
          // Drop the draft/marquee/target, keep the armed tool (R1 step 4).
          setCancelToken((token) => token + 1);
          return;
        }
        if (mode === "sketch" && tool !== "select") {
          changeTool("select");
          return;
        }
        if (mode === "model" && modelTool !== "select") {
          setModelTool("select");
          return;
        }
        // R1 step 6: clear the selection/picks but stay in the stage.
        const hadSelection =
          selection.length > 0 ||
          selectedConstraintId !== null ||
          profileSelection.length > 0 ||
          bodyPick !== null ||
          edgeSelection.length > 0 ||
          faceSelection.length > 0 ||
          selectOther !== null ||
          pendingConstraint !== null ||
          solveError !== null ||
          dimensionRequest !== null;
        setPendingConstraint(null);
        setSolveError(null);
        setDimensionRequest(null);
        setFilletOpen(false);
        setFilletRadiusBefore(null);
        setSelection([]);
        setSelectedConstraintId(null);
        setProfileSelection([]);
        setBodyPick(null);
        setEdgeSelection([]);
        setFaceSelection([]);
        setSelectOther(null);
        viewportRef.current?.clearPick();
        viewportRef.current?.setFaceSelection([]);
        if (hadSelection) return;
        // R1 step 7: at rest, Escape is the end tail. No active step is a no-op.
        if (activeFeatureId) clearActiveFeature();
        return;
      }

      // R7: text fields own every key. A focused button or link still activates
      // natively on Enter (R2 step 1) but must not block the letter shortcuts.
      if (textField || event.defaultPrevented) return;
      if (event.key === "Enter" && (tag === "BUTTON" || tag === "A")) return;
      // Menus own their content; Enter activates a focused menu item natively.
      if (insertMenu || fileMenuOpen) return;

      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === "z") {
        event.preventDefault();
        setPendingConstraint(null);
        setSolveError(null);
        if (event.shiftKey) goForward();
        else goBack();
        return;
      }
      if (meta && event.key.toLowerCase() === "y") {
        event.preventDefault();
        setPendingConstraint(null);
        setSolveError(null);
        goForward();
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        // M11/M15: the export page and measure have no Enter primary.
        if (measureOpen || exportOpen) return;
        if (supportOpen) {
          if (handleNewSketch()) setSupportOpen(false);
          return;
        }
        if (projectDraft) {
          if (
            !projectBusy &&
            projectDraft.faces.length + projectDraft.edges.length > 0
          ) {
            applyProjectDraft();
          }
          return;
        }
        if (filletOpen) {
          if (filletSelection) applyFillet();
          return;
        }
        if (blendDraft) {
          if (blendDraft.edges.length > 0 && blendDraft.value > 0) {
            applyBlendDraft();
          }
          return;
        }
        if (shellDraft) {
          if (shellDraft.faces.length > 0 && shellDraft.thickness > 0) {
            applyShellDraft();
          }
          return;
        }
        if (offsetDraft) {
          if (
            offsetDraft.faces.length > 0 &&
            offsetDraft.distance !== 0 &&
            !offsetPreviewError
          ) {
            applyOffsetDraft();
          }
          return;
        }
        if (revolveDraft) {
          if (!revolvePreviewError) commitRevolveDraft();
          return;
        }
        if (extrudeDraft) {
          commitExtrudeDraft();
          return;
        }
        if (editorOpen) {
          finishActiveMode();
          return;
        }
        if (datumDraft) {
          commitDatumDraft();
          return;
        }
        if (mode === "sketch") {
          // A rect/circle/arc/marquee/target owns Enter as a visible no-op.
          if (sketchGesture) return;
          if (tool !== "select") {
            changeTool("select");
            return;
          }
          if (
            selection.length > 0 ||
            selectedConstraintId ||
            profileSelection.length > 0
          ) {
            return;
          }
          finishActiveMode();
        }
        return;
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        if (
          mode === "sketch" &&
          (selectedConstraintId || profileSelection.length > 0) &&
          !sketchGesture
        ) {
          event.preventDefault();
          deleteKey();
          return;
        }
        if (
          mode !== "sketch" ||
          sketchGesture ||
          filletOpen ||
          supportOpen ||
          measureOpen ||
          exportOpen ||
          blendDraft ||
          shellDraft ||
          offsetDraft ||
          revolveDraft ||
          editorOpen ||
          datumDraft
        ) {
          return;
        }
        event.preventDefault();
        if (extrudeDraft) {
          // The selected things are extrusion profiles, not sketch geometry.
          // Backspace removes them from the draft (the same result as an empty
          // click, D7); geometry deletion lives in plain sketch selection.
          if (selection.length > 0) deleteKey();
          updateExtrudeDraft((draft) =>
            draft && draft.regions.length > 0
              ? { ...draft, regions: [] }
              : draft,
          );
          setSelection([]);
          return;
        }
        deleteKey();
        return;
      }

      if (meta || event.altKey) return;
      const key = event.key.toLowerCase();
      if (mode === "model" && key === "m") {
        event.preventDefault();
        toggleMeasure();
        return;
      }
      switch (key) {
        case "v":
        case "b":
        case "g": {
          const selectionTool =
            key === "v" ? "select" : key === "b" ? "box" : "lasso";
          if (mode === "sketch") {
            changeTool(selectionTool as SketchTool);
          } else {
            cancelOpenOperationRef.current();
            setModelTool(selectionTool as ModelPickTool);
          }
          break;
        }
        case "l":
        case "p":
        case "r":
        case "c":
        case "a":
        case "d":
        case "t": {
          const nextTool: SketchTool =
            key === "l"
              ? "line"
              : key === "p"
                ? "point"
                : key === "r"
                  ? "rect"
                  : key === "c"
                    ? "circle"
                    : key === "a"
                      ? "arc"
                      : key === "d"
                        ? "dimension"
                        : "trim";
          // D6: cancel the open form, then arm the tool; do not change the
          // stage behind a form. The cancel restores its baseline mode, so the
          // sketch stage is entered after it.
          cancelOpenOperationRef.current();
          enterSketchMode();
          changeTool(nextTool, { cancelOperation: false });
          break;
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

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
            ? "Click a filled region to select its profile; the profile popover's extrude chip starts the feature. Shift adds. Box/lasso selects geometry and dimensions through the filter."
            : "Select to inspect, or drag a box/lasso around geometry and dimensions. L line · P point · B box · G lasso · R rectangle · C circle · A arc · D dimension · T trim · Delete removes.";

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
                onClick={() => {
                  // The page is a document-level surface: close live editors
                  // and drafts (their edits are already committed) and the
                  // stage selection so they do not peek out behind it.
                  endMeasure();
                  cancelOpenOperationRef.current();
                  setSupportOpen(false);
                  setBodyPick(null);
                  setEdgeSelection([]);
                  setFaceSelection([]);
                  setSelectOther(null);
                  viewportRef.current?.clearPick();
                  viewportRef.current?.setFaceSelection([]);
                  setFileMenuOpen(false);
                  setExportError(null);
                  setExportOpen(true);
                }}
                disabled={!activeCacheKey}
                title={
                  activeCacheKey
                    ? "Inspect and export the current body"
                    : "There is no body at this step to export"
                }
                data-testid="open-export"
              >
                export…
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
          // Capture phase: geometry hit targets stop propagation, but a canvas
          // click must still take keyboard focus away from a toolbar/timeline
          // control so the next Enter belongs to the stage (R2).
          onPointerDownCapture={(event) => {
            const target = event.target as Element | null;
            if (
              !target?.closest(".viewport-canvas") &&
              !target?.closest("svg.sketch-canvas")
            ) {
              return;
            }
            const active = document.activeElement as HTMLElement | null;
            if (
              active &&
              active !== document.body &&
              active.tagName !== "INPUT" &&
              active.tagName !== "TEXTAREA" &&
              !active.isContentEditable
            ) {
              active.blur();
            }
          }}
          onPointerDown={(event) => {
            // A background click dismisses an operation with the same restore
            // as its footer cancel (MODES R4/R9); it never also selects through
            // it. Popovers, tool rows, the chip and the view controls are exempt.
            const target = event.target as Element | null;
            if (!target) return;
            if (target.closest(".stage-popover")) return;
            if (target.closest(".tool-line")) return;
            if (target.closest(".tool-options")) return;
            if (target.closest(".model-tools")) return;
            if (target.closest(".select-other")) return;
            if (target.closest(".stage-foot")) return;
            const canvas = Boolean(target.closest(".viewport-canvas"));
            // Page-level surfaces exist over either stage and close first.
            if (exportOpen) {
              setExportOpen(false);
              if (canvas) viewportRef.current?.suppressNextClick();
              return;
            }
            if (measureOpen) {
              // The canvas is the measure pick surface; elsewhere closes it.
              if (!canvas) endMeasure();
              return;
            }
            if (mode === "sketch") {
              // The drawing surface owns background clicks (S3–S7); the only
              // sketch-stage operation that a background click dismisses is
              // the corner fillet (S12).
              if (filletOpen) cancelFillet();
              return;
            }
            if (mode !== "model") return;
            // Pick surfaces: clicks feed the operation, they never cancel it.
            if (
              canvas &&
              (blendDraft || shellDraft || offsetDraft || projectDraft || supportOpen)
            )
              return;
            if (supportOpen) {
              cancelOpenOperationRef.current();
              return;
            }
            if (projectDraft) {
              cancelProjectDraft();
              return;
            }
            if (blendDraft) {
              cancelBlendEditor();
              return;
            }
            if (shellDraft) {
              cancelShellEditor();
              return;
            }
            if (offsetDraft) {
              cancelOffsetEditor();
              return;
            }
            if (revolveDraft) {
              cancelRevolveEditor();
              return;
            }
            if (extrudeDraft) {
              cancelExtrudeDraft();
              if (canvas) viewportRef.current?.suppressNextClick();
              return;
            }
            if (editorOpen) {
              cancelFeatureEditor();
              if (canvas) viewportRef.current?.suppressNextClick();
              return;
            }
            if (datumDraft) {
              cancelDatumDraft();
              if (canvas) viewportRef.current?.suppressNextClick();
            }
          }}
        >
          <div className={`model-layer${mode === "model" ? "" : " is-hidden"}`}>
            <canvas ref={canvasRef} className="viewport-canvas" />

            <div className="model-tools">
              <div className="tool-line" role="toolbar" aria-label="Model tools">
                <span className="tool-kicker">tools</span>
                <ToolButton
                  label="select"
                  shortcut="v"
                  active={modelTool === "select" && !measureOpen}
                  // Switching tools never touches the selection: a box can be
                  // refined by a Shift-click (even without switching), and the
                  // old clear-on-select lost the whole set.
                  onClick={() => {
                    cancelOpenOperationRef.current();
                    endMeasure();
                    setModelTool("select");
                    setSelectOther(null);
                  }}
                  testId="model-tool-select"
                />
                <ToolButton
                  label="box"
                  shortcut="b"
                  active={modelTool === "box"}
                  onClick={() => {
                    cancelOpenOperationRef.current();
                    endMeasure();
                    setModelTool("box");
                  }}
                  testId="model-tool-box"
                />
                <ToolButton
                  label="lasso"
                  shortcut="g"
                  active={modelTool === "lasso"}
                  onClick={() => {
                    cancelOpenOperationRef.current();
                    endMeasure();
                    setModelTool("lasso");
                  }}
                  testId="model-tool-lasso"
                />
                <ToolButton
                  label="measure"
                  shortcut="m"
                  active={measureOpen}
                  onClick={toggleMeasure}
                  testId="model-tool-measure"
                />
              </div>
              <ToolOptionsRow
                kicker="filter"
                options={["all", "edges", "faces"]}
                value={modelFilter}
                onChange={(value) => {
                  setModelFilter(value as ModelPickFilter);
                  setSelectOther(null);
                }}
                note={selectionFilterNote(modelFilter)}
                testPrefix="model-filter"
              />
            </div>

            {selectOther &&
            selectOther.candidates.length > 1 &&
            !blendDraft &&
            !shellDraft &&
            !measureOpen ? (
              <button
                type="button"
                className="select-other"
                style={{
                  left: selectOther.x + 14,
                  top: selectOther.y + 16,
                }}
                data-testid="select-other"
                aria-label={`Select other: ${selectOther.candidates[selectOther.index]?.kind ?? "pick"} ${selectOther.index + 1} of ${selectOther.candidates.length}`}
                onClick={() => viewportRef.current?.cyclePick()}
              >
                <span className="select-other-kind">
                  {selectOther.candidates[selectOther.index]?.kind ?? "pick"}
                </span>
                <span className="select-other-count">
                  {selectOther.index + 1} of {selectOther.candidates.length}
                </span>
                <span>click to cycle</span>
              </button>
            ) : null}

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
                    ? faceSelection.length > 1
                      ? `${faceSelection.length} faces selected`
                      : "Face selected"
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

            {noSolidMessage ? (
              <div
                className="viewport-message subtle"
                data-testid="no-solid-message"
              >
                <strong>{noSolidMessage.title}</strong>
                <span>{noSolidMessage.body}</span>
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
                <span className="tool-kicker">tools</span>
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
                <ToolButton
                  label="project"
                  active={projectDraft !== null}
                  onClick={beginProjectDraft}
                  testId="tool-project"
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
                <span className="tool-separator" />
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
              </div>

              {tool === "select" ? (
                <ToolOptionsRow
                  kicker="filter"
                  options={["all", "points", "curves", "dimensions"]}
                  value={sketchFilter}
                  onChange={(value) =>
                    setSketchFilter(value as SketchSelectionFilter)
                  }
                  note={selectionFilterNote(sketchFilter)}
                  testPrefix="sketch-filter"
                />
              ) : tool === "rect" ? (
                <ToolOptionsRow
                  kicker="rectangle"
                  options={["corner", "center", "3-point"]}
                  value={rectVariant}
                  onChange={(value) =>
                    setRectVariant(value as RectangleVariant)
                  }
                  note="corner drags two opposite corners; center starts at the middle; 3-point sets a side then the height"
                  testPrefix="rect-variant"
                />
              ) : tool === "circle" ? (
                <ToolOptionsRow
                  kicker="circle"
                  options={["center", "2-point", "3-point"]}
                  value={circleVariant}
                  onChange={(value) =>
                    setCircleVariant(value as CircleVariant)
                  }
                  note="center then radius; two diameter ends; three points on the circle"
                  testPrefix="circle-variant"
                />
              ) : tool === "arc" ? (
                <ToolOptionsRow
                  kicker="arc"
                  options={["3-point", "center", "tangent"]}
                  value={arcVariant}
                  onChange={(value) => setArcVariant(value as ArcVariant)}
                  note="3-point: start, end, then the curve; center: centre, start, end; tangent: start on a line endpoint"
                  testPrefix="arc-variant"
                />
              ) : tool === "dimension" ? (
                <div
                  className="tool-options"
                  role="toolbar"
                  aria-label="New dimension"
                >
                  <span className="tool-kicker">new dimension</span>
                  <span
                    className="seg"
                    role="group"
                    aria-label="New dimension kind"
                  >
                    <button
                      type="button"
                      className={!referenceDimensions ? "is-selected" : ""}
                      aria-pressed={!referenceDimensions}
                      onClick={() => setReferenceDimensions(false)}
                      data-testid="dimension-kind-driving"
                    >
                      driving
                    </button>
                    <button
                      type="button"
                      className={referenceDimensions ? "is-selected" : ""}
                      aria-pressed={referenceDimensions}
                      onClick={() => setReferenceDimensions(true)}
                      data-testid="reference-toggle"
                    >
                      reference
                    </button>
                  </span>
                  <span className="tool-note">
                    {referenceDimensions
                      ? "measures only — no DOF spent"
                      : "constrains the geometry"}
                  </span>
                </div>
              ) : null}

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
                  onMarqueeSelectEntities={handleMarqueeSelectEntities}
                  tool={tool}
                  selectionFilter={profileMode ? "all" : sketchFilter}
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
                  selectedConstraintId={selectedConstraintId}
                  onSelectConstraint={selectConstraint}
                  editDimensionRequest={dimensionEditRequest}
                  rectVariant={rectVariant}
                  circleVariant={circleVariant}
                  arcVariant={arcVariant}
                  onCreatePoint={handlePoint}
                  onTrimCurve={handleTrimCurve}
                  onCreateDimension={handleCreateDimension}
                  onChangeDimension={handleChangeDimension}
                  onMoveDimension={handleMoveDimension}
                  onDeleteDimension={handleDeleteDimension}
                  stageActive={mode === "sketch"}
                  onGestureChange={setSketchGesture}
                />
              </div>
            </div>

            {trimNotice ? (
              <div className="sketch-notice" data-testid="trim-notice" role="status">
                {trimNotice}
              </div>
            ) : null}

            {revolveDraft ? (
              <RevolvePopover
                sketchName={
                  findFeature(doc, revolveDraft.sketchId)?.name ?? "Sketch"
                }
                profileCount={revolveDraft.regions.length}
                axis={revolveDraft.axis}
                axisCandidates={revolveAxisCandidates}
                angles={revolveDraft.angle}
                direction={revolveDraft.direction}
                operation={revolveDraft.operation}
                hasBase={hasBaseForForm}
                isDraft={revolveDraft.mode === "new"}
                error={revolveDraftError ?? revolvePreviewError}
                position={popoverPosition}
                onMove={setPopoverPosition}
                onAxis={(axis) =>
                  updateRevolveDraft((draft) => ({ ...draft, axis }))
                }
                onAngle={(angle) =>
                  updateRevolveDraft(
                    (draft) => ({
                      ...draft,
                      angle,
                      direction:
                        angle >= 360 ? "ccw" : draft.direction,
                    }),
                    "revolve-angle",
                  )
                }
                onAngleEnd={endMerge}
                onDirection={(direction) =>
                  updateRevolveDraft((draft) => ({ ...draft, direction }))
                }
                onOperation={(operation) =>
                  updateRevolveDraft((draft) => ({ ...draft, operation }))
                }
                onApply={commitRevolveDraft}
                onCancel={cancelRevolveEditor}
              />
            ) : null}

            {!profileMode &&
            !revolveDraft &&
            mode === "sketch" &&
            selectedProfileRegions.length > 0 ? (
              <ProfilePopover
                regions={selectedProfileRegions}
                hasMaterial={regions.some((region) => region.kind === "material")}
                hasVoids={regions.some((region) => region.kind === "void")}
                onAll={selectAllProfileRegions}
                onVoids={selectAllProfileVoids}
                onAuto={autoSelectProfileRegions}
                onExtrude={extrudeSelectedProfiles}
                onRevolve={beginRevolveDraft}
                onClear={() => setProfileSelection([])}
                position={popoverPosition}
                onMove={setPopoverPosition}
              />
            ) : null}

            {popoverInfo.length > 0 && !revolveDraft ? (
              !constraintSelected && filletOpen && filletSelection ? (
                <FilletPopover
                  radius={filletRadius}
                  maxRadius={filletRadiusMax}
                  onRadius={setFilletRadius}
                  onApply={applyFillet}
                  onCancel={cancelFillet}
                  position={popoverPosition}
                  onMove={setPopoverPosition}
                />
              ) : (
                <SelectionPopover
                  info={popoverInfo}
                  actions={constraintSelected ? [] : constraintActions}
                  construction={constraintSelected ? null : construction}
                  onConstraint={handleConstraintAction}
                  onConstruction={handleConstruction}
                  onDelete={deleteSelection}
                  onSourceFace={
                    projectedSourceFace ? pickProjectedSourceFace : undefined
                  }
                  deletable={
                    constraintSelected ||
                    selectedInfo.some((info) => info.kind !== "reference")
                  }
                  onOpenFillet={
                    constraintSelected
                      ? undefined
                      : filletSelection
                        ? openFillet
                        : undefined
                  }
                  dimension={
                    !constraintSelected && dimensionTarget
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
                  trim={
                    !constraintSelected && trimCurve
                      ? { onClick: startTrim }
                      : undefined
                  }
                  onEditDimension={
                    selectedDimensions.length === 1
                      ? () => {
                          dimensionEditSeq.current += 1;
                          setDimensionEditRequest({
                            id: selectedDimensions[0]!.id,
                            seq: dimensionEditSeq.current,
                          });
                        }
                      : undefined
                  }
                  position={popoverPosition}
                  onMove={setPopoverPosition}
                />
              )
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
                  className="mono stage-health"
                  data-testid="body-health"
                  data-bodies={shownMesh.stats.bodies}
                  data-shells={shownMesh.stats.shells}
                  data-valid={shownMesh.stats.valid}
                >
                  {shownMesh.stats.bodies} bod
                  {shownMesh.stats.bodies === 1 ? "y" : "ies"} ·{" "}
                  {shownMesh.stats.shells} shell
                  {shownMesh.stats.shells === 1 ? "" : "s"} ·{" "}
                  {shownMesh.stats.valid ? "watertight" : "invalid"}
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
                  <span
                    className="stage-meta"
                    title="Model space is Z-up, in millimetres"
                    data-testid="stage-units"
                  >
                    Z-up · mm
                  </span>
                  {/* A hairline separates the readout group from the action:
                      the annotation is not a control and should not read like
                      the fit button next to it. */}
                  <span className="stage-divider" aria-hidden="true" />
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
                if (handleNewSketch()) setSupportOpen(false);
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
              hasBase={hasBaseForForm}
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

          {projectDraft ? (
            <ProjectPopover
              faces={projectDraft.faces}
              edges={projectDraft.edges}
              busy={projectBusy}
              error={projectError}
              position={popoverPosition}
              onMove={setPopoverPosition}
              onRemoveFace={(index) => {
                const faces = projectDraft.faces.filter(
                  (_, at) => at !== index,
                );
                setProjectDraft({ ...projectDraft, faces });
                setProjectError(null);
                const picks = faces.map(faceBodyPick);
                setFaceSelection(picks);
                viewportRef.current?.setFaceSelection(picks);
              }}
              onRemoveEdge={(index) => {
                const edges = projectDraft.edges.filter(
                  (_, at) => at !== index,
                );
                setProjectDraft({ ...projectDraft, edges });
                setProjectError(null);
                const picks = edges.map(edgeBodyPick);
                setEdgeSelection(picks);
                viewportRef.current?.setEdgeSelection(picks);
              }}
              onApply={applyProjectDraft}
              onCancel={cancelProjectDraft}
            />
          ) : blendDraft ? (
            <SolidBlendPopover
              kind={blendDraft.kind}
              value={blendDraft.value}
              max={blendValueMax}
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
                setSelectOther(null);
                viewportRef.current?.clearPick();
              }}
              onFillet={() => beginBlendDraft("fillet")}
              onChamfer={() => beginBlendDraft("chamfer")}
            />
          ) : offsetDraft ? (
            <OffsetFacePopover
              distance={offsetDraft.distance}
              max={offsetDistanceMax}
              faces={offsetDraft.faces}
              isDraft={offsetDraft.mode === "new"}
              error={offsetPreviewError}
              position={popoverPosition}
              onMove={setPopoverPosition}
              onValue={updateOffsetValue}
              onValueEnd={endMerge}
              onDirection={updateOffsetDirection}
              onRemoveFace={(index) =>
                updateOffsetFaces(
                  offsetDraft.faces.filter((_, at) => at !== index),
                )
              }
              onApply={applyOffsetDraft}
              onCancel={cancelOffsetEditor}
            />
          ) : shellDraft ? (
            <ShellPopover
              thickness={shellDraft.thickness}
              max={shellThicknessMax}
              faces={shellDraft.faces}
              isDraft={shellDraft.mode === "new"}
              position={popoverPosition}
              onMove={setPopoverPosition}
              onValue={updateShellValue}
              onValueEnd={endMerge}
              onRemoveFace={(index) =>
                updateShellFaces(
                  shellDraft.faces.filter((_, at) => at !== index),
                )
              }
              onApply={applyShellDraft}
              onCancel={cancelShellEditor}
            />
          ) : faceSelection.length > 0 &&
            mode === "model" &&
            !supportOpen &&
            !datumDraft ? (
            <FaceSelectionPopover
              faces={selectedFaceRefs}
              position={bodyPopoverPosition}
              onMove={setBodyPopoverPosition}
              canNewSketch={
                selectedFaceRefs.length === 1 &&
                selectedFaceRefs[0]?.hint.surfaceType === "PLANE"
              }
              onNewSketch={() => {
                const face = faceSelection[faceSelection.length - 1];
                if (!face) return;
                setBodyPick(face);
                openInsertSketch(activeFeatureId, false);
              }}
              onClear={() => {
                setFaceSelection([]);
                setBodyPick(null);
                setSelectOther(null);
                viewportRef.current?.clearPick();
              }}
              onShell={beginShellDraft}
              onOffset={beginOffsetDraft}
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
              hasBase={hasBaseForForm}
              onSelectProfiles={selectExtrudeProfiles}
            />
          ) : null}

          {exportOpen && shownMesh && activeCacheKey ? (
            <ExportPopover
              stats={shownMesh.stats}
              fileName={`${doc.name || "part"}.stl`}
              busy={exporting}
              error={exportError}
              position={exportPosition}
              onMove={setExportPosition}
              onExport={(format) => void exportModel(format)}
              onClose={() => setExportOpen(false)}
            />
          ) : null}

          {measureOpen ? (
            <MeasurePopover
              targets={measureTargets}
              result={measurement}
              busy={measureBusy}
              error={measureError}
              position={measurePosition}
              onMove={setMeasurePosition}
              onClear={() => setMeasureTargets([])}
              onClose={endMeasure}
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
                      : isShellFeature(feature)
                        ? "shell"
                        : isOffsetFaceFeature(feature)
                          ? "offset"
                          : isRevolveFeature(feature)
                            ? "revolve"
                            : "extrude";
              const meta = isSketchFeature(feature)
                ? `${supportLabel(feature.support)} · ${feature.sketch.curves.length} curves`
                : isDatumPlaneFeature(feature)
                  ? datumDefinitionLabel(feature.definition)
                  : isFilletFeature(feature)
                    ? `R ${feature.radius} mm · ${feature.edges.length} edge${feature.edges.length === 1 ? "" : "s"}`
                    : isChamferFeature(feature)
                      ? `${feature.distance} mm · ${feature.edges.length} edge${feature.edges.length === 1 ? "" : "s"}`
                      : isShellFeature(feature)
                        ? `${feature.thickness} mm · ${feature.faces.length} open face${feature.faces.length === 1 ? "" : "s"}`
                        : isOffsetFaceFeature(feature)
                          ? `${Math.abs(feature.distance)} mm · ${feature.distance < 0 ? "in" : "out"} · ${feature.faces.length} face${feature.faces.length === 1 ? "" : "s"}`
                          : isRevolveFeature(feature)
                            ? `${feature.regions.length} profile${feature.regions.length === 1 ? "" : "s"} · ${feature.angle}° · ${feature.operation === "new" ? "new body" : feature.operation}`
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
                    onMouseDown={(event) => {
                      // A pointer selection should not leave keyboard focus on
                      // the step or on a control from the previous stage: Enter
                      // then belongs to the stage it opened. Keyboard users
                      // still Tab here and activate with Enter; the grip and
                      // the eye keep their own pointer behaviour.
                      const target = event.target as Element;
                      if (
                        target.closest(
                          "button, input, select, textarea, a, .step-grip",
                        )
                      ) {
                        return;
                      }
                      const active = document.activeElement as HTMLElement | null;
                      if (active && active !== document.body) active.blur();
                      event.preventDefault();
                    }}
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
                        // A focused step owns the key; never let the same Enter
                        // reach the global sketch-finish handler (F3).
                        event.stopPropagation();
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
            ) : null}
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
  kind: "line" | "circle" | "arc" | "point" | "reference" | "dimension";
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
    const dimension = sketch.constraints.find(
      (constraint) =>
        constraint.id === id &&
        (constraint.type === "distance" ||
          constraint.type === "pointLineDistance" ||
          constraint.type === "diameter" ||
          constraint.type === "angle"),
    );
    if (dimension) {
      result.push({
        id,
        kind: "dimension",
        label: constraintLabel(dimension.type),
        detail:
          "driving" in dimension && dimension.driving === false
            ? "reference dimension"
            : "driving dimension",
      });
      continue;
    }
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
    const referenceCircle = sketch.references?.circles?.find(
      (circle) => circle.id === id,
    );
    if (referenceCircle) {
      result.push({
        id,
        kind: "circle",
        label: referenceCircle.referenceLabel ?? "Projected circle",
        detail: `⌀ ${formatLength(referenceCircle.radius * 2)} mm · fixed · projected${
          referenceCircle.construction ? " · construction" : ""
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

function selectionFilterNote(value: string): string {
  return value === "all"
    ? "Everything can be picked"
    : `Only ${value} can be picked`;
}

/**
 * The contextual row under the tool line. One option is on at a time; the row
 * only exists for tools that have options (select filters today, create
 * variants later). It is shared by sketch and model mode.
 */
function ToolOptionsRow({
  kicker,
  options,
  value,
  onChange,
  note,
  testPrefix,
}: {
  kicker: string;
  options: readonly string[];
  value: string;
  onChange: (value: string) => void;
  note: string;
  testPrefix: string;
}) {
  return (
    <div className="tool-options" role="toolbar" aria-label="Tool options">
      {/* The current filter's consequence is a tooltip, not inline prose: it is
          self-evident from the enabled options and the hit feedback. */}
      <span className="tool-kicker" title={note}>
        {kicker}
      </span>
      {options.map((option) => (
        <button
          key={option}
          className={`tool-option${option === value ? " is-on" : ""}`}
          type="button"
          aria-pressed={option === value}
          onClick={() => onChange(option)}
          data-testid={`${testPrefix}-${option}`}
        >
          {option}
        </button>
      ))}
    </div>
  );
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
      // Pointer clicks should not leave focus on the toolbar (or on a timeline
      // step clicked earlier), so Enter keeps meaning "end the armed tool".
      onMouseDown={(event) => {
        event.preventDefault();
        const active = document.activeElement as HTMLElement | null;
        if (active && active !== document.body) active.blur();
      }}
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

/** Trigger a browser download without leaving a blob URL behind. */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function formatInt(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function formatVolume(value: number): string {
  return value.toFixed(1);
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

