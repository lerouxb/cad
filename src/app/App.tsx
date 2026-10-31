import {
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createDocument } from "../core/doc/create";
import { loadDoc, saveDoc } from "../core/doc/persistence";
import {
  primaryExtrudeFeature,
  primarySketch,
  primarySketchFeature,
  updateExtrudeHeight,
  updateExtrudeRegions,
  updatePrimarySketch,
} from "../core/doc/selectors";
import type { Doc } from "../core/doc/types";
import { extrudeParams } from "../core/features/extrude";
import { KernelClient } from "../core/kernel/client";
import type { BodyMesh } from "../core/kernel/protocol";
import {
  addArc,
  addCircle,
  addFillet,
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
  type ConstraintType,
} from "../core/sketch/constraints";
import {
  addDimension,
  removeConstraint,
  setDimensionPlacement,
  type DimensionPlacement,
  type DimensionTarget,
} from "../core/sketch/dimensions";
import { clampDemoDrag, createExampleModel, isDemoSketch } from "../core/sketch/demo";
import { deleteEntities } from "../core/sketch/edit";
import {
  applySolution,
  curveRadius,
  distance,
  sketchGeometry,
  updateConstraintValue,
} from "../core/sketch/geometry";
import { regionsFromSketch } from "../core/sketch/loops";
import {
  initSolver,
  isSolverReady,
  solveDrag,
  solveDragTargets,
  solveSketch,
  type DragTarget,
  type SolveOutcome,
} from "../core/sketch/solver";
import { trimCurveAt } from "../core/sketch/trim";
import { findSketchPoint, type Sketch } from "../core/sketch/types";
import type { Vec2 } from "../core/types";
import {
  SketchCanvas,
  type DimensionMode,
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
import { Viewport } from "../viewer/Viewport";

type LoadState = "loading" | "ready" | "error";

interface EditorState {
  doc: Doc;
  /** Solver output for the active sketch. Derived, not persisted. */
  solved: SolveOutcome | null;
}

export function App() {
  const [initialEditor] = useState<EditorState>(() => {
    const saved = loadDoc();
    if (saved) return { doc: saved, solved: null };
    return {
      doc: createDocument(createExampleModel().sketch, { name: "Example" }),
      solved: null,
    };
  });
  const history = useHistory<EditorState>(initialEditor);
  const { state: editor, getState, commit, replace, undo, redo, endMerge } = history;
  const doc = editor.doc;
  const sketch = primarySketch(doc);
  const sketchFeature = primarySketchFeature(doc);
  const extrudeFeature = primaryExtrudeFeature(doc);
  const extrudeHeight = extrudeFeature?.height ?? 12;
  const storedRegionIds = extrudeFeature?.regions;

  const [themeSettings, setThemeSettings] = useState<ThemeSettings>(() => loadTheme());
  const palette = useMemo(() => sketchPalette(themeSettings), [themeSettings]);
  const [mode, setMode] = useState<"model" | "sketch">("model");
  const [tool, setTool] = useState<SketchTool>("select");
  const [dimensionMode, setDimensionMode] = useState<DimensionMode>("distance");
  const [radiusDimensions, setRadiusDimensions] = useState(false);
  const [filletRadius, setFilletRadius] = useState(5);
  const [selection, setSelection] = useState<string[]>([]);
  const [cancelToken, setCancelToken] = useState(0);
  const [fitToken, setFitToken] = useState(0);
  const [referenceDimensions, setReferenceDimensions] = useState(false);
  const [solveError, setSolveError] = useState<SolveOutcome | null>(null);
  const [trimNotice, setTrimNotice] = useState<string | null>(null);
  const [solverState, setSolverState] = useState<LoadState>("loading");
  const [solverError, setSolverError] = useState<string | null>(null);
  const [mesh, setMesh] = useState<BodyMesh | null>(null);
  const [roundTripMs, setRoundTripMs] = useState<number | null>(null);
  const [kernelState, setKernelState] = useState<LoadState>("loading");
  const [kernelError, setKernelError] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const clientRef = useRef<KernelClient | null>(null);
  const viewportRef = useRef<Viewport | null>(null);

  const geometry = useMemo(() => sketchGeometry(sketch), [sketch]);
  const regions = useMemo(() => regionsFromSketch(sketch), [sketch]);
  const validRegionIds = useMemo(
    () =>
      (storedRegionIds ?? []).filter((id) =>
        regions.some((region) => region.id === id),
      ),
    [storedRegionIds, regions],
  );
  const activeRegionIds = useMemo(
    () =>
      validRegionIds.length > 0
        ? validRegionIds
        : regions.slice(0, 1).map((region) => region.id),
    [validRegionIds, regions],
  );
  const activeRegions = useMemo(
    () => regions.filter((region) => activeRegionIds.includes(region.id)),
    [regions, activeRegionIds],
  );
  const selectedRegions = useMemo(
    () => new Set(activeRegionIds),
    [activeRegionIds],
  );
  const params = useMemo(
    () => (activeRegions.length > 0 ? extrudeParams(activeRegions, extrudeHeight) : null),
    [activeRegions, extrudeHeight],
  );

  const selectedInfo = useMemo(
    () => describeSelection(sketch, geometry, selection),
    [sketch, geometry, selection],
  );

  const selectedSet = useMemo(() => new Set(selectedInfo.map((info) => info.id)), [selectedInfo]);
  const selectedPoint = useMemo(() => {
    if (selection.length !== 1) return null;
    const id = selection[0]!;
    const point = sketch.points.find((candidate) => candidate.id === id);
    if (!point || point.fixed) return null;
    const position = geometry.points[id] ?? [point.x, point.y];
    return { id, x: position[0], y: position[1] };
  }, [selection, sketch.points, geometry.points]);
  const constraintActions = useMemo(
    () => applicableConstraints(sketch, selection),
    [sketch, selection],
  );
  const construction = useMemo(
    () => constructionState(sketch, selection),
    [sketch, selection],
  );
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

  const currentSketch = (): Sketch => primarySketch(getState().doc);

  const commitDoc = (
    nextSketch: Sketch,
    outcome: SolveOutcome | null,
    mergeKey?: string,
  ): void => {
    const current = getState();
    commit(
      { doc: updatePrimarySketch(current.doc, nextSketch), solved: outcome },
      mergeKey,
    );
    setSolveError(null);
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
    setTool(next);
    setSelection([]);
    setTrimNotice(null);
  };

  const handleExtrudeHeight = (height: number): void => {
    const current = getState();
    const next = updateExtrudeHeight(current.doc, height);
    if (next === current.doc) return;
    commit({ doc: next, solved: current.solved }, "extrude-height");
  };

  const handleSelect = (entityId: string | null, additive: boolean): void => {
    if (entityId === null) {
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
    const deletable = selectedInfo.filter((info) => info.kind !== "reference");
    if (deletable.length === 0) return;
    const current = getState();
    const next = deleteEntities(
      primarySketch(current.doc),
      deletable.map((info) => info.id),
    );
    if (next === primarySketch(current.doc)) return;
    setSelection([]);
    solveAndCommit(next);
  };

  // Key handlers are registered once but must see the current selection.
  const deleteKey = useEffectEvent(() => deleteSelection());

  useEffect(() => {
    let cancelled = false;
    initSolver()
      .then(() => {
        if (cancelled) return;
        const current = getState();
        const currentSketchValue = primarySketch(current.doc);
        const outcome = solveSketch(currentSketchValue);
        if (cancelled) return;
        replace({
          ...current,
          doc: updatePrimarySketch(
            current.doc,
            outcome.ok
              ? applySolution(currentSketchValue, outcome)
              : currentSketchValue,
          ),
          solved: outcome,
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

    const viewport = new Viewport(canvas, loadTheme().mode);
    viewportRef.current = viewport;

    const client = new KernelClient({
      onReady: () => setKernelState("ready"),
      onMesh: (nextMesh, elapsed) => {
        setMesh(nextMesh);
        setRoundTripMs(elapsed);
        setKernelState("ready");
        setKernelError(null);
        viewport.setMesh(nextMesh);
      },
      onError: (message) => {
        setKernelError(message);
        setKernelState("error");
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
    if (!params) {
      viewportRef.current?.clearMesh();
      return;
    }
    const timer = window.setTimeout(() => clientRef.current?.rebuild(params), 60);
    return () => window.clearTimeout(timer);
  }, [params]);

  useEffect(() => {
    viewportRef.current?.setActive(mode === "model");
  }, [mode]);

  useEffect(() => {
    applyTheme(themeSettings);
  }, [themeSettings]);

  useEffect(() => {
    viewportRef.current?.setTheme(themeSettings.mode);
  }, [themeSettings.mode]);

  useEffect(() => {
    if (!trimNotice) return;
    const timer = window.setTimeout(() => setTrimNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [trimNotice]);

  // The document is the source of truth; keep a local copy for reopening.
  // Debounce because a drag commits a new document on every pointer move.
  useEffect(() => {
    const timer = window.setTimeout(() => saveDoc(doc), 200);
    return () => window.clearTimeout(timer);
  }, [doc]);

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
        if (event.shiftKey) redo();
        else undo();
        setFitToken((token) => token + 1);
        return;
      }
      if (meta && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
        setFitToken((token) => token + 1);
        return;
      }
      if (event.key === "Escape") {
        setTool("select");
        setSelection([]);
        setCancelToken((token) => token + 1);
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
          setMode("sketch");
          setTool("select");
          setSelection([]);
          break;
        case "l":
          setMode("sketch");
          setTool("line");
          setSelection([]);
          break;
        case "r":
          setMode("sketch");
          setTool("rect");
          setSelection([]);
          break;
        case "c":
          setMode("sketch");
          setTool("circle");
          setSelection([]);
          break;
        case "a":
          setMode("sketch");
          setTool("arc");
          setSelection([]);
          break;
        case "d":
          setMode("sketch");
          setTool("dimension");
          setSelection([]);
          break;
        case "t":
          setMode("sketch");
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
    const current = getState();
    const outcome = solveDrag(primarySketch(current.doc), { pointId, x, y });
    if (!outcome) return;
    commitDoc(applySolution(primarySketch(current.doc), outcome), outcome, `point:${pointId}`);
  };

  const handleDragPoint = (pointId: string, x: number, y: number): void => {
    if (!isSolverReady()) return;
    const current = getState();
    const target: Vec2 =
      isDemoSketch(primarySketch(current.doc)) ? clampDemoDrag(primarySketch(current.doc), pointId, [x, y]) : [x, y];
    const outcome = solveDrag(primarySketch(current.doc), {
      pointId,
      x: target[0],
      y: target[1],
    });
    if (!outcome) return;
    commitDoc(applySolution(primarySketch(current.doc), outcome), outcome, `drag:${pointId}`);
  };

  const handleDragLine = (lineId: string, targets: DragTarget[]): void => {
    if (!isSolverReady()) return;
    const current = getState();
    const outcome = solveDragTargets(primarySketch(current.doc), targets);
    if (!outcome) return;
    commitDoc(applySolution(primarySketch(current.doc), outcome), outcome, `drag:${lineId}`);
  };

  const drawAndCommit = (base: Sketch, next: Sketch): void => {
    if (next === base) return;
    solveAndCommit(next);
    setFitToken((token) => token + 1);
  };

  const handlePolyline = (vertices: DraftVertex[], closed: boolean): void => {
    const base = currentSketch();
    const valid = vertices.map((vertex) =>
      vertex.existingPointId && findSketchPoint(base, vertex.existingPointId)
        ? vertex
        : { point: vertex.point },
    );
    drawAndCommit(base, addPolyline(base, valid, closed));
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
    const current = getState();
    const next = addFillet(
      primarySketch(current.doc),
      filletSelection.a.id,
      filletSelection.b.id,
      filletRadius,
    );
    if (next === primarySketch(current.doc)) return;
    setSelection([]);
    solveAndCommit(next);
  };

  const handleTrimCurve = (curveId: string, point: Vec2): void => {
    const current = getState();
    const result = trimCurveAt(primarySketch(current.doc), curveId, point);
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
    const current = getState();
    const doc = updateExtrudeRegions(current.doc, next);
    if (doc === current.doc) return;
    commit({ doc, solved: current.solved });
  };

  const handleSelectRegion = (regionId: string, additive: boolean): void => {
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

  const selectAllRegions = (): void => {
    setSelection([]);
    commitRegions(regions.map((region) => region.id));
  };

  const autoSelectRegion = (): void => {
    setSelection([]);
    commitRegions([]);
  };

  const handleMoveDimension = (
    id: string,
    placement: DimensionPlacement,
  ): void => {
    const current = getState();
    const next = setDimensionPlacement(primarySketch(current.doc), id, placement);
    if (next === primarySketch(current.doc)) return;
    // Moving a label does not change geometry; keep the last solution and group
    // the whole pointer gesture into one undo entry.
    commitDoc(next, current.solved, `dim:${id}`);
  };

  const handleCreateDimension = (
    target: DimensionTarget,
    placement: DimensionPlacement,
  ): void => {
    const current = getState();
    solveAndCommit(addDimension(primarySketch(current.doc), target, !referenceDimensions, placement));
  };

  const handleChangeDimension = (id: string, value: number): void => {
    const current = getState();
    solveAndCommit(updateConstraintValue(primarySketch(current.doc), id, value));
  };

  const handleDeleteDimension = (id: string): void => {
    const current = getState();
    solveAndCommit(removeConstraint(primarySketch(current.doc), id));
  };

  const handleConstraint = (type: ConstraintType): void => {
    const current = getState();
    const next = applyConstraint(primarySketch(current.doc), type, selection);
    if (next === primarySketch(current.doc)) return;
    solveAndCommit(next);
  };

  const handleConstruction = (): void => {
    const current = getState();
    const next = toggleConstruction(primarySketch(current.doc), selection);
    if (next === primarySketch(current.doc)) return;
    solveAndCommit(next);
  };

  const clearSketch = (): void => {
    const empty = emptySketch();
    const outcome = isSolverReady() ? solveSketch(empty) : null;
    const current = getState();
    commit({
      doc: updateExtrudeRegions(updatePrimarySketch(current.doc, empty), []),
      solved: outcome,
    });
    setSolveError(null);
    setSelection([]);
    setTool("select");
    setFitToken((token) => token + 1);
  };

  const loadExample = (): void => {
    const fresh = createExampleModel();
    const outcome = isSolverReady() ? solveSketch(fresh.sketch) : null;
    const applied = outcome?.ok ? applySolution(fresh.sketch, outcome) : fresh.sketch;
    const current = getState();
    commit({
      doc: updateExtrudeRegions(updatePrimarySketch(current.doc, applied), []),
      solved: outcome,
    });
    setSolveError(null);
    setSelection([]);
    setTool("select");
    setFitToken((token) => token + 1);
  };

  const goBack = (): void => {
    undo();
    setFitToken((token) => token + 1);
  };

  const goForward = (): void => {
    redo();
    setFitToken((token) => token + 1);
  };

  const shownMesh = params ? mesh : null;
  const shownRoundTrip = params ? roundTripMs : null;
  const shown = solveError ?? editor.solved;
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

  const hint =
    tool === "dimension"
      ? "Click two points, a line, or a circle, then click to place the dimension. Double-click a value to edit it."
      : regions.length > 1
        ? "Click a filled region to choose the extrude profile; Shift adds. L line · R rectangle · C circle · A arc · D dimension · T trim."
        : "Select to inspect. L line · R rectangle · C circle · A arc · D dimension · T trim · Delete removes. Cmd/Ctrl+Z undoes.";

  return (
    <div className="app">
      <header className="toolbar">
        <div className="brand">
          <LogoMark />
          <span className="brand-name">cad</span>
          <span className="chip">{doc.name}</span>
        </div>

        <div className="toolbar-group">
          <span className="toolbar-label">Extrude</span>
          <input
            className="slider"
            type="range"
            min={2}
            max={40}
            step={1}
            value={extrudeHeight}
            onChange={(event) => handleExtrudeHeight(Number(event.target.value))}
            onPointerUp={endMerge}
            onKeyUp={endMerge}
            data-testid="height-slider"
            aria-label="Extrude height"
          />
          <span className="mono toolbar-value">{extrudeHeight} mm</span>
        </div>

        <div className="toolbar-spacer" />

        <div className="toolbar-actions">
          <IconButton label="Undo" disabled={!history.canUndo} onClick={goBack} testId="undo">
            <UndoIcon />
          </IconButton>
          <IconButton label="Redo" disabled={!history.canRedo} onClick={goForward} testId="redo">
            <RedoIcon />
          </IconButton>
        </div>

        <div className="badges">
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
        </div>

        <div className="appearance-controls" data-testid="appearance-controls">
          <button
            className={`appearance-theme${themeSettings.mode === "day" ? " is-active" : ""}`}
            type="button"
            onClick={() => setThemeSettings((settings) => ({ ...settings, mode: "day" }))}
            aria-label="Day appearance"
            aria-pressed={themeSettings.mode === "day"}
            data-testid="theme-day"
          >
            <SunIcon />
          </button>
          <button
            className={`appearance-theme${themeSettings.mode === "night" ? " is-active" : ""}`}
            type="button"
            onClick={() => setThemeSettings((settings) => ({ ...settings, mode: "night" }))}
            aria-label="Night appearance"
            aria-pressed={themeSettings.mode === "night"}
            data-testid="theme-night"
          >
            <MoonIcon />
          </button>
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
      </header>

      <main className="workspace">
        <section className="stage">
          <div className={`model-layer${mode === "model" ? "" : " is-hidden"}`}>
            <canvas ref={canvasRef} className="viewport-canvas" />

            <div className="viewport-top">
              <span className="overlay-chip">
                Extrude 1<span className="overlay-sep">·</span>
                <span className="mono">{extrudeHeight} mm</span>
              </span>
              <button
                className="button button-small"
                type="button"
                onClick={() => viewportRef.current?.frameAll()}
              >
                Fit view
              </button>
            </div>

            {kernelState === "loading" ? (
              <div className="viewport-message">
                <span className="spinner" />
                Loading geometry kernel…
              </div>
            ) : null}

            {!params && kernelState !== "loading" ? (
              <div className="viewport-message subtle">
                <strong>No closed region</strong>
                <span>Draw a closed loop, or select a region in the sketch, to extrude it.</span>
              </div>
            ) : null}

            {kernelError ? (
              <div className="viewport-message error">
                <strong>Kernel error</strong>
                <span>{kernelError}</span>
              </div>
            ) : null}

            <div className="viewport-stats">
              {shownMesh ? (
                <span
                  className="mono"
                  data-testid="mesh-stats"
                  data-volume={shownMesh.stats.volume.toFixed(2)}
                >
                  {formatInt(shownMesh.stats.triangles)} tris
                  <span className="overlay-sep">·</span>
                  {shownMesh.stats.faces} faces
                  <span className="overlay-sep">·</span>
                  {formatVolume(shownMesh.stats.volume)} mm³
                  <span className="overlay-sep">·</span>
                  {shownRoundTrip === null ? "—" : `${shownRoundTrip.toFixed(0)} ms`}
                </span>
              ) : (
                <span className="mono dim">no body</span>
              )}
              <span className="overlay-sub">Z-up · millimetres</span>
            </div>
          </div>

          <div className={`sketch-layer${mode === "sketch" ? "" : " is-hidden"}`}>
            <div className="sketch-stage">
              <SketchCanvas
                sketch={sketch}
                points={geometry.points}
                radii={geometry.radii}
                tone={tone}
                palette={palette}
                regions={regions}
                selectedRegions={selectedRegions}
                onSelectRegion={handleSelectRegion}
                tool={tool}
                dimensionMode={dimensionMode}
                radiusDimensions={radiusDimensions}
                cancelToken={cancelToken}
                fitToken={fitToken}
                selected={selectedSet}
                onSelect={handleSelect}
                onDragPoint={handleDragPoint}
                onDragLine={handleDragLine}
                onDragEnd={endMerge}
                onCreatePolyline={handlePolyline}
                onCreateRectangle={handleRectangle}
                onCreateCircle={handleCircle}
                onCreateArc={handleArc}
                onTrimCurve={handleTrimCurve}
                onCreateDimension={handleCreateDimension}
                onChangeDimension={handleChangeDimension}
                onMoveDimension={handleMoveDimension}
                onDeleteDimension={handleDeleteDimension}
              />
            </div>

            <div className="sketch-topbar">
              <div className="tool-strip" role="toolbar" aria-label="Sketch tools">
                <ToolButton
                  label="Select (V)"
                  active={tool === "select"}
                  onClick={() => changeTool("select")}
                  testId="tool-select"
                >
                  <CursorIcon />
                </ToolButton>
                <ToolButton
                  label="Line (L)"
                  active={tool === "line"}
                  onClick={() => changeTool("line")}
                  testId="tool-line"
                >
                  <LineIcon />
                </ToolButton>
                <ToolButton
                  label="Rectangle (R)"
                  active={tool === "rect"}
                  onClick={() => changeTool("rect")}
                  testId="tool-rect"
                >
                  <RectIcon />
                </ToolButton>
                <ToolButton
                  label="Circle (C)"
                  active={tool === "circle"}
                  onClick={() => changeTool("circle")}
                  testId="tool-circle"
                >
                  <CircleIcon />
                </ToolButton>
                <ToolButton
                  label="Arc (A)"
                  active={tool === "arc"}
                  onClick={() => changeTool("arc")}
                  testId="tool-arc"
                >
                  <ArcIcon />
                </ToolButton>
                <ToolButton
                  label="Dimension (D)"
                  active={tool === "dimension"}
                  onClick={() => changeTool("dimension")}
                  testId="tool-dimension"
                >
                  <DimensionIcon />
                </ToolButton>
                <ToolButton
                  label="Trim (T)"
                  active={tool === "trim"}
                  onClick={() => changeTool("trim")}
                  testId="tool-trim"
                >
                  <TrimIcon />
                </ToolButton>

                <span className="tool-separator" />

                <ToolButton label="Load the example" onClick={loadExample} testId="load-example">
                  <ExampleIcon />
                </ToolButton>
                <ToolButton label="Clear sketch" onClick={clearSketch} testId="clear-sketch">
                  <TrashIcon />
                </ToolButton>
              </div>

              <button className="button button-primary" type="button" onClick={() => setMode("model")}>
                Finish sketch
              </button>
            </div>

            <div className={`dof-pill ${tone}`} data-testid="dof" data-tone={tone}>
              <span className="dot" />
              <span>{statusLabel}</span>
              {shown && shown.conflicting.length > 0 ? (
                <span className="mono conflict-list">{shown.conflicting.join(", ")}</span>
              ) : null}
            </div>

            {trimNotice ? (
              <div className="sketch-notice" data-testid="trim-notice" role="status">
                {trimNotice}
              </div>
            ) : null}

            {selectedInfo.length > 0 ? (
              <div className="selection-float">
                <SelectionPanel
                  info={selectedInfo}
                  actions={constraintActions}
                  construction={construction}
                  onConstraint={handleConstraint}
                  onConstruction={handleConstruction}
                  onDelete={deleteSelection}
                  deletable={selectedInfo.some((info) => info.kind !== "reference")}
                  pointPosition={
                    selectedPoint
                      ? {
                          id: selectedPoint.id,
                          x: selectedPoint.x,
                          y: selectedPoint.y,
                          onSet: (x, y) =>
                            handleSetPointPosition(selectedPoint.id, x, y),
                        }
                      : null
                  }
                  fillet={filletSelection ? {
                    radius: filletRadius,
                    onRadius: setFilletRadius,
                    onApply: handleFillet,
                  } : null}
                />
              </div>
            ) : null}

            {tool === "dimension" ? (
              <div className="sketch-flyout">
                <div className="toggle-field" role="group" aria-label="Dimension mode">
                  <button
                    className={`constraint-chip${dimensionMode === "distance" ? " is-active" : ""}`}
                    type="button"
                    onClick={() => setDimensionMode("distance")}
                    data-testid="dimension-distance"
                  >
                    Distance
                  </button>
                  <button
                    className={`constraint-chip${dimensionMode === "angle" ? " is-active" : ""}`}
                    type="button"
                    onClick={() => setDimensionMode("angle")}
                    data-testid="dimension-angle"
                  >
                    Angle
                  </button>
                  <button
                    className={`constraint-chip${radiusDimensions ? " is-active" : ""}`}
                    type="button"
                    onClick={() => {
                      setDimensionMode("distance");
                      setRadiusDimensions((value) => !value);
                    }}
                    data-testid="dimension-radius"
                  >
                    Radius
                  </button>
                </div>
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

            {regions.length > 1 ? (
              <div className="region-panel" data-testid="region-panel">
                <span>
                  {validRegionIds.length > 0
                    ? `${activeRegionIds.length} of ${regions.length} regions`
                    : "auto: largest region"}
                </span>
                <button
                  className="constraint-chip"
                  type="button"
                  onClick={selectAllRegions}
                  data-testid="all-regions"
                >
                  All
                </button>
                {validRegionIds.length > 0 ? (
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
        </section>

        <footer className="timeline">
          <div className="timeline-title">History</div>
          <div className="timeline-track">
            <button
              className={`timeline-item${mode === "sketch" ? " is-active" : ""}`}
              type="button"
              onClick={() => setMode("sketch")}
              data-testid="timeline-sketch"
            >
              <SketchIcon />
              <span className="timeline-index">01</span>
              <span>{sketchFeature?.name ?? "Sketch 1"}</span>
              <span className="tree-meta">XY · {sketch.curves.length} curves</span>
            </button>
            <span className="timeline-arrow" aria-hidden="true">›</span>
            <button
              className={`timeline-item${mode === "model" ? " is-active" : ""}`}
              type="button"
              onClick={() => setMode("model")}
              data-testid="timeline-extrude"
            >
              <ExtrudeIcon />
              <span className="timeline-index">02</span>
              <span>{extrudeFeature?.name ?? "Extrude 1"}</span>
              <span className="tree-meta">
                {extrudeHeight} mm · {activeRegionIds.length} region
                {activeRegionIds.length === 1 ? "" : "s"}
              </span>
            </button>
          </div>
          <div className="timeline-actions">
            <span className="timeline-note">Autosaved locally</span>
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
        label: referenceLine.id === "axis-x" ? "X axis" : "Y axis",
        detail: "Fixed reference axis",
      });
      continue;
    }
    const referencePoint = sketch.references?.points.find((point) => point.id === id);
    if (referencePoint) {
      result.push({
        id,
        kind: "reference",
        label: referencePoint.id === "origin" ? "Origin" : "Reference point",
        detail: `${formatLength(referencePoint.x)}, ${formatLength(referencePoint.y)} mm · fixed`,
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

function PointPositionEditor({
  x,
  y,
  onSet,
}: {
  x: number;
  y: number;
  onSet: (x: number, y: number) => void;
}) {
  const [xText, setXText] = useState(() => formatEditable(x));
  const [yText, setYText] = useState(() => formatEditable(y));

  const commit = (): void => {
    const nextX = Number(xText);
    const nextY = Number(yText);
    if (!Number.isFinite(nextX) || !Number.isFinite(nextY)) return;
    if (nextX !== x || nextY !== y) onSet(nextX, nextY);
  };

  return (
    <div
      className="point-position"
      data-testid="point-position"
      onBlur={(event) => {
        const next = event.relatedTarget as Node | null;
        if (!next || !event.currentTarget.contains(next)) commit();
      }}
    >
      <label>
        <span>X</span>
        <input
          value={xText}
          inputMode="decimal"
          data-testid="point-x"
          onChange={(event) => setXText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            } else if (event.key === "Escape") {
              setXText(formatEditable(x));
              setYText(formatEditable(y));
            }
          }}
        />
      </label>
      <label>
        <span>Y</span>
        <input
          value={yText}
          inputMode="decimal"
          data-testid="point-y"
          onChange={(event) => setYText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            } else if (event.key === "Escape") {
              setXText(formatEditable(x));
              setYText(formatEditable(y));
            }
          }}
        />
      </label>
      <span className="point-position-unit">mm</span>
    </div>
  );
}

function formatEditable(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

function SelectionPanel({
  info,
  actions,
  construction,
  onConstraint,
  onConstruction,
  onDelete,
  deletable,
  pointPosition,
  fillet,
}: {
  info: SelectedEntity[];
  actions: { type: ConstraintType; label: string }[];
  construction: "none" | "mixed" | "all" | null;
  onConstraint: (type: ConstraintType) => void;
  onConstruction: () => void;
  onDelete: () => void;
  deletable: boolean;
  pointPosition: {
    id: string;
    x: number;
    y: number;
    onSet: (x: number, y: number) => void;
  } | null;
  fillet: {
    radius: number;
    onRadius: (value: number) => void;
    onApply: () => void;
  } | null;
}) {
  return (
    <div className="selection-card" data-testid="selection-panel" data-count={info.length}>
      <div className="selection-head">
        <span className="selection-title">
          {info.length === 1 ? "Selection" : `${info.length} selected`}
        </span>
        {deletable ? (
          <button
            className="button button-small"
            type="button"
            onClick={onDelete}
            data-testid="delete-selection"
          >
            Delete
          </button>
        ) : null}
      </div>
      <div className="selection-list">
        {info.map((item) => (
          <div className="selection-item" key={item.id} data-selection-id={item.id}>
            <span>{item.label}</span>
            <span className="mono">{item.detail}</span>
          </div>
        ))}
      </div>
      {pointPosition ? (
        <PointPositionEditor
          key={`${pointPosition.id}:${pointPosition.x}:${pointPosition.y}`}
          {...pointPosition}
        />
      ) : null}
      {actions.length > 0 || construction !== null ? (
        <div className="constraint-bar">
          {actions.map((action) => (
            <button
              key={action.type}
              className="constraint-chip"
              type="button"
              onClick={() => onConstraint(action.type)}
              data-testid={`constraint-${action.type}`}
            >
              {action.label}
            </button>
          ))}
          {construction !== null ? (
            <button
              className="constraint-chip"
              type="button"
              onClick={onConstruction}
              data-testid="toggle-construction"
            >
              {construction === "all" ? "Make normal" : "Construction"}
            </button>
          ) : null}
          {fillet ? (
            <span className="fillet-control">
              <input
                type="number"
                min={0.5}
                step={1}
                value={fillet.radius}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (Number.isFinite(value) && value > 0) fillet.onRadius(value);
                }}
                aria-label="Fillet radius"
                data-testid="fillet-radius"
              />
              <button
                className="constraint-chip"
                type="button"
                onClick={fillet.onApply}
                data-testid="constraint-fillet"
              >
                Fillet
              </button>
            </span>
          ) : null}
        </div>
      ) : null}
      <p className="selection-hint">
        Shift-click to add · pick a constraint above · Delete removes
      </p>
    </div>
  );
}

function ToolButton({
  label,
  active,
  onClick,
  testId,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  testId: string;
  children: ReactNode;
}) {
  return (
    <button
      className={`tool-button${active ? " is-active" : ""}`}
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      data-testid={testId}
    >
      {children}
    </button>
  );
}

function IconButton({
  label,
  disabled,
  onClick,
  testId,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  testId: string;
  children: ReactNode;
}) {
  return (
    <button
      className="icon-button"
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      data-testid={testId}
    >
      {children}
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

/* ---------- icons ---------- */

function svgProps(size = 16) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
}

function LogoMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 2.6 21 7.4v9.2L12 21.4 3 16.6V7.4L12 2.6Z"
        fill="none"
        stroke="#74a9ff"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M3 7.4 12 12l9-4.6M12 12v9.4"
        fill="none"
        stroke="#74a9ff"
        strokeWidth="1.2"
        strokeLinejoin="round"
        opacity="0.7"
      />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg {...svgProps()} viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg {...svgProps()} viewBox="0 0 24 24">
      <path d="M20 15.5A8 8 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5Z" />
    </svg>
  );
}

function CursorIcon() {
  return (
    <svg {...svgProps()}>
      <path d="M5 3l6.5 17 2.4-6.6 6.6-2.4L5 3Z" />
    </svg>
  );
}

function LineIcon() {
  return (
    <svg {...svgProps()}>
      <path d="M4 19 19 5" />
      <circle cx="4" cy="19" r="1.6" fill="currentColor" />
      <circle cx="19" cy="5" r="1.6" fill="currentColor" />
      <path d="M7 19h4M4 16v3" opacity="0.5" />
    </svg>
  );
}

function RectIcon() {
  return (
    <svg {...svgProps()}>
      <rect x="4" y="6" width="16" height="12" rx="1" />
      <circle cx="4" cy="6" r="1.4" fill="currentColor" />
      <circle cx="20" cy="18" r="1.4" fill="currentColor" />
    </svg>
  );
}

function CircleIcon() {
  return (
    <svg {...svgProps()}>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" />
    </svg>
  );
}

function ArcIcon() {
  return (
    <svg {...svgProps()}>
      <path d="M4 18A10 10 0 0 1 18 4" />
      <circle cx="4" cy="18" r="1.4" fill="currentColor" />
      <circle cx="18" cy="4" r="1.4" fill="currentColor" />
    </svg>
  );
}

function TrimIcon() {
  return (
    <svg {...svgProps()} viewBox="0 0 24 24">
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M8.1 8.1 20 20M8.1 15.9 20 4" />
    </svg>
  );
}

function DimensionIcon() {
  return (
    <svg {...svgProps()}>
      <path d="M4 6v12M20 6v12" />
      <path d="M4 12h16" />
      <path d="m8 9-4 3 4 3M16 9l4 3-4 3" />
    </svg>
  );
}

function UndoIcon() {
  return (
    <svg {...svgProps(15)}>
      <path d="M9 5 4 10l5 5" />
      <path d="M4 10h9a6 6 0 0 1 0 12" transform="translate(0 -2)" />
    </svg>
  );
}

function RedoIcon() {
  return (
    <svg {...svgProps(15)}>
      <path d="m15 5 5 5-5 5" />
      <path d="M20 10h-9a6 6 0 0 0 0 12" transform="translate(0 -2)" />
    </svg>
  );
}

function ExampleIcon() {
  return (
    <svg {...svgProps()}>
      <rect x="3.5" y="5" width="17" height="14" rx="1.5" />
      <circle cx="12" cy="12" r="3.2" />
      <path d="M3.5 19 20.5 5" opacity="0.45" strokeDasharray="3 3" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg {...svgProps()}>
      <path d="M4 7h16M10 4h4M6 7l1 13h10l1-13M10 11v6M14 11v6" />
    </svg>
  );
}

function SketchIcon() {
  return (
    <svg className="tree-icon" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M4 20h16M6 16 16.5 5.5a2.1 2.1 0 0 1 3 3L9 19l-4 1 1-4Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ExtrudeIcon() {
  return (
    <svg className="tree-icon" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M4 9.5 12 5l8 4.5v7L12 21l-8-4.5v-7Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M4 9.5 12 14l8-4.5M12 14v7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        opacity="0.65"
      />
    </svg>
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

