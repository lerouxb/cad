import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Vec2 } from "../core/types";
import type { Sketch, SketchCircle, SketchLine } from "../core/sketch/types";
import { useElementSize } from "../ui/useElementSize";

export type SketchTone = "under" | "full" | "conflict";

export interface SketchCanvasProps {
  sketch: Sketch;
  /** Point ids of the outer loop, in order. */
  loop: string[];
  points: Record<string, Vec2>;
  radii: Record<string, number>;
  tone: SketchTone;
  /** Draw driving dimensions (they only exist when the sketch is constrained). */
  showDimensions: boolean;
  /** Increment to re-fit the view (after non-drag edits like a slider change). */
  fitToken: number;
  onDragPoint: (pointId: string, x: number, y: number) => void;
  onDragEnd: () => void;
}

interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const TONE_COLOR: Record<SketchTone, string> = {
  under: "#74a9ff",
  full: "#4fd39a",
  conflict: "#ff7b72",
};

const GRID_STEP = 10;
const MAJOR_EVERY = 5;

export function SketchCanvas({
  sketch,
  loop,
  points,
  radii,
  tone,
  showDimensions,
  fitToken,
  onDragPoint,
  onDragEnd,
}: SketchCanvasProps) {
  const [svgRef, size] = useElementSize<SVGSVGElement>();
  const [viewBox, setViewBox] = useState<ViewBox>(() => fitView(sketch, radii));
  const viewBoxRef = useRef(viewBox);
  const dragRef = useRef<string | null>(null);
  const panRef = useRef<{ clientX: number; clientY: number; box: ViewBox } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  useEffect(() => {
    viewBoxRef.current = viewBox;
  }, [viewBox]);

  const lastFitToken = useRef(fitToken);
  useEffect(() => {
    // Re-frame after deliberate edits (slider / constrain), never mid-drag.
    if (lastFitToken.current === fitToken) return;
    lastFitToken.current = fitToken;
    setViewBox(fitView(sketch, radii));
  }, [fitToken, sketch, radii]);
  const scale = Math.min(size.width / viewBox.w, size.height / viewBox.h) || 1;
  const px = 1 / scale; // one screen pixel in sketch millimetres
  const color = TONE_COLOR[tone];

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const matrix = svg.getScreenCTM();
      if (!matrix) return;
      const cursor = new DOMPoint(event.clientX, event.clientY).matrixTransform(
        matrix.inverse(),
      );
      const box = viewBoxRef.current;
      const factor = Math.exp(event.deltaY * 0.0015);
      const w = clamp(box.w * factor, 8, 600);
      const h = box.h * (w / box.w);
      setViewBox({
        x: cursor.x - ((cursor.x - box.x) * w) / box.w,
        y: cursor.y - ((cursor.y - box.y) * h) / box.h,
        w,
        h,
      });
    };

    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [svgRef]);

  const toSketch = (event: ReactPointerEvent): Vec2 => {
    const svg = svgRef.current;
    const matrix = svg?.getScreenCTM();
    if (!matrix) return [0, 0];
    const local = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return [local.x, local.y];
  };

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0 && event.button !== 1) return;
    svgRef.current?.setPointerCapture(event.pointerId);
    panRef.current = {
      clientX: event.clientX,
      clientY: event.clientY,
      box: viewBox,
    };
  };

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (dragRef.current) {
      const [x, y] = toSketch(event);
      onDragPoint(dragRef.current, x, y);
      return;
    }
    const pan = panRef.current;
    if (pan) {
      const dx = (event.clientX - pan.clientX) / scale;
      const dy = (event.clientY - pan.clientY) / scale;
      setViewBox({ ...pan.box, x: pan.box.x - dx, y: pan.box.y - dy });
    }
  };

  const endInteraction = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (svgRef.current?.hasPointerCapture(event.pointerId)) {
      svgRef.current.releasePointerCapture(event.pointerId);
    }
    if (dragRef.current) {
      dragRef.current = null;
      setDragging(null);
      onDragEnd();
    }
    panRef.current = null;
  };

  const startPointDrag = (event: ReactPointerEvent, pointId: string) => {
    event.stopPropagation();
    event.preventDefault();
    svgRef.current?.setPointerCapture(event.pointerId);
    dragRef.current = pointId;
    setDragging(pointId);
  };

  const grid = useMemo(() => makeGrid(viewBox), [viewBox]);
  const loopPoints = loop.map((id) => points[id]).filter((p): p is Vec2 => Boolean(p));
  const geometryPath = loopPoints.map((p) => `${p[0]},${p[1]}`).join(" ");
  const circles = sketch.curves.filter(
    (curve): curve is SketchCircle => curve.type === "circle",
  );
  const pointRadius = 3.4 * px;
  const hitRadius = 11 * px;
  const fontSize = 11 * px;

  const width =
    loopPoints.length >= 2 && loopPoints[0] && loopPoints[1]
      ? Math.hypot(loopPoints[1][0] - loopPoints[0][0], loopPoints[1][1] - loopPoints[0][1])
      : 0;
  const height =
    loopPoints.length >= 3 && loopPoints[1] && loopPoints[2]
      ? Math.hypot(loopPoints[2][0] - loopPoints[1][0], loopPoints[2][1] - loopPoints[1][1])
      : 0;

  return (
    <svg
      ref={svgRef}
      className="sketch-canvas"
      viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
      preserveAspectRatio="xMidYMid meet"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endInteraction}
      onPointerCancel={endInteraction}
      onDoubleClick={() => setViewBox(fitView(sketch, radii))}
      role="img"
      aria-label="Sketch editor"
    >
      <g strokeWidth={1}>
        {grid.map((line) => (
          <line
            key={line.key}
            x1={line.x1}
            y1={line.y1}
            x2={line.x2}
            y2={line.y2}
            stroke={line.major ? "#28313c" : "#1d242d"}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <line
          x1={viewBox.x}
          y1={0}
          x2={viewBox.x + viewBox.w}
          y2={0}
          stroke="#394453"
          vectorEffect="non-scaling-stroke"
        />
        <line
          x1={0}
          y1={viewBox.y}
          x2={0}
          y2={viewBox.y + viewBox.h}
          stroke="#394453"
          vectorEffect="non-scaling-stroke"
        />
      </g>

      {circles.map((circle) => {
        const center = points[circle.center];
        if (!center) return null;
        return (
          <circle
            key={circle.id}
            cx={center[0]}
            cy={center[1]}
            r={radii[circle.id] ?? circle.radius}
            fill="none"
            stroke={color}
            strokeWidth={1.4}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}

      <polygon
        points={geometryPath}
        fill={tone === "conflict" ? "rgba(255,123,114,0.06)" : "rgba(116,169,255,0.05)"}
        stroke={color}
        strokeWidth={1.6}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />

      {sketch.curves.map((curve) => {
        if (curve.type !== "line" || !curve.construction) return null;
        const a = points[curve.a];
        const b = points[curve.b];
        if (!a || !b) return null;
        return (
          <line
            key={curve.id}
            x1={a[0]}
            y1={a[1]}
            x2={b[0]}
            y2={b[1]}
            stroke="#4c5b6f"
            strokeWidth={1}
            strokeDasharray="5 4"
            vectorEffect="non-scaling-stroke"
          />
        );
      })}

      {showDimensions && loopPoints.length >= 4 ? (
        <>
          <Dimension
            from={loopPoints[0]!}
            to={loopPoints[1]!}
            offset={[0, -16]}
            value={width}
            px={px}
            fontSize={fontSize}
          />
          <Dimension
            from={loopPoints[1]!}
            to={loopPoints[2]!}
            offset={[16, 0]}
            value={height}
            px={px}
            fontSize={fontSize}
          />
        </>
      ) : null}

      {circles.map((circle) => {
        const center = points[circle.center];
        const radius = radii[circle.id] ?? circle.radius;
        if (!center) return null;
        const diagonal = Math.SQRT1_2;
        const start: Vec2 = [
          center[0] + radius * diagonal,
          center[1] + radius * diagonal,
        ];
        const end: Vec2 = [start[0] + 10, start[1] + 10];
        return (
          <g key={`leader-${circle.id}`} stroke="#c8b06a" fill="#c8b06a">
            <line
              x1={start[0]}
              y1={start[1]}
              x2={end[0]}
              y2={end[1]}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            <text
              x={end[0] + 1.5 * px}
              y={end[1] + 3 * px}
              fontSize={fontSize}
              stroke="#171b21"
              strokeWidth={3 * px}
              paintOrder="stroke"
            >
              ⌀ {radius * 2}
            </text>
          </g>
        );
      })}

      <ConstraintBadges sketch={sketch} points={points} px={px} />

      <g>
        <line
          x1={-5 * px}
          y1={0}
          x2={5 * px}
          y2={0}
          stroke="#7f8b9c"
          strokeWidth={1.2}
          vectorEffect="non-scaling-stroke"
        />
        <line
          x1={0}
          y1={-5 * px}
          x2={0}
          y2={5 * px}
          stroke="#7f8b9c"
          strokeWidth={1.2}
          vectorEffect="non-scaling-stroke"
        />
        <circle cx={0} cy={0} r={2.2 * px} fill="#171b21" stroke="#7f8b9c" />
      </g>

      {sketch.points
        .filter((point) => !point.fixed && loop.includes(point.id))
        .map((point) => {
          const position = points[point.id];
          if (!position) return null;
          const active = dragging === point.id;
          return (
            <g key={point.id}>
              <circle
                cx={position[0]}
                cy={position[1]}
                r={hitRadius}
                fill="transparent"
                style={{ cursor: active ? "grabbing" : "grab" }}
                data-point-id={point.id}
                onPointerDown={(event) => startPointDrag(event, point.id)}
              />
              <circle
                cx={position[0]}
                cy={position[1]}
                r={active ? pointRadius * 1.35 : pointRadius}
                fill={active ? color : "#101317"}
                stroke={color}
                strokeWidth={1.6}
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
              />
            </g>
          );
        })}
    </svg>
  );
}

function Dimension({
  from,
  to,
  offset,
  value,
  px,
  fontSize,
}: {
  from: Vec2;
  to: Vec2;
  offset: Vec2;
  value: number;
  px: number;
  fontSize: number;
}) {
  const a: Vec2 = [from[0] + offset[0], from[1] + offset[1]];
  const b: Vec2 = [to[0] + offset[0], to[1] + offset[1]];
  const mid: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const along = normalize([b[0] - a[0], b[1] - a[1]]);
  const tick = 3.5 * px;
  const normal: Vec2 = [-along[1], along[0]];

  return (
    <g stroke="#c8b06a" fill="#c8b06a">
      <line
        x1={from[0]}
        y1={from[1]}
        x2={a[0]}
        y2={a[1]}
        strokeWidth={0.8}
        opacity={0.55}
        vectorEffect="non-scaling-stroke"
      />
      <line
        x1={to[0]}
        y1={to[1]}
        x2={b[0]}
        y2={b[1]}
        strokeWidth={0.8}
        opacity={0.55}
        vectorEffect="non-scaling-stroke"
      />
      <line
        x1={a[0]}
        y1={a[1]}
        x2={b[0]}
        y2={b[1]}
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
      {[a, b].map((p, index) => (
        <line
          key={index}
          x1={p[0] - normal[0] * tick}
          y1={p[1] - normal[1] * tick}
          x2={p[0] + normal[0] * tick}
          y2={p[1] + normal[1] * tick}
          strokeWidth={1.4}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      <text
        x={mid[0]}
        y={mid[1] + fontSize * 0.35}
        fontSize={fontSize}
        textAnchor="middle"
        stroke="#171b21"
        strokeWidth={3 * px}
        paintOrder="stroke"
      >
        {formatLength(value)}
      </text>
    </g>
  );
}

function ConstraintBadges({
  sketch,
  points,
  px,
}: {
  sketch: Sketch;
  points: Record<string, Vec2>;
  px: number;
}) {
  const lines = new Map<string, SketchLine>(
    sketch.curves.flatMap((curve) =>
      curve.type === "line" ? [[curve.id, curve] as const] : [],
    ),
  );
  return (
    <g fontSize={8 * px} fill="#6f7d8f" textAnchor="middle">
      {sketch.constraints.map((constraint) => {
        if (constraint.type !== "horizontal" && constraint.type !== "vertical") return null;
        const line = lines.get(constraint.line);
        if (!line) return null;
        const a = points[line.a];
        const b = points[line.b];
        if (!a || !b) return null;
        const label = constraint.type === "horizontal" ? "H" : "V";
        return (
          <text
            key={constraint.id}
            x={(a[0] + b[0]) / 2}
            y={(a[1] + b[1]) / 2 - 5 * px}
            stroke="#171b21"
            strokeWidth={2.5 * px}
            paintOrder="stroke"
          >
            {label}
          </text>
        );
      })}
    </g>
  );
}

function makeGrid(box: ViewBox) {
  const lines: { key: string; x1: number; y1: number; x2: number; y2: number; major: boolean }[] =
    [];
  const x0 = Math.floor(box.x / GRID_STEP) * GRID_STEP;
  const x1 = box.x + box.w;
  const y0 = Math.floor(box.y / GRID_STEP) * GRID_STEP;
  const y1 = box.y + box.h;

  for (let x = x0, i = 0; x <= x1 && i < 400; x += GRID_STEP, i++) {
    const major = Math.round(x / GRID_STEP) % MAJOR_EVERY === 0;
    lines.push({ key: `x${x}`, x1: x, y1: box.y, x2: x, y2: y1, major });
  }
  for (let y = y0, i = 0; y <= y1 && i < 400; y += GRID_STEP, i++) {
    const major = Math.round(y / GRID_STEP) % MAJOR_EVERY === 0;
    lines.push({ key: `y${y}`, x1: box.x, y1: y, x2: x1, y2: y, major });
  }
  return lines;
}

function fitView(sketch: Sketch, radii: Record<string, number>): ViewBox {
  const xs = sketch.points.map((point) => point.x);
  const ys = sketch.points.map((point) => point.y);
  for (const curve of sketch.curves) {
    if (curve.type !== "circle") continue;
    const center = sketch.points.find((point) => point.id === curve.center);
    if (!center) continue;
    const radius = radii[curve.id] ?? curve.radius;
    xs.push(center.x - radius, center.x + radius);
    ys.push(center.y - radius, center.y + radius);
  }

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const span = Math.max(maxX - minX, maxY - minY, 20);
  const pad = span * 0.45;

  return {
    x: minX - pad,
    y: minY - pad,
    w: span + pad * 2,
    h: span + pad * 2,
  };
}

function normalize(v: Vec2): Vec2 {
  const length = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / length, v[1] / length];
}

function formatLength(value: number): string {
  return Number.isInteger(value) ? `${value}` : value.toFixed(1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
