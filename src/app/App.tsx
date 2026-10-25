import {
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { extrudeParams } from "../core/features/extrude";
import { KernelClient } from "../core/kernel/client";
import type { BodyMesh } from "../core/kernel/protocol";
import {
  addCircle,
  addPolyline,
  addRectangle,
  emptySketch,
  setCircleDiameter,
  type DraftVertex,
} from "../core/sketch/create";
import {
  addDimension,
  findDimension,
  isDrivingDimension,
  removeConstraint,
  setDimensionValue,
  type DimensionPlacement,
  type DimensionTarget,
} from "../core/sketch/dimensions";
import { clampDemoDrag, createDemoModel } from "../core/sketch/demo";
import { deleteEntities } from "../core/sketch/edit";
import {
  applySolution,
  distance,
  loopBounds,
  sketchGeometry,
  updateConstraintValue,
} from "../core/sketch/geometry";
import { profileFromSketch } from "../core/sketch/loops";
import {
  initSolver,
  isSolverReady,
  solveDrag,
  solveSketch,
  type SolveOutcome,
} from "../core/sketch/solver";
import type { Sketch, SketchCircle } from "../core/sketch/types";
import type { Vec2 } from "../core/types";
import {
  SketchCanvas,
  type SketchTool,
  type SketchTone,
} from "../sketch/SketchCanvas";
import { useHistory } from "../ui/useHistory";
import { Viewport } from "../viewer/Viewport";

type LoadState = "loading" | "ready" | "error";
type DocKind = "example" | "user" | "empty";

interface DocState {
  sketch: Sketch;
  solved: SolveOutcome | null;
  kind: DocKind;
}

const MIN_SIZE = 20;
const MAX_WIDTH = 110;
const MAX_HEIGHT = 90;

export function App() {
  const [model] = useState(() => createDemoModel());
  const history = useHistory<DocState>({
    sketch: model.sketch,
    solved: null,
    kind: "example",
  });
  const { state: doc, getState, commit, replace, undo, redo, endMerge } = history;
  const { sketch } = doc;

  const [tool, setTool] = useState<SketchTool>("select");
  const [selection, setSelection] = useState<string[]>([]);
  const [cancelToken, setCancelToken] = useState(0);
  const [fitToken, setFitToken] = useState(0);
  const [extrudeHeight, setExtrudeHeight] = useState(12);
  const [referenceDimensions, setReferenceDimensions] = useState(false);
  const [solveError, setSolveError] = useState<SolveOutcome | null>(null);
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
  const profile = useMemo(() => profileFromSketch(sketch), [sketch]);
  const params = useMemo(
    () => (profile ? extrudeParams(profile, extrudeHeight) : null),
    [profile, extrudeHeight],
  );

  const demoSize = useMemo(
    () => (doc.kind === "example" ? readDemoSize(sketch) : null),
    [doc.kind, sketch],
  );
  const widthTarget: DimensionTarget = { kind: "distance", a: "p0", b: "p1" };
  const heightTarget: DimensionTarget = { kind: "distance", a: "p1", b: "p2" };
  const widthDimension =
    doc.kind === "example" ? findDimension(sketch, widthTarget) : undefined;
  const heightDimension =
    doc.kind === "example" ? findDimension(sketch, heightTarget) : undefined;
  // Reference dimensions only measure; they must not enable the driving sliders.
  const widthDriving = isDrivingDimension(widthDimension);
  const heightDriving = isDrivingDimension(heightDimension);
  const demoConstrained = widthDriving && heightDriving;

  const firstCircle = sketch.curves.find(
    (curve): curve is SketchCircle => curve.type === "circle",
  );
  const holeDiameter = firstCircle
    ? (geometry.radii[firstCircle.id] ?? firstCircle.radius) * 2
    : null;
  const firstCircleIsOuter = Boolean(
    firstCircle && profile?.outerCircleId === firstCircle.id,
  );
  const outerBounds = profile ? loopBounds(profile.outer) : null;
  // A circle that *is* the body can grow freely; one inside a body is limited
  // by the body's smallest dimension.
  const maxHole = firstCircleIsOuter
    ? 200
    : outerBounds
      ? Math.max(4, Math.min(outerBounds.width, outerBounds.height) - 6)
      : 4;

  const selectedInfo = useMemo(
    () => describeSelection(sketch, geometry, selection),
    [sketch, geometry, selection],
  );

  const selectedSet = useMemo(() => new Set(selectedInfo.map((info) => info.id)), [selectedInfo]);

  const commitDoc = (
    nextSketch: Sketch,
    outcome: SolveOutcome | null,
    options?: { kind?: DocKind; mergeKey?: string },
  ): void => {
    const previous = getState();
    commit(
      {
        sketch: nextSketch,
        solved: outcome,
        kind: options?.kind ?? previous.kind,
      },
      options?.mergeKey,
    );
    setSolveError(null);
  };

  /** Solve, then commit both the geometry and its diagnostics. */
  const solveAndCommit = (
    next: Sketch,
    options?: { kind?: DocKind; mergeKey?: string },
  ): void => {
    if (!isSolverReady()) return;
    const outcome = solveSketch(next);
    if (!outcome.ok) {
      setSolveError(outcome);
      return;
    }
    commitDoc(applySolution(next, outcome), outcome, options);
  };

  const changeTool = (next: SketchTool): void => {
    setTool(next);
    setSelection([]);
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
    if (selectedInfo.length === 0) return;
    const current = getState();
    const next = deleteEntities(
      current.sketch,
      selectedInfo.map((info) => info.id),
    );
    if (next === current.sketch) return;
    setSelection([]);
    solveAndCommit(next, { kind: "user" });
  };

  // Key handlers are registered once but must see the current selection.
  const deleteKey = useEffectEvent(() => deleteSelection());

  useEffect(() => {
    let cancelled = false;
    initSolver()
      .then(() => {
        if (cancelled) return;
        const current = getState();
        const outcome = solveSketch(current.sketch);
        if (cancelled) return;
        replace({
          ...current,
          sketch: outcome.ok ? applySolution(current.sketch, outcome) : current.sketch,
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

    const viewport = new Viewport(canvas);
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
          setTool("select");
          setSelection([]);
          break;
        case "l":
          setTool("line");
          setSelection([]);
          break;
        case "r":
          setTool("rect");
          setSelection([]);
          break;
        case "c":
          setTool("circle");
          setSelection([]);
          break;
        case "d":
          setTool("dimension");
          setSelection([]);
          break;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo]);

  const handleDragPoint = (pointId: string, x: number, y: number): void => {
    if (!isSolverReady()) return;
    const current = getState();
    const target: Vec2 =
      current.kind === "example" ? clampDemoDrag(current.sketch, pointId, [x, y]) : [x, y];
    const outcome = solveDrag(current.sketch, {
      pointId,
      x: target[0],
      y: target[1],
    });
    if (!outcome) return;
    commitDoc(applySolution(current.sketch, outcome), outcome, {
      mergeKey: `drag:${pointId}`,
    });
  };

  const updateDemoSize = (patch: { width?: number; height?: number }): void => {
    const current = getState();
    const size = readDemoSize(current.sketch);
    if (!size) return;

    const width = clamp(patch.width ?? size.width, MIN_SIZE, MAX_WIDTH);
    const height = clamp(patch.height ?? size.height, MIN_SIZE, MAX_HEIGHT);

    let next = setDimensionValue(current.sketch, widthTarget, width);
    next = setDimensionValue(next, heightTarget, height);

    const circle = next.curves.find((curve) => curve.type === "circle");
    if (circle && circle.type === "circle") {
      const limit = Math.max(4, Math.min(width, height) - 6);
      const radius = sketchGeometry(next).radii[circle.id] ?? circle.radius;
      if (radius * 2 > limit) next = setCircleDiameter(next, circle.id, limit);
    }
    solveAndCommit(next, { mergeKey: "demo-size" });
  };

  const updateHole = (value: number): void => {
    const current = getState();
    const circle = current.sketch.curves.find((curve) => curve.type === "circle");
    if (!circle || circle.type !== "circle") return;
    solveAndCommit(
      setCircleDiameter(current.sketch, circle.id, clamp(value, 4, maxHole)),
      { mergeKey: "hole" },
    );
  };

  const toggleConstrained = (): void => {
    const current = getState();
    const size = readDemoSize(current.sketch);
    if (!size) return;
    const width = findDimension(current.sketch, widthTarget);
    const height = findDimension(current.sketch, heightTarget);
    const drivingWidth = isDrivingDimension(width);
    const drivingHeight = isDrivingDimension(height);

    let next = current.sketch;
    if (drivingWidth && drivingHeight && width && height) {
      next = removeConstraint(next, width.id);
      next = removeConstraint(next, height.id);
    } else {
      if (!drivingWidth) next = addDimension(next, widthTarget, true, { offset: 16 });
      if (!drivingHeight) next = addDimension(next, heightTarget, true, { offset: 16 });
    }
    solveAndCommit(next);
    setFitToken((token) => token + 1);
  };

  const drawingBase = (): Sketch => {
    const current = getState();
    return current.kind === "example" ? emptySketch() : current.sketch;
  };

  const drawAndCommit = (base: Sketch, next: Sketch): void => {
    if (next === base) return;
    solveAndCommit(next, { kind: "user" });
    setFitToken((token) => token + 1);
  };

  const handlePolyline = (vertices: DraftVertex[], closed: boolean): void => {
    const base = drawingBase();
    const valid = vertices.map((vertex) =>
      vertex.existingPointId && base.points.some((p) => p.id === vertex.existingPointId)
        ? vertex
        : { point: vertex.point },
    );
    drawAndCommit(base, addPolyline(base, valid, closed));
  };

  const handleRectangle = (a: Vec2, b: Vec2): void => {
    const base = drawingBase();
    drawAndCommit(base, addRectangle(base, a, b));
  };

  const handleCircle = (center: DraftVertex, radius: number): void => {
    const base = drawingBase();
    const valid = center.existingPointId
      ? { ...center, existingPointId: base.points.some((p) => p.id === center.existingPointId) ? center.existingPointId : undefined }
      : center;
    drawAndCommit(base, addCircle(base, valid, radius));
  };

  const handleCreateDimension = (
    target: DimensionTarget,
    placement: DimensionPlacement,
  ): void => {
    const current = getState();
    solveAndCommit(addDimension(current.sketch, target, !referenceDimensions, placement));
  };

  const handleChangeDimension = (id: string, value: number): void => {
    const current = getState();
    solveAndCommit(updateConstraintValue(current.sketch, id, value));
  };

  const handleDeleteDimension = (id: string): void => {
    const current = getState();
    solveAndCommit(removeConstraint(current.sketch, id));
  };

  const clearSketch = (): void => {
    const empty = emptySketch();
    const outcome = isSolverReady() ? solveSketch(empty) : null;
    commit({ sketch: empty, solved: outcome, kind: "empty" });
    setSolveError(null);
    setTool("select");
    setFitToken((token) => token + 1);
  };

  const loadExample = (): void => {
    const fresh = createDemoModel();
    const outcome = isSolverReady() ? solveSketch(fresh.sketch) : null;
    const applied = outcome?.ok ? applySolution(fresh.sketch, outcome) : fresh.sketch;
    commit({ sketch: applied, solved: outcome, kind: "example" });
    setSolveError(null);
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
  const shown = solveError ?? doc.solved;
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
      : doc.kind === "example"
      ? "Click to select, drag a corner, or draw. Drawing clears the example."
      : doc.kind === "empty"
        ? "Pick a tool and draw. Close a loop by clicking its first point."
        : "Click to select, drag a point, Delete to remove. Cmd/Ctrl+Z undoes.";

  return (
    <div className="app">
      <header className="toolbar">
        <div className="brand">
          <LogoMark />
          <span className="brand-name">cad</span>
          <span className="chip">spike</span>
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
            onChange={(event) => setExtrudeHeight(Number(event.target.value))}
            data-testid="height-slider"
            aria-label="Extrude height"
          />
          <span className="mono toolbar-value">{extrudeHeight} mm</span>
        </div>

        <div className="toolbar-spacer" />

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
      </header>

      <main className="workspace">
        <aside className="panel">
          <div className="panel-head">
            <div>
              <h2>Sketch 1</h2>
              <p>XY plane</p>
            </div>
            <div className="panel-actions">
              <IconButton label="Undo" disabled={!history.canUndo} onClick={goBack} testId="undo">
                <UndoIcon />
              </IconButton>
              <IconButton label="Redo" disabled={!history.canRedo} onClick={goForward} testId="redo">
                <RedoIcon />
              </IconButton>
            </div>
          </div>

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
              label="Dimension (D)"
              active={tool === "dimension"}
              onClick={() => changeTool("dimension")}
              testId="tool-dimension"
            >
              <DimensionIcon />
            </ToolButton>

            <span className="tool-separator" />

            <ToolButton label="Load the example" onClick={loadExample} testId="load-example">
              <ExampleIcon />
            </ToolButton>
            <ToolButton label="Clear sketch" onClick={clearSketch} testId="clear-sketch">
              <TrashIcon />
            </ToolButton>
          </div>

          <div className="sketch-frame">
            <SketchCanvas
              sketch={sketch}
              points={geometry.points}
              radii={geometry.radii}
              tone={tone}
              outer={profile?.outer}
              tool={tool}
              cancelToken={cancelToken}
              fitToken={fitToken}
              selected={selectedSet}
              onSelect={handleSelect}
              onDragPoint={handleDragPoint}
              onDragEnd={endMerge}
              onCreatePolyline={handlePolyline}
              onCreateRectangle={handleRectangle}
              onCreateCircle={handleCircle}
              onCreateDimension={handleCreateDimension}
              onChangeDimension={handleChangeDimension}
              onDeleteDimension={handleDeleteDimension}
            />
          </div>

          <div className={`dof-row ${tone}`} data-testid="dof" data-tone={tone}>
            <span className="dot" />
            <span>{statusLabel}</span>
            {shown && shown.conflicting.length > 0 ? (
              <span className="mono conflict-list">{shown.conflicting.join(", ")}</span>
            ) : null}
          </div>

          {selectedInfo.length > 0 ? (
            <SelectionPanel info={selectedInfo} onDelete={deleteSelection} />
          ) : null}

          <div className="fields">
            {tool === "dimension" ? (
              <label className="toggle-field">
                <input
                  type="checkbox"
                  checked={referenceDimensions}
                  onChange={(event) => setReferenceDimensions(event.target.checked)}
                  data-testid="reference-toggle"
                />
                <span>Reference dimension (measure only)</span>
              </label>
            ) : null}

            {doc.kind === "example" && demoSize ? (
              <>
                <div className="field-actions">
                  <button className="button button-small" type="button" onClick={toggleConstrained}>
                    {demoConstrained ? "Remove dimensions" : "Constrain size"}
                  </button>
                </div>
                <SliderField
                  label="Width"
                  value={Math.round(demoSize.width)}
                  min={MIN_SIZE}
                  max={MAX_WIDTH}
                  disabled={!widthDriving}
                  testId="width-slider"
                  onChange={(value) => updateDemoSize({ width: value })}
                  onEnd={endMerge}
                />
                <SliderField
                  label="Height"
                  value={Math.round(demoSize.height)}
                  min={MIN_SIZE}
                  max={MAX_HEIGHT}
                  disabled={!heightDriving}
                  testId="height-param-slider"
                  onChange={(value) => updateDemoSize({ height: value })}
                  onEnd={endMerge}
                />
              </>
            ) : null}

            {holeDiameter !== null ? (
              <SliderField
                label={firstCircleIsOuter ? "Circle ⌀" : "Hole ⌀"}
                value={Math.round(holeDiameter)}
                min={4}
                max={maxHole}
                testId="hole-slider"
                onChange={updateHole}
                onEnd={endMerge}
              />
            ) : null}

            <p className="hint">{hint}</p>
          </div>

          <div className="tree">
            <div className="tree-title">History</div>
            <div className="tree-row is-active">
              <SketchIcon />
              <span>Sketch 1</span>
              <span className="tree-meta">{doc.kind === "example" ? "XY" : "edited"}</span>
            </div>
            <div className="tree-row">
              <ExtrudeIcon />
              <span>Extrude 1</span>
              <span className="tree-meta">{extrudeHeight} mm</span>
            </div>
            <p className="tree-note">Static preview · history lands in M3</p>
          </div>
        </aside>

        <section className="viewport">
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
              <strong>No closed profile</strong>
              <span>Draw a closed loop in the sketch to extrude it.</span>
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
        </section>
      </main>
    </div>
  );
}

interface SelectedEntity {
  id: string;
  kind: "line" | "circle" | "point";
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
        const radius = geometry.radii[curve.id] ?? curve.radius;
        result.push({
          id,
          kind: "circle",
          label: "Circle",
          detail: `⌀ ${formatLength(radius * 2)} mm`,
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

function SelectionPanel({
  info,
  onDelete,
}: {
  info: SelectedEntity[];
  onDelete: () => void;
}) {
  return (
    <div className="selection-card" data-testid="selection-panel" data-count={info.length}>
      <div className="selection-head">
        <span className="selection-title">
          {info.length === 1 ? "Selection" : `${info.length} selected`}
        </span>
        <button
          className="button button-small"
          type="button"
          onClick={onDelete}
          data-testid="delete-selection"
        >
          Delete
        </button>
      </div>
      <div className="selection-list">
        {info.map((item) => (
          <div className="selection-item" key={item.id} data-selection-id={item.id}>
            <span>{item.label}</span>
            <span className="mono">{item.detail}</span>
          </div>
        ))}
      </div>
      <p className="selection-hint">Shift-click to add · Delete removes the selection</p>
    </div>
  );
}

function readDemoSize(sketch: Sketch): { width: number; height: number } | null {
  const points = sketchGeometry(sketch).points;
  const p0 = points.p0;
  const p1 = points.p1;
  const p2 = points.p2;
  if (!p0 || !p1 || !p2) return null;
  return { width: distance(p0, p1), height: distance(p1, p2) };
}

function SliderField({
  label,
  value,
  min,
  max,
  disabled,
  onChange,
  onEnd,
  testId,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onChange: (value: number) => void;
  onEnd?: () => void;
  testId: string;
}) {
  return (
    <label className={`field${disabled ? " is-disabled" : ""}`}>
      <span className="field-label">{label}</span>
      <span className="field-value mono">{value} mm</span>
      <input
        className="slider"
        type="range"
        min={min}
        max={max}
        step={1}
        value={clamp(value, min, max)}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        onPointerUp={onEnd}
        onKeyUp={onEnd}
        onBlur={onEnd}
        data-testid={testId}
      />
    </label>
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
