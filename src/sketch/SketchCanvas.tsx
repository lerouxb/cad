import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { ProfileLoop, Vec2 } from "../core/types";
import type { DraftVertex } from "../core/sketch/create";
import type { DimensionPlacement, DimensionTarget } from "../core/sketch/dimensions";
import type { Sketch, SketchCircle, SketchCurve, SketchLine } from "../core/sketch/types";
import { useElementSize } from "../ui/useElementSize";

export type SketchTool = "select" | "line" | "rect" | "circle" | "dimension";
export type SketchTone = "under" | "full" | "conflict";

export interface SketchCanvasProps {
  sketch: Sketch;
  points: Record<string, Vec2>;
  radii: Record<string, number>;
  tone: SketchTone;
  /** Largest closed region, used for the translucent fill. */
  outer?: ProfileLoop;
  tool: SketchTool;
  /** Bump to cancel an in-progress draft (Escape). */
  cancelToken: number;
  /** Increment to re-fit the view. */
  fitToken: number;
  /** Ids of the selected curves/points (ephemeral UI state, not the document). */
  selected: ReadonlySet<string>;
  /** Select one entity, clear the selection, or add/toggle with `additive`. */
  onSelect: (entityId: string | null, additive: boolean) => void;
  onDragPoint: (pointId: string, x: number, y: number) => void;
  onDragEnd: () => void;
  onCreatePolyline: (vertices: DraftVertex[], closed: boolean) => void;
  onCreateRectangle: (a: Vec2, b: Vec2) => void;
  onCreateCircle: (center: DraftVertex, radius: number) => void;
  onCreateDimension: (target: DimensionTarget, placement: DimensionPlacement) => void;
  onChangeDimension: (id: string, value: number) => void;
  onDeleteDimension: (id: string) => void;
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

/** Selection is deliberately not the tone colour: it must read as "picked". */
const SELECT_COLOR = "#ffd479";

const GRID_STEP = 10;
const MAJOR_EVERY = 5;
const DRAW_GRID = 5;

export function SketchCanvas({
  sketch,
  points,
  radii,
  tone,
  outer,
  tool,
  cancelToken,
  fitToken,
  selected,
  onSelect,
  onDragPoint,
  onDragEnd,
  onCreatePolyline,
  onCreateRectangle,
  onCreateCircle,
  onCreateDimension,
  onChangeDimension,
  onDeleteDimension,
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
  const [dimStart, setDimStart] = useState<string | null>(null);
  const [dimTarget, setDimTarget] = useState<DimensionTarget | null>(null);
  const [dimPlacement, setDimPlacement] = useState<DimensionPlacement | null>(null);
  const [editor, setEditor] = useState<{
    id: string;
    value: string;
    reference: boolean;
    x: number;
    y: number;
  } | null>(null);
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
    setDimStart(null);
    setDimTarget(null);
    setDimPlacement(null);
    setEditor(null);
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

  const distanceBetween = (a: Vec2, b: Vec2): number =>
    Math.hypot(b[0] - a[0], b[1] - a[1]);

  /** Signed perpendicular distance from the measured segment to the cursor. */
  const dimensionOffset = (a: Vec2, b: Vec2, cursor: Vec2): number => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length = Math.hypot(dx, dy) || 1;
    const nx = dy / length;
    const ny = -dx / length;
    const raw = (cursor[0] - (a[0] + b[0]) / 2) * nx + (cursor[1] - (a[1] + b[1]) / 2) * ny;
    const magnitude = Math.max(8, Math.abs(raw));
    return raw < 0 ? -magnitude : magnitude;
  };

  const openDimensionEditor = (
    event: ReactPointerEvent | ReactMouseEvent,
    id: string,
    value: number,
    reference: boolean,
  ) => {
    event.stopPropagation();
    event.preventDefault();
    const rect = svgRef.current?.getBoundingClientRect();
    setEditor({
      id,
      value: formatEditable(value),
      reference,
      x: event.clientX - (rect?.left ?? 0),
      y: event.clientY - (rect?.top ?? 0),
    });
  };

  const commitEditor = () => {
    if (!editor) return;
    if (!editor.reference) {
      const value = Number(editor.value);
      if (Number.isFinite(value) && value > 0) onChangeDimension(editor.id, value);
    }
    setEditor(null);
  };

  const pickDimensionPoint = (event: ReactPointerEvent, pointId: string) => {
    event.stopPropagation();
    event.preventDefault();
    if (dimTarget) return;
    if (!dimStart) {
      setDimStart(pointId);
      return;
    }
    if (dimStart === pointId) {
      setDimStart(null);
      return;
    }
    setDimTarget({ kind: "distance", a: dimStart, b: pointId });
    setDimStart(null);
  };

  const pickDimensionCurve = (event: ReactPointerEvent, curve: SketchCurve) => {
    event.stopPropagation();
    event.preventDefault();
    if (dimStart || dimTarget) return;
    if (curve.type === "line") {
      setDimTarget({ kind: "distance", a: curve.a, b: curve.b });
    } else {
      setDimTarget({ kind: "diameter", circle: curve.id });
    }
  };

  const placeDimension = (cursor: Vec2) => {
    if (!dimTarget) return;
    if (dimTarget.kind === "distance") {
      const a = points[dimTarget.a];
      const b = points[dimTarget.b];
      if (!a || !b) {
        setDimTarget(null);
        return;
      }
      onCreateDimension(dimTarget, { offset: dimensionOffset(a, b, cursor) });
    } else {
      const curve = sketch.curves.find(
        (candidate): candidate is SketchCircle =>
          candidate.id === dimTarget.circle && candidate.type === "circle",
      );
      const center = curve ? points[curve.center] : null;
      const angle = center
        ? (Math.atan2(cursor[1] - center[1], cursor[0] - center[0]) * 180) / Math.PI
        : 45;
      onCreateDimension(dimTarget, { angle });
    }
    setDimTarget(null);
    setDimPlacement(null);
  };

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

    if (tool === "dimension") {
      if (dimTarget) {
        placeDimension(raw);
      } else {
        setDimStart(null);
      }
      return;
    }
    if (tool === "select") {
      // Empty space clears the selection; modifiers keep it (and still pan).
      if (!event.shiftKey && !event.metaKey && !event.ctrlKey) {
        onSelect(null, false);
      }
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
        if (radius >= 0.5) onCreateCircle(circleCenter, roundTo(radius, 1));
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

    if (tool === "dimension") {
      if (dimTarget) {
        if (dimTarget.kind === "distance") {
          const a = points[dimTarget.a];
          const b = points[dimTarget.b];
          if (a && b) setDimPlacement({ offset: dimensionOffset(a, b, raw) });
        } else {
          const curve = sketch.curves.find(
            (candidate): candidate is SketchCircle =>
              candidate.id === dimTarget.circle && candidate.type === "circle",
          );
          const center = curve ? points[curve.center] : null;
          if (center) {
            setDimPlacement({
              angle: (Math.atan2(raw[1] - center[1], raw[0] - center[0]) * 180) / Math.PI,
            });
          }
        }
      } else if (dimStart) {
        setHover(snapPoint(raw));
      }
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

  const additiveSelection = (event: ReactPointerEvent): boolean =>
    event.shiftKey || event.metaKey || event.ctrlKey;

  const startPointDrag = (event: ReactPointerEvent, pointId: string) => {
    if (tool !== "select") return;
    event.stopPropagation();
    event.preventDefault();
    onSelect(pointId, additiveSelection(event));
    svgRef.current?.setPointerCapture(event.pointerId);
    dragRef.current = pointId;
    setDragging(pointId);
  };

  const selectCurve = (event: ReactPointerEvent, curveId: string) => {
    event.stopPropagation();
    event.preventDefault();
    onSelect(curveId, additiveSelection(event));
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
    <div className="sketch-surface">
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

      {outer?.kind === "polygon" && outer.points.length >= 3 ? (
        <polygon
          points={outer.points.map((point) => `${point[0]},${point[1]}`).join(" ")}
          fill={tone === "conflict" ? "rgba(255,123,114,0.07)" : "rgba(116,169,255,0.06)"}
          stroke="none"
        />
      ) : null}
      {outer?.kind === "circle" ? (
        <circle
          cx={outer.center[0]}
          cy={outer.center[1]}
          r={outer.radius}
          fill={tone === "conflict" ? "rgba(255,123,114,0.07)" : "rgba(116,169,255,0.06)"}
          stroke="none"
        />
      ) : null}

      {circles.map((circle) => {
        const center = points[circle.center];
        if (!center) return null;
        const isSelected = selected.has(circle.id);
        return (
          <circle
            key={circle.id}
            cx={center[0]}
            cy={center[1]}
            r={radii[circle.id] ?? circle.radius}
            fill="none"
            stroke={isSelected ? SELECT_COLOR : color}
            strokeWidth={isSelected ? 2.4 : 1.4}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}

      {sketch.curves.map((curve) => {
        if (curve.type !== "line") return null;
        const a = points[curve.a];
        const b = points[curve.b];
        if (!a || !b) return null;
        const isSelected = selected.has(curve.id);
        return (
          <line
            key={curve.id}
            x1={a[0]}
            y1={a[1]}
            x2={b[0]}
            y2={b[1]}
            stroke={isSelected ? SELECT_COLOR : curve.construction ? "#4c5b6f" : color}
            strokeWidth={isSelected ? 2.6 : 1.6}
            strokeDasharray={curve.construction ? "5 4" : undefined}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        );
      })}

      {tool === "select" || tool === "dimension" ? (
        <g>
          {sketch.curves.map((curve) => {
            if (curve.type === "line") {
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
                  stroke="transparent"
                  strokeWidth={12}
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                  pointerEvents="stroke"
                  style={{ cursor: "pointer" }}
                  data-curve-id={curve.id}
                  onPointerDown={(event) =>
                    tool === "dimension"
                      ? pickDimensionCurve(event, curve)
                      : selectCurve(event, curve.id)
                  }
                />
              );
            }
            const center = points[curve.center];
            if (!center) return null;
            return (
              <circle
                key={curve.id}
                cx={center[0]}
                cy={center[1]}
                r={radii[curve.id] ?? curve.radius}
                fill="none"
                stroke="transparent"
                strokeWidth={12}
                vectorEffect="non-scaling-stroke"
                pointerEvents="stroke"
                style={{ cursor: "pointer" }}
                data-curve-id={curve.id}
                onPointerDown={(event) =>
                  tool === "dimension"
                    ? pickDimensionCurve(event, curve)
                    : selectCurve(event, curve.id)
                }
              />
            );
          })}
        </g>
      ) : null}

      <g>
        {sketch.constraints.map((constraint) => {
          if (constraint.type === "distance") {
            const a = points[constraint.a];
            const b = points[constraint.b];
            if (!a || !b) return null;
            return (
              <LinearDimension
                key={constraint.id}
                id={constraint.id}
                a={a}
                b={b}
                offset={constraint.offset ?? 12}
                value={distanceBetween(a, b)}
                reference={constraint.driving === false}
                px={px}
                fontSize={fontSize}
                onEdit={openDimensionEditor}
              />
            );
          }
          if (constraint.type === "diameter") {
            const curve = sketch.curves.find(
              (candidate) => candidate.id === constraint.circle && candidate.type === "circle",
            );
            if (!curve || curve.type !== "circle") return null;
            const center = points[curve.center];
            if (!center) return null;
            const radius = radii[curve.id] ?? curve.radius;
            return (
              <DiameterDimension
                key={constraint.id}
                id={constraint.id}
                center={center}
                radius={radius}
                angle={constraint.angle ?? 45}
                value={radius * 2}
                reference={constraint.driving === false}
                px={px}
                fontSize={fontSize}
                onEdit={openDimensionEditor}
              />
            );
          }
          return null;
        })}
      </g>

      {tool === "dimension" && dimStart && hover && points[dimStart] ? (
        <line
          x1={points[dimStart]![0]}
          y1={points[dimStart]![1]}
          x2={hover.point[0]}
          y2={hover.point[1]}
          stroke={SELECT_COLOR}
          strokeWidth={1.2}
          strokeDasharray="5 4"
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
      ) : null}

      {tool === "dimension" && dimTarget && dimPlacement ? (
        <g opacity={0.65}>
          {dimTarget.kind === "distance" &&
          points[dimTarget.a] &&
          points[dimTarget.b] ? (
            <LinearDimension
              id="preview"
              a={points[dimTarget.a]!}
              b={points[dimTarget.b]!}
              offset={dimPlacement.offset ?? 12}
              value={distanceBetween(points[dimTarget.a]!, points[dimTarget.b]!)}
              reference={false}
              preview
              px={px}
              fontSize={fontSize}
            />
          ) : null}
          {dimTarget.kind === "diameter" &&
          (() => {
            const curve = sketch.curves.find(
              (candidate): candidate is SketchCircle =>
                candidate.id === dimTarget.circle && candidate.type === "circle",
            );
            if (!curve) return null;
            const center = points[curve.center];
            if (!center) return null;
            const radius = radii[curve.id] ?? curve.radius;
            return (
              <DiameterDimension
                id="preview"
                center={center}
                radius={radius}
                angle={dimPlacement.angle ?? 45}
                value={radius * 2}
                reference={false}
                preview
                px={px}
                fontSize={fontSize}
              />
            );
          })()}
        </g>
      ) : null}

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
        const isSelected = selected.has(point.id);
        return (
          <g key={point.id}>
            {tool === "select" || tool === "dimension" ? (
              <circle
                cx={position[0]}
                cy={position[1]}
                r={hitRadius}
                fill="transparent"
                style={{ cursor: active ? "grabbing" : "grab" }}
                data-point-id={point.id}
                onPointerDown={(event) =>
                  tool === "dimension"
                    ? pickDimensionPoint(event, point.id)
                    : startPointDrag(event, point.id)
                }
              />
            ) : null}
            <circle
              cx={position[0]}
              cy={position[1]}
              r={active ? pointRadius * 1.35 : pointRadius}
              fill={isSelected ? SELECT_COLOR : active ? color : "#101317"}
              stroke={isSelected ? SELECT_COLOR : color}
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
      {editor ? (
        <div className="dimension-editor" style={{ left: editor.x, top: editor.y }}>
          {editor.reference ? (
            <span className="mono dimension-readonly">{editor.value} mm · reference</span>
          ) : (
            <input
              autoFocus
              className="mono"
              data-testid="dimension-input"
              value={editor.value}
              inputMode="decimal"
              onChange={(event) => setEditor({ ...editor, value: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitEditor();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  setEditor(null);
                }
              }}
              onBlur={commitEditor}
            />
          )}
          <button
            className="dimension-delete"
            type="button"
            data-testid="dimension-delete"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              onDeleteDimension(editor.id);
              setEditor(null);
            }}
          >
            Delete
          </button>
        </div>
      ) : null}
    </div>
  );
}

interface DimensionHandlers {
  id: string;
  value: number;
  reference: boolean;
  preview?: boolean;
  px: number;
  fontSize: number;
  onEdit?: (
    event: ReactMouseEvent,
    id: string,
    value: number,
    reference: boolean,
  ) => void;
}

function LinearDimension({
  id,
  a,
  b,
  offset,
  value,
  reference,
  preview,
  px,
  fontSize,
  onEdit,
}: DimensionHandlers & { a: Vec2; b: Vec2; offset: number }) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.hypot(dx, dy) || 1;
  const nx = dy / length;
  const ny = -dx / length;
  const A: Vec2 = [a[0] + nx * offset, a[1] + ny * offset];
  const B: Vec2 = [b[0] + nx * offset, b[1] + ny * offset];
  const mid: Vec2 = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
  const tick = 3.5 * px;
  const color = reference ? "#7f8b9c" : "#c8b06a";
  const label = `${reference ? "(" : ""}${formatLength(value)}${reference ? ")" : ""}`;

  return (
    <g
      stroke={color}
      fill={color}
      opacity={preview ? 0.7 : 1}
      style={{ cursor: onEdit && !preview ? "text" : "default" }}
      onPointerDown={(event) => {
        if (!preview) event.stopPropagation();
      }}
      onDoubleClick={
        onEdit && !preview
          ? (event) => onEdit(event, id, value, reference)
          : undefined
      }
    >
      <line
        x1={a[0]}
        y1={a[1]}
        x2={A[0]}
        y2={A[1]}
        strokeWidth={0.8}
        opacity={0.55}
        vectorEffect="non-scaling-stroke"
      />
      <line
        x1={b[0]}
        y1={b[1]}
        x2={B[0]}
        y2={B[1]}
        strokeWidth={0.8}
        opacity={0.55}
        vectorEffect="non-scaling-stroke"
      />
      <line
        x1={A[0]}
        y1={A[1]}
        x2={B[0]}
        y2={B[1]}
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
      {[A, B].map((point, index) => (
        <line
          key={index}
          x1={point[0] - nx * tick}
          y1={point[1] - ny * tick}
          x2={point[0] + nx * tick}
          y2={point[1] + ny * tick}
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
        data-dimension-id={preview ? undefined : id}
        style={{ cursor: onEdit && !preview ? "text" : "default" }}
        onPointerDown={(event) => {
          if (preview) return;
          event.stopPropagation();
        }}
        onDoubleClick={
          onEdit && !preview
            ? (event) => onEdit(event, id, value, reference)
            : undefined
        }
      >
        {label}
      </text>
    </g>
  );
}

function DiameterDimension({
  id,
  center,
  radius,
  angle,
  value,
  reference,
  preview,
  px,
  fontSize,
  onEdit,
}: DimensionHandlers & { center: Vec2; radius: number; angle: number }) {
  const theta = (angle * Math.PI) / 180;
  const dx = Math.cos(theta);
  const dy = Math.sin(theta);
  const start: Vec2 = [center[0] + dx * radius, center[1] + dy * radius];
  const end: Vec2 = [center[0] + dx * (radius + 12), center[1] + dy * (radius + 12)];
  const textX = end[0] + dx * 1.5 * px;
  const textY = end[1] + dy * 1.5 * px + fontSize * 0.35;
  const anchor = dx < -0.3 ? "end" : dx > 0.3 ? "start" : "middle";
  const color = reference ? "#7f8b9c" : "#c8b06a";
  const label = `${reference ? "(" : ""}⌀ ${formatLength(value)}${reference ? ")" : ""}`;

  return (
    <g
      stroke={color}
      fill={color}
      opacity={preview ? 0.7 : 1}
      style={{ cursor: onEdit && !preview ? "text" : "default" }}
      onPointerDown={(event) => {
        if (!preview) event.stopPropagation();
      }}
      onDoubleClick={
        onEdit && !preview
          ? (event) => onEdit(event, id, value, reference)
          : undefined
      }
    >
      <line
        x1={start[0]}
        y1={start[1]}
        x2={end[0]}
        y2={end[1]}
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
      <text
        x={textX}
        y={textY}
        fontSize={fontSize}
        textAnchor={anchor}
        stroke="#171b21"
        strokeWidth={3 * px}
        paintOrder="stroke"
        data-dimension-id={preview ? undefined : id}
        style={{ cursor: onEdit && !preview ? "text" : "default" }}
        onPointerDown={(event) => {
          if (preview) return;
          event.stopPropagation();
        }}
        onDoubleClick={
          onEdit && !preview
            ? (event) => onEdit(event, id, value, reference)
            : undefined
        }
      >
        {label}
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
    <g fontSize={8 * px} fill="#6f7d8f" textAnchor="middle" pointerEvents="none">
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

function formatLength(value: number): string {
  return Number.isInteger(value) ? `${value}` : value.toFixed(1);
}

function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatEditable(value: number): string {
  return String(Math.round(value * 100) / 100);
}
