import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { KernelClient } from "../core/kernel/client";
import type { BodyMesh, ExtrudeParams } from "../core/kernel/protocol";
import { extrudeParamsFromDemo } from "../core/features/extrude";
import { clampDemoDrag, createDemoModel, setSizeConstraints } from "../core/sketch/demo";
import {
  applySolution,
  distance,
  sketchGeometry,
  updateConstraintValue,
} from "../core/sketch/geometry";
import { initSolver, isSolverReady, solveDrag, solveSketch, type SolveOutcome } from "../core/sketch/solver";
import type { Sketch } from "../core/sketch/types";
import type { Vec2 } from "../core/types";
import { SketchCanvas, type SketchTone } from "../sketch/SketchCanvas";
import { Viewport } from "../viewer/Viewport";

type LoadState = "loading" | "ready" | "error";

const MIN_SIZE = 20;
const MAX_WIDTH = 110;
const MAX_HEIGHT = 90;

export function App() {
  const [model] = useState(() => createDemoModel());
  const [sketch, setSketch] = useState<Sketch>(() => model.sketch);
  const sketchRef = useRef(sketch);
  const [solved, setSolved] = useState<SolveOutcome | null>(null);
  const [solverState, setSolverState] = useState<LoadState>("loading");
  const [solverError, setSolverError] = useState<string | null>(null);
  const [constrained, setConstrained] = useState(false);
  const [fitToken, setFitToken] = useState(0);
  const [extrudeHeight, setExtrudeHeight] = useState(12);
  const [mesh, setMesh] = useState<BodyMesh | null>(null);
  const [roundTripMs, setRoundTripMs] = useState<number | null>(null);
  const [kernelState, setKernelState] = useState<LoadState>("loading");
  const [kernelError, setKernelError] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const clientRef = useRef<KernelClient | null>(null);
  const viewportRef = useRef<Viewport | null>(null);

  const geometry = useMemo(() => sketchGeometry(sketch), [sketch]);

  const loopPoints = model.loop
    .map((id) => geometry.points[id])
    .filter((point): point is Vec2 => Boolean(point));
  const width =
    loopPoints[0] && loopPoints[1] ? distance(loopPoints[0], loopPoints[1]) : 0;
  const height =
    loopPoints[1] && loopPoints[2] ? distance(loopPoints[1], loopPoints[2]) : 0;
  const holeDiameter = (geometry.radii[model.hole] ?? 0) * 2;
  const maxHole = Math.max(4, Math.min(width, height) - 6);

  /** Apply a solver result, or keep the last good geometry and surface the error. */
  const solveAndCommit = useCallback((next: Sketch): void => {
    if (!isSolverReady()) return;
    const outcome = solveSketch(next);
    if (!outcome.ok) {
      setSolved(outcome);
      return;
    }
    const applied = applySolution(next, outcome);
    sketchRef.current = applied;
    setSketch(applied);
    setSolved(outcome);
  }, []);

  useEffect(() => {
    let cancelled = false;
    initSolver()
      .then(() => {
        if (cancelled) return;
        const outcome = solveSketch(sketchRef.current);
        if (cancelled) return;
        setSolved(outcome);
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
  }, []);

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

  const params = useMemo<ExtrudeParams | null>(
    () => extrudeParamsFromDemo(model, sketch, geometry, extrudeHeight),
    [model, sketch, geometry, extrudeHeight],
  );

  useEffect(() => {
    if (!params) return;
    const timer = window.setTimeout(() => clientRef.current?.rebuild(params), 60);
    return () => window.clearTimeout(timer);
  }, [params]);

  const handleDragPoint = useCallback((pointId: string, x: number, y: number) => {
    if (!isSolverReady()) return;
    const [targetX, targetY] = clampDemoDrag(sketchRef.current, pointId, [x, y]);
    const outcome = solveDrag(sketchRef.current, { pointId, x: targetX, y: targetY });
    if (!outcome) return;
    const applied = applySolution(sketchRef.current, outcome);
    sketchRef.current = applied;
    setSketch(applied);
    setSolved(outcome);
  }, []);

  const toggleConstrained = () => {
    const next = !constrained;
    setConstrained(next);
    setFitToken((token) => token + 1);
    solveAndCommit(setSizeConstraints(sketchRef.current, next, width, height));
  };

  const updateParams = (patch: { width?: number; height?: number; hole?: number }) => {
    const nextWidth = patch.width ?? width;
    const nextHeight = patch.height ?? height;
    const nextHole = Math.min(
      patch.hole ?? holeDiameter,
      Math.max(4, Math.min(nextWidth, nextHeight) - 6),
    );

    let next = sketchRef.current;
    if (constrained) {
      next = updateConstraintValue(next, "dim-width", nextWidth);
      next = updateConstraintValue(next, "dim-height", nextHeight);
    }
    next = updateConstraintValue(next, "hole-diameter", nextHole);
    setFitToken((token) => token + 1);
    solveAndCommit(next);
  };

  const tone: SketchTone =
    solved?.status === "inconsistent"
      ? "conflict"
      : solved?.dof === 0
        ? "full"
        : "under";

  const statusLabel =
    solverState === "loading"
      ? "Loading solver…"
      : solverState === "error"
        ? "Solver failed"
        : solved?.status === "inconsistent"
          ? "Conflicting constraints"
          : solved?.status === "did-not-converge"
            ? "Did not converge"
            : solved?.dof === 0
              ? "Fully constrained"
              : `${solved?.dof ?? "?"} DOF`;

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
            <button className="button" type="button" onClick={toggleConstrained}>
              {constrained ? "Remove dimensions" : "Constrain size"}
            </button>
          </div>

          <div className="sketch-frame">
            <SketchCanvas
              sketch={sketch}
              loop={model.loop}
              points={geometry.points}
              radii={geometry.radii}
              tone={tone}
              showDimensions={constrained}
              fitToken={fitToken}
              onDragPoint={handleDragPoint}
              onDragEnd={() => undefined}
            />
          </div>

          <div className={`dof-row ${tone}`} data-testid="dof" data-tone={tone}>
            <span className="dot" />
            <span>{statusLabel}</span>
            {solved && solved.conflicting.length > 0 ? (
              <span className="mono conflict-list">{solved.conflicting.join(", ")}</span>
            ) : null}
          </div>

          <div className="fields">
            <SliderField
              label="Width"
              value={Math.round(width)}
              min={MIN_SIZE}
              max={MAX_WIDTH}
              disabled={!constrained}
              testId="width-slider"
              onChange={(value) => updateParams({ width: value })}
            />
            <SliderField
              label="Height"
              value={Math.round(height)}
              min={MIN_SIZE}
              max={MAX_HEIGHT}
              disabled={!constrained}
              testId="height-param-slider"
              onChange={(value) => updateParams({ height: value })}
            />
            <SliderField
              label="Hole ⌀"
              value={Math.round(holeDiameter)}
              min={4}
              max={maxHole}
              onChange={(value) => updateParams({ hole: value })}
              testId="hole-slider"
            />
            <p className="hint">
              {constrained
                ? "Drag a corner: the dimensions hold the shape. Change a slider to resize."
                : "Drag a corner, then add dimensions to lock the size."}
            </p>
          </div>

          <div className="tree">
            <div className="tree-title">History</div>
            <div className="tree-row is-active">
              <SketchIcon />
              <span>Sketch 1</span>
              <span className="tree-meta">XY</span>
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

          {kernelError ? (
            <div className="viewport-message error">
              <strong>Kernel error</strong>
              <span>{kernelError}</span>
            </div>
          ) : null}

          <div className="viewport-stats">
            {mesh ? (
              <span
                className="mono"
                data-testid="mesh-stats"
                data-volume={mesh.stats.volume.toFixed(2)}
              >
                {formatInt(mesh.stats.triangles)} tris
                <span className="overlay-sep">·</span>
                {mesh.stats.faces} faces
                <span className="overlay-sep">·</span>
                {formatVolume(mesh.stats.volume)} mm³
                <span className="overlay-sep">·</span>
                {roundTripMs === null ? "—" : `${roundTripMs.toFixed(0)} ms`}
              </span>
            ) : (
              <span className="mono dim">waiting for first rebuild…</span>
            )}
            <span className="overlay-sub">Z-up · millimetres</span>
          </div>
        </section>
      </main>
    </div>
  );
}

function SliderField({
  label,
  value,
  min,
  max,
  disabled,
  onChange,
  testId,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onChange: (value: number) => void;
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
        data-testid={testId}
      />
    </label>
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
      <path d="M4 9.5 12 14l8-4.5M12 14v7" fill="none" stroke="currentColor" strokeWidth="1.4" opacity="0.65" />
    </svg>
  );
}

function formatInt(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function formatVolume(value: number): string {
  return value.toFixed(1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
