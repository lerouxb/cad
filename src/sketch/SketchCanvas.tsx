import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { Vec2 } from "../core/types";
import type { DraftVertex } from "../core/sketch/create";
import type { Sketch, SketchCircle, SketchLine } from "../core/sketch/types";
import { useElementSize } from "../ui/useElementSize";

export type SketchTool = "select" | "line" | "rect" | "circle";
export type SketchTone = "under" | "full" | "conflict";

export interface SketchDimensions {
  width: { from: Vec2; to: Vec2; value: number };
  height: { from: Vec2; to: Vec2; value: number };
}

export interface SketchCanvasProps {
  sketch: Sketch;
  points: Record<string, Vec2>;
  radii: Record<string, number>;
  tone: SketchTone;
  /** Largest closed loop, used for the translucent fill. */
  outerLoop?: Vec2[];
  dimensions?: SketchDimensions | null;
  tool: SketchTool;
  /** Bump to cancel an in-progress draft (Escape). */
  cancelToken: number;
  /** Increment to re-fit the view. */
  fitToken: number;
  onDragPoint: (pointId: string, x: number, y: number) => void;
  onDragEnd: () => void;
  onCreatePolyline: (vertices: DraftVertex[], closed: boolean) => void;
  onCreateRectangle: (a: Vec2, b: Vec2) => void;
  onCreateCircle: (center: DraftVertex, radius: number) => void;
}

interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Snap {
  point: Vec2;
  existingPointId?: string;
  kind: "point" | "axis" | "grid";
}

const TONE_COLOR: Record<SketchTone, string> = {
  under: "#74a9ff",
  full: "#4fd39a",
  conflict: "#ff7b72",
};

const GRID_STEP = 10;
const MAJOR_EVERY = 5;
const DRAW_GRID = 5;

export function SketchCanvas({
  sketch,
  points,
  radii,
  tone,
  outerLoop,
  dimensions,
  tool,
  cancelToken,
  fitToken,
  onDragPoint,
  onDragEnd,
  onCreatePolyline,
  onCreateRectangle,
  onCreateCircle,
}: SketchCanvasProps) {
  const [svgRef, size] = useElementSize<SVGSVGElement>();
  const [viewBox, setViewBox] = useState<ViewBox>(() => fitView(sketch, radii));
  const viewBoxRef = useRef(viewBox);
  const dragRef = useRef<string | null>(null);
  const panRef = useRef<{ clientX: number; clientY: number; box: ViewBox } | null>(null);
  const [rectStart, setRectStart] = useState<Vec2 | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftVertex[]>([]);
  const [hover, setHover] = useState<Snap | null>(null);
  const [rect, setRect] = useState<{ a: Vec2; b: Vec2 } | null>(null);
  const [circleCenter, setCircleCenter] = useState<DraftVertex | null>(null);
  const lastFitToken = useRef(fitToken);

  const scale = Math.min(size.width / viewBox.w, size.height / viewBox.h) || 1;
  const px = 1 / scale;
  const color = TONE_COLOR[tone];
  const snapTolerance = 11 * px;

  useEffect(() => {
    viewBoxRef.current = viewBox;
  }, [viewBox]);

  useEffect(() => {
    if (lastFitToken.current === fitToken) return;
    lastFitToken.current = fitToken;
    setViewBox(fitView(sketch, radii));
  }, [fitToken, sketch, radii]);

  // Any tool change or explicit cancel abandons the current draft. This is a
  // deliberate render-time reset (the React "adjust state on prop change"
  // pattern), not an effect: an effect would render the stale draft once.
  const interactionKey = `${tool}:${cancelToken}`;
  const [lastInteractionKey, setLastInteractionKey] = useState(interactionKey);
  if (lastInteractionKey !== interactionKey) {
    setLastInteractionKey(interactionKey);
    setDraft([]);
    setRect(null);
    setRectStart(null);
    setCircleCenter(null);
    setHover(null);
  }

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
      const w = clamp(box.w * factor, 5, 600);
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

  const snapPoint = (raw: Vec2, axisFrom?: Vec2): Snap => {
    let best: { snap: Snap; distance: number } | null = null;
    for (const point of sketch.points) {
      if (point.construction) continue;
      const position = points[point.id];
      if (!position) continue;
      const distance = Math.hypot(position[0] - raw[0], position[1] - raw[1]);
      if (distance <= snapTolerance && (!best || distance < best.distance)) {
        best = {
          snap: { point: position, existingPointId: point.id, kind: "point" },
          distance,
        };
      }
    }
    if (best) return best.snap;

    let x = Math.round(raw[0] / DRAW_GRID) * DRAW_GRID;
    let y = Math.round(raw[1] / DRAW_GRID) * DRAW_GRID;
    let kind: Snap["kind"] = "grid";
    if (axisFrom) {
      if (Math.abs(raw[1] - axisFrom[1]) < 9 * px) {
        y = axisFrom[1];
        kind = "axis";
      } else if (Math.abs(raw[0] - axisFrom[0]) < 9 * px) {
        x = axisFrom[0];
        kind = "axis";
      }
    }
    return { point: [x, y], kind };
  };

  const snapGrid = (raw: Vec2): Vec2 => [
    Math.round(raw[0] / DRAW_GRID) * DRAW_GRID,
    Math.round(raw[1] / DRAW_GRID) * DRAW_GRID,
  ];

  const startPan = (event: ReactPointerEvent<SVGSVGElement>) => {
    svgRef.current?.setPointerCapture(event.pointerId);
    panRef.current = { clientX: event.clientX, clientY: event.clientY, box: viewBox };
  };

  const placeLineVertex = (raw: Vec2) => {
    const last = draft[draft.length - 1];
    const snap = snapPoint(raw, last?.point);

    if (draft.length === 0) {
      setDraft([{ point: snap.point, existingPointId: snap.existingPointId }]);
      return;
    }

    const first = draft[0]!;
    const closes =
      draft.length >= 3 &&
      Math.hypot(snap.point[0] - first.point[0], snap.point[1] - first.point[1]) <
        snapTolerance;
    if (closes) {
      onCreatePolyline(draft, true);
      setDraft([]);
      return;
    }

    if (
      last &&
      Math.hypot(snap.point[0] - last.point[0], snap.point[1] - last.point[1]) < 1e-6
    ) {
      return;
    }
    setDraft([...draft, { point: snap.point, existingPointId: snap.existingPointId }]);
  };

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button === 1 || event.button === 2) {
      startPan(event);
      return;
    }
    if (event.button !== 0) return;

    const raw = toSketch(event);

    if (tool === "select") {
      startPan(event);
      return;
    }
    if (tool === "line") {
      placeLineVertex(raw);
      return;
    }
    if (tool === "rect") {
      const start = snapGrid(raw);
      setRectStart(start);
      setRect({ a: start, b: start });
      svgRef.current?.setPointerCapture(event.pointerId);
      return;
    }
    if (tool === "circle") {
      if (!circleCenter) {
        const snap = snapPoint(raw);
        setCircleCenter({ point: snap.point, existingPointId: snap.existingPointId });
      } else {
        const snap = snapPoint(raw);
        const radius = Math.hypot(
          snap.point[0] - circleCenter.point[0],
          snap.point[1] - circleCenter.point[1],
        );
        if (radius >= 0.5) onCreateCircle(circleCenter, roundTo(radius, 0.5));
        setCircleCenter(null);
      }
    }
  };

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const raw = toSketch(event);

    if (dragRef.current) {
      onDragPoint(dragRef.current, raw[0], raw[1]);
      return;
    }

    if (panRef.current) {
      const pan = panRef.current;
      const dx = (event.clientX - pan.clientX) / scale;
      const dy = (event.clientY - pan.clientY) / scale;
      setViewBox({ ...pan.box, x: pan.box.x - dx, y: pan.box.y - dy });
      return;
    }

    if (tool === "select") return;

    const axisFrom = tool === "line" ? draft[draft.length - 1]?.point : undefined;
    const snap =
      tool === "rect"
        ? { point: snapGrid(raw), kind: "grid" as const }
        : snapPoint(raw, axisFrom);
    setHover(snap);

    if (rectStart) {
      setRect({ a: rectStart, b: snap.point });
    }
  };

  const finishInteraction = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (svgRef.current?.hasPointerCapture(event.pointerId)) {
      svgRef.current.releasePointerCapture(event.pointerId);
    }

    if (rectStart) {
      const start = rectStart;
      setRectStart(null);
      const end = tool === "rect" ? snapGrid(toSketch(event)) : start;
      setRect(null);
      if (Math.abs(end[0] - start[0]) >= 1 && Math.abs(end[1] - start[1]) >= 1) {
        onCreateRectangle(start, end);
      }
    }

    if (dragRef.current) {
      dragRef.current = null;
      setDragging(null);
      onDragEnd();
    }
    panRef.current = null;
  };

  const startPointDrag = (event: ReactPointerEvent, pointId: string) => {
    if (tool !== "select") return;
    event.stopPropagation();
    event.preventDefault();
    svgRef.current?.setPointerCapture(event.pointerId);
    dragRef.current = pointId;
    setDragging(pointId);
  };

  const onDoubleClick = () => {
    if (tool === "line" && draft.length >= 2) {
      onCreatePolyline(draft, false);
      setDraft([]);
    }
  };

  const grid = useMemo(() => makeGrid(viewBox), [viewBox]);
  const circles = sketch.curves.filter(
    (curve): curve is SketchCircle => curve.type === "circle",
  );
  const pointRadius = 3.4 * px;
  const hitRadius = 11 * px;
  const fontSize = 11 * px;
  const draftPolygon = [...draft.map((vertex) => vertex.point), ...(hover ? [hover.point] : [])]
    .map((point) => `${point[0]},${point[1]}`)
    .join(" ");
  const rectGeometry = rect ? normalizeRect(rect.a, rect.b) : null;
  const circleRadius =
    circleCenter && hover
      ? Math.hypot(
          hover.point[0] - circleCenter.point[0],
          hover.point[1] - circleCenter.point[1],
        )
      : 0;

  return (
    <svg
      ref={svgRef}
      className="sketch-canvas"
      data-tool={tool}
      style={{ cursor: tool === "select" ? "default" : "crosshair" }}
      viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
      preserveAspectRatio="xMidYMid meet"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finishInteraction}
      onPointerCancel={finishInteraction}
      onPointerLeave={() => {
        if (!dragRef.current && !panRef.current) setHover(null);
      }}
      onDoubleClick={onDoubleClick}
      onContextMenu={(event) => event.preventDefault()}
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

      {outerLoop && outerLoop.length >= 3 ? (
        <polygon
          points={outerLoop.map((point) => `${point[0]},${point[1]}`).join(" ")}
          fill={tone === "conflict" ? "rgba(255,123,114,0.07)" : "rgba(116,169,255,0.06)"}
          stroke="none"
        />
      ) : null}

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

      {sketch.curves.map((curve) => {
        if (curve.type !== "line") return null;
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
            stroke={curve.construction ? "#4c5b6f" : color}
            strokeWidth={1.6}
            strokeDasharray={curve.construction ? "5 4" : undefined}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        );
      })}

      {dimensions ? (
        <>
          <Dimension
            from={dimensions.width.from}
            to={dimensions.width.to}
            offset={[0, -16]}
            value={dimensions.width.value}
            px={px}
            fontSize={fontSize}
          />
          <Dimension
            from={dimensions.height.from}
            to={dimensions.height.to}
            offset={[16, 0]}
            value={dimensions.height.value}
            px={px}
            fontSize={fontSize}
          />
        </>
      ) : null}

      {circles[0] ? <CircleLeader circle={circles[0]} points={points} radii={radii} px={px} fontSize={fontSize} /> : null}

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

      {sketch.points.map((point) => {
        if (point.fixed || point.construction) return null;
        const position = points[point.id];
        if (!position) return null;
        const active = dragging === point.id;
        return (
          <g key={point.id}>
            {tool === "select" ? (
              <circle
                cx={position[0]}
                cy={position[1]}
                r={hitRadius}
                fill="transparent"
                style={{ cursor: active ? "grabbing" : "grab" }}
                data-point-id={point.id}
                onPointerDown={(event) => startPointDrag(event, point.id)}
              />
            ) : null}
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

      {tool === "line" && draft.length > 0 ? (
        <g>
          <polyline
            points={draftPolygon}
            fill="none"
            stroke={color}
            strokeWidth={1.5}
            strokeDasharray="6 4"
            vectorEffect="non-scaling-stroke"
          />
          {draft.map((vertex, index) => (
            <circle
              key={index}
              cx={vertex.point[0]}
              cy={vertex.point[1]}
              r={pointRadius * 0.8}
              fill={color}
              pointerEvents="none"
            />
          ))}
        </g>
      ) : null}

      {tool === "rect" && rectGeometry ? (
        <rect
          x={rectGeometry.x}
          y={rectGeometry.y}
          width={rectGeometry.w}
          height={rectGeometry.h}
          fill="rgba(116,169,255,0.05)"
          stroke={color}
          strokeWidth={1.4}
          strokeDasharray="6 4"
          vectorEffect="non-scaling-stroke"
        />
      ) : null}

      {tool === "circle" && circleCenter && hover ? (
        <g>
          <circle
            cx={circleCenter.point[0]}
            cy={circleCenter.point[1]}
            r={circleRadius}
            fill="none"
            stroke={color}
            strokeWidth={1.4}
            strokeDasharray="6 4"
            vectorEffect="non-scaling-stroke"
          />
          <line
            x1={circleCenter.point[0]}
            y1={circleCenter.point[1]}
            x2={hover.point[0]}
            y2={hover.point[1]}
            stroke={color}
            strokeWidth={1}
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
        </g>
      ) : null}

      {hover && tool !== "select" ? (
        <circle
          cx={hover.point[0]}
          cy={hover.point[1]}
          r={(hover.kind === "point" ? 6 : 4) * px}
          fill={hover.kind === "point" ? "rgba(226,180,92,0.18)" : "none"}
          stroke={hover.kind === "point" ? "#e2b45c" : "#5c7699"}
          strokeWidth={1.2}
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
      ) : null}
    </svg>
  );
}

function CircleLeader({
  circle,
  points,
  radii,
  px,
  fontSize,
}: {
  circle: SketchCircle;
  points: Record<string, Vec2>;
  radii: Record<string, number>;
  px: number;
  fontSize: number;
}) {
  const center = points[circle.center];
  if (!center) return null;
  const radius = radii[circle.id] ?? circle.radius;
  const diagonal = Math.SQRT1_2;
  const start: Vec2 = [center[0] + radius * diagonal, center[1] + radius * diagonal];
  const end: Vec2 = [start[0] + 10, start[1] + 10];

  return (
    <g stroke="#c8b06a" fill="#c8b06a">
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
        ⌀ {roundTo(radius * 2, 0.1)}
      </text>
    </g>
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
      {[a, b].map((point, index) => (
        <line
          key={index}
          x1={point[0] - normal[0] * tick}
          y1={point[1] - normal[1] * tick}
          x2={point[0] + normal[0] * tick}
          y2={point[1] + normal[1] * tick}
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
        return (
          <text
            key={constraint.id}
            x={(a[0] + b[0]) / 2}
            y={(a[1] + b[1]) / 2 - 5 * px}
            stroke="#171b21"
            strokeWidth={2.5 * px}
            paintOrder="stroke"
          >
            {constraint.type === "horizontal" ? "H" : "V"}
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
  if (sketch.points.length === 0) {
    return { x: -50, y: -50, w: 100, h: 100 };
  }

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
  const pad = span * 0.45 + 10;

  return {
    x: minX - pad,
    y: minY - pad,
    w: span + pad * 2,
    h: span + pad * 2,
  };
}

function normalizeRect(a: Vec2, b: Vec2) {
  return {
    x: Math.min(a[0], b[0]),
    y: Math.min(a[1], b[1]),
    w: Math.abs(b[0] - a[0]),
    h: Math.abs(b[1] - a[1]),
  };
}

function normalize(v: Vec2): Vec2 {
  const length = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / length, v[1] / length];
}

function formatLength(value: number): string {
  return Number.isInteger(value) ? `${value}` : value.toFixed(1);
}

function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
