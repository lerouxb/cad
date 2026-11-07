import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { formatEditable, formatLength } from "../core/format";
import type { ProfileLoop, Vec2 } from "../core/types";
import {
  regionsFullyInside,
  regionsIntersectingPolygon,
  type SketchRegion,
} from "../core/sketch/loops";
import type { SketchPalette } from "../app/theme";
import type { DraftVertex } from "../core/sketch/create";
import type { DimensionPlacement, DimensionTarget } from "../core/sketch/dimensions";
import type { DragTarget } from "../core/sketch/solver";
import type {
  Sketch,
  SketchArc,
  SketchCircle,
  SketchConstraint,
  SketchCurve,
} from "../core/sketch/types";
import {
  arcGeometry,
  arcPointAt,
  clampAngleToArc,
  circumcenter,
  curveRadius,
  loopBounds,
  normalizeAngle,
} from "../core/sketch/geometry";
import { niceGridStep, type GridStep } from "../core/sketch/grid";
import { useElementSize } from "../ui/useElementSize";

export type SketchTool =
  | "select"
  | "box"
  | "lasso"
  | "line"
  | "point"
  | "rect"
  | "circle"
  | "arc"
  | "dimension"
  | "trim";
export type DimensionMode = "distance" | "angle";
export type SketchTone = "under" | "full" | "conflict";

export interface SketchCanvasProps {
  sketch: Sketch;
  points: Record<string, Vec2>;
  radii: Record<string, number>;
  tone: SketchTone;
  palette: SketchPalette;
  /** All selectable solid regions, with holes. */
  regions: SketchRegion[];
  /** Projected body edges in sketch coordinates: [x1, y1, x2, y2]. */
  bodyReference?: ReadonlyArray<readonly [number, number, number, number]>;
  /** The regions currently used by the (single) extrude. */
  selectedRegions: ReadonlySet<string>;
  /** Profile mode gives region fills priority over points/curves. */
  profileSelection?: boolean;
  /** When false, region fills are decoration; there is no extrude owner to edit. */
  regionsSelectable?: boolean;
  onSelectRegion: (regionId: string, additive: boolean) => void;
  /** Rectangular selection: region ids fully inside the marquee. */
  onMarqueeSelectRegions: (regionIds: string[], additive: boolean) => void;
  tool: SketchTool;
  /** One filter at a time, from the tool options row. */
  selectionFilter?: "all" | "points" | "curves" | "dimensions";
  dimensionMode: DimensionMode;
  /** Measure circles as a radius instead of a diameter. */
  radiusDimensions: boolean;
  /** Bump to cancel an in-progress draft (Escape). */
  cancelToken: number;
  /** Increment to re-fit the view. */
  fitToken: number;
  /** Current grid step; "auto" adapts it to the zoom. */
  gridStep: GridStep;
  /** Whether grid/point snapping is enabled (the grid stays visible either way). */
  snapEnabled: boolean;
  /** Reports the step actually used, for the stage-foot scale readout. */
  onGridStepResolved?: (step: number) => void;
  /** Reports one grid cell in screen pixels, for the stage-foot scale bar. */
  onGridScaleResolved?: (pixels: number) => void;
  /** Current zoom relative to the fitted view (100 = fit). */
  onZoomChange?: (percent: number) => void;
  /** A new zoom preset request; `seq` makes repeated picks re-apply. */
  zoomRequest?: { seq: number; value: "fit" | number } | null;
  /** Ids of the selected curves/points (ephemeral UI state, not the document). */
  selected: ReadonlySet<string>;
  /** Select one entity, clear the selection, or add/toggle with `additive`. */
  onSelect: (entityId: string | null, additive: boolean) => void;
  /** Commit an exact point position from the inline X/Y editor. */
  onSetPointPosition?: (pointId: string, x: number, y: number) => void;
  onDragPoint: (pointId: string, x: number, y: number) => void;
  onDragLine: (lineId: string, targets: DragTarget[]) => void;
  onDragEnd: () => void;
  onCreatePolyline: (vertices: DraftVertex[], closed: boolean) => void;
  onCreateRectangle: (a: Vec2, b: Vec2) => void;
  onCreateCircle: (center: DraftVertex, radius: number) => void;
  onCreateArc: (start: DraftVertex, end: DraftVertex, through: Vec2) => void;
  onCreatePoint: (vertex: DraftVertex) => void;
  onTrimCurve: (curveId: string, point: Vec2) => void;
  onCreateDimension: (target: DimensionTarget, placement: DimensionPlacement) => void;
  /** A contextual dimension target chosen from the selection popover. */
  dimensionRequest?: { target: DimensionTarget; seq: number } | null;
  onChangeDimension: (id: string, value: number, driving: boolean) => void;
  onMoveDimension: (id: string, placement: DimensionPlacement) => void;
  onDeleteDimension: (id: string) => void;
  /** This is the visible stage; draft/Enter handling is inert otherwise. */
  stageActive?: boolean;
  /** Reports whether a draft, marquee or dimension target is in progress. */
  onGestureChange?: (active: boolean) => void;
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
  /** Existing line the point snapped onto (ordinary, axis or projected). */
  referenceLineId?: string;
  /** Every line through the snapped point (an intersection has two). */
  referenceLineIds?: string[];
  kind: "point" | "line" | "axis" | "grid" | "free";
}

/** Selection is deliberately not the tone colour: it must read as "picked". */
const MAJOR_EVERY = 5;

export function SketchCanvas({
  sketch,
  points,
  radii,
  tone,
  palette,
  regions,
  bodyReference = [],
  selectedRegions,
  profileSelection = false,
  regionsSelectable = true,
  onSelectRegion,
  onMarqueeSelectRegions,
  tool,
  selectionFilter = "all",
  dimensionMode,
  radiusDimensions,
  cancelToken,
  fitToken,
  gridStep,
  snapEnabled,
  onGridStepResolved,
  onGridScaleResolved,
  onZoomChange,
  zoomRequest,
  selected,
  onSelect,
  onSetPointPosition,
  onDragPoint,
  onDragLine,
  onDragEnd,
  onCreatePolyline,
  onCreateRectangle,
  onCreateCircle,
  onCreateArc,
  onCreatePoint,
  onTrimCurve,
  onCreateDimension,
  dimensionRequest,
  onChangeDimension,
  onMoveDimension,
  onDeleteDimension,
  stageActive = true,
  onGestureChange,
}: SketchCanvasProps) {
  const [svgRef, size] = useElementSize<SVGSVGElement>();
  const [viewBox, setViewBox] = useState<ViewBox>(() =>
    originCenteredView(sketch, radii),
  );
  const viewBoxRef = useRef(viewBox);
  const dragRef = useRef<string | null>(null);
  const lineDragRef = useRef<{
    lineId: string;
    start: Vec2;
    a: { id: string; point: Vec2 };
    b: { id: string; point: Vec2 };
    active: boolean;
  } | null>(null);
  const circleDragRef = useRef<{
    centerId: string;
    start: Vec2;
    center: Vec2;
    active: boolean;
  } | null>(null);
  const arcDragRef = useRef<{
    arcId: string;
    start: Vec2;
    points: { id: string; point: Vec2 }[];
    active: boolean;
  } | null>(null);
  const dimensionDragRef = useRef<{
    id: string;
    start: Vec2;
    constraint: SketchConstraint;
    active: boolean;
  } | null>(null);
  const panRef = useRef<{ clientX: number; clientY: number; box: ViewBox } | null>(null);
  const [rectStart, setRectStart] = useState<Vec2 | null>(null);
  const [boxStart, setBoxStart] = useState<Vec2 | null>(null);
  const [boxEnd, setBoxEnd] = useState<Vec2 | null>(null);
  const lassoRef = useRef<Vec2[]>([]);
  const [lassoPoints, setLassoPoints] = useState<Vec2[]>([]);
  const [dragging, setDragging] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftVertex[]>([]);
  /** Synchronous mirror of `draft` for key/pointer handlers. */
  const draftRef = useRef<DraftVertex[]>([]);
  const updateDraft = (next: DraftVertex[]): void => {
    draftRef.current = next;
    setDraft(next);
  };
  const [hover, setHover] = useState<Snap | null>(null);
  const [rect, setRect] = useState<{ a: Vec2; b: Vec2 } | null>(null);
  const [circleCenter, setCircleCenter] = useState<DraftVertex | null>(null);
  const [arcStart, setArcStart] = useState<DraftVertex | null>(null);
  const [arcEnd, setArcEnd] = useState<DraftVertex | null>(null);
  const [dimPoint, setDimPoint] = useState<string | null>(null);
  const [dimLine, setDimLine] = useState<string | null>(null);
  const [dimTarget, setDimTarget] = useState<DimensionTarget | null>(null);
  const activeDimTarget = dimensionRequest?.target ?? dimTarget;
  const [dimPlacement, setDimPlacement] = useState<DimensionPlacement | null>(null);
  const [editor, setEditor] = useState<{
    id: string;
    value: string;
    /**
     * The value measured when the editor opened, kept numeric: the readout and
     * the sketch label must format the same number (see core/format.ts).
     */
    measured: number;
    reference: boolean;
    asRadius?: boolean;
    x: number;
    y: number;
  } | null>(null);
  const [pointEditorScreen, setPointEditorScreen] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const lastFitToken = useRef(fitToken);
  const lastZoomSeq = useRef(0);
  /** Avoid committing twice when Enter/delete unmounts the editor. */
  const dimensionCommittedRef = useRef(false);

  const scale = Math.min(size.width / viewBox.w, size.height / viewBox.h) || 1;
  const fitted = useMemo(() => fitView(sketch, radii), [sketch, radii]);
  const px = 1 / scale;
  const pointsSelectable =
    selectionFilter === "all" || selectionFilter === "points";
  const curvesSelectable =
    selectionFilter === "all" || selectionFilter === "curves";
  const dimensionsSelectable =
    selectionFilter === "all" || selectionFilter === "dimensions";
  // Region fills are profile selection, not geometry selection; a filter turns
  // them into decoration so a click cannot start an extrude draft by accident.
  const regionsSelectableNow =
    regionsSelectable && selectionFilter === "all";
  const color = palette[tone];
  // Selection and hover use the highlighter, like the model view and the
  // studies: a wide marker wash for selected geometry, a 5 px marker stroke
  // for the entity under the cursor.
  const hoveredCurveId =
    tool === "select" && (hover?.kind === "line" || hover?.kind === "axis")
      ? (hover.referenceLineId ?? null)
      : null;
  const hoveredPointId =
    tool === "select" && hover?.kind === "point"
      ? (hover.existingPointId ?? null)
      : null;
  const snapTolerance = 11 * px;
  // The initial origin-centred view is wider than the geometry fit. Keep the
  // grid/snap step tied to the fitted sketch scale so opening a sketch does not
  // silently coarsen the grid; zooming in still refines it.
  const fitScale =
    Math.min(size.width / fitted.w, size.height / fitted.h) || 1;
  const gridScale = Math.max(scale, fitScale);
  const effectiveGridStep =
    gridStep === "auto" ? niceGridStep(gridScale) : gridStep;

  useEffect(() => {
    viewBoxRef.current = viewBox;
  }, [viewBox]);

  useEffect(() => {
    onGridStepResolved?.(effectiveGridStep);
    onGridScaleResolved?.(effectiveGridStep * scale);
  }, [effectiveGridStep, scale, onGridStepResolved, onGridScaleResolved]);

  useEffect(() => {
    const percent =
      viewBox.w > 1e-9 ? Math.round((fitted.w / viewBox.w) * 100) : 100;
    onZoomChange?.(percent);
  }, [fitted.w, viewBox.w, onZoomChange]);

  useEffect(() => {
    if (lastFitToken.current === fitToken) return;
    lastFitToken.current = fitToken;
    setViewBox(fitView(sketch, radii));
  }, [fitToken, sketch, radii]);

  // 100% is the current fit scale; 50/200 zoom around the centre of the fitted
  // view. A repeated pick increments `seq` so it still re-applies.
  useEffect(() => {
    if (!zoomRequest || zoomRequest.seq === lastZoomSeq.current) return;
    lastZoomSeq.current = zoomRequest.seq;
    const base = fitted;
    if (zoomRequest.value === "fit") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setViewBox(base);
      return;
    }
    const factor = 100 / zoomRequest.value;
    const cx = base.x + base.w / 2;
    const cy = base.y + base.h / 2;
    const w = base.w * factor;
    const h = base.h * factor;
    setViewBox({ x: cx - w / 2, y: cy - h / 2, w, h });
  }, [zoomRequest, fitted]);

  // Any tool change or explicit cancel abandons the current draft. This is a
  // deliberate render-time reset (the React "adjust state on prop change"
  // pattern), not an effect: an effect would render the stale draft once.
  const interactionKey = `${tool}:${cancelToken}`;
  const [lastInteractionKey, setLastInteractionKey] = useState(interactionKey);
  if (lastInteractionKey !== interactionKey) {
    setLastInteractionKey(interactionKey);
    setDraft([]);
    setLassoPoints([]);
    setBoxStart(null);
    setBoxEnd(null);
    setRect(null);
    setRectStart(null);
    setCircleCenter(null);
    setArcStart(null);
    setArcEnd(null);
    setHover(null);
    setDimPoint(null);
    setDimLine(null);
    setDimTarget(null);
    setDimPlacement(null);
    setEditor(null);
  }

  useEffect(() => {
    draftRef.current = [];
    lassoRef.current = [];
    lineDragRef.current = null;
    circleDragRef.current = null;
    arcDragRef.current = null;
    dimensionDragRef.current = null;
  }, [interactionKey]);

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
      // Trackpad pinch arrives as ctrl+wheel with small pixel deltas. Mouse
      // wheels send much larger deltas, so clamp the pinch case instead of
      // making one notch jump several zoom levels.
      const modeScale =
        event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1;
      const rawDelta = event.deltaY * modeScale;
      const delta = event.ctrlKey
        ? Math.max(-30, Math.min(30, rawDelta))
        : rawDelta;
      const factor = Math.exp(delta * (event.ctrlKey ? 0.006 : 0.0015));
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

  // Enter belongs to the global precedence table (MODES.md R2): this listener
  // only commits a line draft that already has two points. It must not finish
  // the sketch, and it is inert while the sketch stage is hidden. App's global
  // handler sees preventDefault() and does nothing for the same press.
  useEffect(() => {
    const onEnter = (event: KeyboardEvent) => {
      if (!stageActive || event.key !== "Enter" || event.defaultPrevented) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.tagName === "BUTTON" ||
          target.isContentEditable)
      ) {
        return;
      }
      const current = draftRef.current;
      if (current.length < 2) return;
      event.preventDefault();
      onCreatePolyline(current, false);
      draftRef.current = [];
      setDraft([]);
      setHover(null);
    };
    window.addEventListener("keydown", onEnter);
    return () => window.removeEventListener("keydown", onEnter);
  }, [onCreatePolyline, stageActive]);

  // Whether a gesture owns the canvas right now. Escape pops the gesture before
  // the armed tool (MODES R1), so the parent needs to know without a second
  // key listener here.
  const gestureActive =
    draft.length > 0 ||
    rectStart !== null ||
    boxStart !== null ||
    lassoPoints.length > 0 ||
    circleCenter !== null ||
    arcStart !== null ||
    arcEnd !== null ||
    dimPoint !== null ||
    dimLine !== null ||
    dimTarget !== null ||
    activeDimTarget !== null;
  useEffect(() => {
    onGestureChange?.(gestureActive);
  }, [gestureActive, onGestureChange]);

  const toSketch = (event: ReactPointerEvent): Vec2 => {
    const svg = svgRef.current;
    const matrix = svg?.getScreenCTM();
    if (!matrix) return [0, 0];
    const local = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return [local.x, local.y];
  };

  const snapPoint = (raw: Vec2, axisFrom?: Vec2): Snap => {
    let best: { snap: Snap; distance: number } | null = null;
    if (snapEnabled) {
      const snapCandidates = sketch.references
        ? [
            ...sketch.points,
            ...sketch.references.points.filter(
              (point) =>
                point.id === sketch.references!.origin.id ||
                point.projectionId !== undefined,
            ),
          ]
        : sketch.points;
      for (const point of snapCandidates) {
        // Construction centres are not snap targets; projected points are.
        if (point.construction && !point.projectionId) continue;
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

      const snapLines = [
        ...sketch.curves,
        ...(sketch.references?.lines ?? []),
      ].filter((curve): curve is Extract<typeof curve, { type: "line" }> =>
        curve.type === "line",
      );

      // A crossing is a point target: snap to the real intersection and attach
      // the new vertex to both lines, not just the visually closer one.
      let bestCrossing: { snap: Snap; distance: number } | null = null;
      for (let i = 0; i < snapLines.length; i += 1) {
        const first = snapLines[i]!;
        const a = points[first.a];
        const b = points[first.b];
        if (!a || !b) continue;
        for (let j = i + 1; j < snapLines.length; j += 1) {
          const second = snapLines[j]!;
          const c = points[second.a];
          const d = points[second.b];
          if (!c || !d) continue;
          const crossing = lineIntersection(a, b, c, d);
          if (!crossing) continue;
          const onFirst = projectPointOnSegment(a, b, crossing);
          const onSecond = projectPointOnSegment(c, d, crossing);
          if (
            Math.hypot(crossing[0] - onFirst[0], crossing[1] - onFirst[1]) >
              1e-6 ||
            Math.hypot(crossing[0] - onSecond[0], crossing[1] - onSecond[1]) >
              1e-6
          ) {
            continue;
          }
          const distance = Math.hypot(crossing[0] - raw[0], crossing[1] - raw[1]);
          if (
            distance <= snapTolerance &&
            (!bestCrossing || distance < bestCrossing.distance)
          ) {
            bestCrossing = {
              snap: {
                point: crossing,
                kind: "point",
                referenceLineIds: [first.id, second.id],
                referenceLineId: first.id,
              },
              distance,
            };
          }
        }
      }
      if (bestCrossing) return bestCrossing.snap;

      // Every existing line is a snap target: ordinary sketch edges, the fixed
      // X/Y axes and projected face boundaries. Snapping a new vertex to one
      // also adds a point-on-line constraint (see addPolyline), so the drawn
      // geometry stays attached when the line or source body changes.
      let bestLine: { snap: Snap; distance: number } | null = null;
      for (const line of snapLines) {
        const a = points[line.a];
        const b = points[line.b];
        if (!a || !b) continue;
        const projected = projectPointOnSegment(a, b, raw);
        const distance = Math.hypot(projected[0] - raw[0], projected[1] - raw[1]);
        if (
          distance <= snapTolerance &&
          (!bestLine || distance < bestLine.distance)
        ) {
          bestLine = {
            snap: {
              point: projected,
              referenceLineId: line.id,
              referenceLineIds: [line.id],
              kind: "line",
            },
            distance,
          };
        }
      }
      if (bestLine) return bestLine.snap;
    }

    let x = snapEnabled
      ? Math.round(raw[0] / effectiveGridStep) * effectiveGridStep
      : raw[0];
    let y = snapEnabled
      ? Math.round(raw[1] / effectiveGridStep) * effectiveGridStep
      : raw[1];
    let kind: Snap["kind"] = snapEnabled ? "grid" : "free";
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

  const snapGrid = (raw: Vec2): Vec2 =>
    snapEnabled
      ? [
          Math.round(raw[0] / effectiveGridStep) * effectiveGridStep,
          Math.round(raw[1] / effectiveGridStep) * effectiveGridStep,
        ]
      : raw;

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
    asRadius = false,
    anchor?: Vec2,
  ) => {
    event.stopPropagation();
    event.preventDefault();
    const svg = svgRef.current;
    const rect = svg?.getBoundingClientRect();
    const matrix = svg?.getScreenCTM();
    let x = event.clientX - (rect?.left ?? 0);
    let y = event.clientY - (rect?.top ?? 0);
    if (anchor && matrix && rect) {
      const screen = new DOMPoint(anchor[0], anchor[1]).matrixTransform(matrix);
      x = screen.x - rect.left;
      y = screen.y - rect.top;
    }
    const measured = asRadius ? value / 2 : value;
    dimensionCommittedRef.current = false;
    setEditor({
      id,
      value: formatEditable(measured),
      measured,
      reference,
      asRadius,
      x,
      y,
    });
  };

  const commitEditor = useCallback(() => {
    if (!editor || dimensionCommittedRef.current) return;
    dimensionCommittedRef.current = true;
    const value = Number(editor.value);
    // A reference dimension measures geometry; only driving dimensions commit
    // the typed value. The kind always commits, including on blur — there is no
    // apply button, so losing focus is the commit gesture.
    if (!editor.reference && Number.isFinite(value) && value > 0) {
      onChangeDimension(editor.id, editor.asRadius ? value * 2 : value, true);
    } else if (editor.reference) {
      onChangeDimension(editor.id, editor.measured, false);
    }
    setEditor(null);
  }, [editor, onChangeDimension, setEditor]);

  const handleEditorBlur = (
    event: ReactFocusEvent<HTMLDivElement>,
  ): void => {
    const next = event.relatedTarget as Node | null;
    if (!next || !event.currentTarget.contains(next)) {
      commitEditor();
    }
  };

  // An outside click cancels an inline editor (MODES D4), matching Escape.
  // The canvas calls preventDefault on its own pointerdown, which can keep focus
  // in the field, so a capture-phase pointerdown is the reliable exit.
  useEffect(() => {
    if (!editor) return;
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Element | null;
      if (target?.closest(".dim-editor")) return;
      dimensionCommittedRef.current = true;
      setEditor(null);
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, [editor, setEditor]);

  useEffect(() => {
    if (!editor) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Enter" && event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Enter") {
        commitEditor();
      } else {
        dimensionCommittedRef.current = true;
        setEditor(null);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [editor, commitEditor]);

  const circleLike = (
    id: string,
  ): {
    center: Vec2;
    radius: number;
    startAngle?: number;
    sweep?: number;
  } | null => {
    const curve = sketch.curves.find((candidate) => candidate.id === id);
    if (!curve) return null;
    if (curve.type === "circle") {
      const center = points[curve.center];
      return center ? { center, radius: radii[curve.id] ?? curve.radius } : null;
    }
    if (curve.type === "arc") {
      const geometry = arcGeometry(curve, points);
      return geometry
        ? {
            center: geometry.center,
            radius: geometry.radius,
            startAngle: geometry.startAngle,
            sweep: geometry.sweep,
          }
        : null;
    }
    return null;
  };

  /** Radial direction for a diameter/radius leader, clamped to an arc. */
  const circleAngle = (
    circle: { center: Vec2; startAngle?: number; sweep?: number },
    cursor: Vec2,
  ): number => {
    const raw = Math.atan2(cursor[1] - circle.center[1], cursor[0] - circle.center[0]);
    const clamped =
      circle.startAngle !== undefined && circle.sweep !== undefined
        ? clampAngleToArc(raw, circle.startAngle, circle.sweep)
        : raw;
    return (clamped * 180) / Math.PI;
  };

  const pickDimensionPoint = (event: ReactPointerEvent, pointId: string) => {
    event.stopPropagation();
    event.preventDefault();
    if (dimTarget) {
      placeDimension(toSketch(event));
      return;
    }
    if (dimensionMode !== "distance") return;
    if (!dimPoint) {
      setDimPoint(pointId);
      return;
    }
    if (dimPoint === pointId) {
      setDimPoint(null);
      return;
    }
    setDimTarget({ kind: "distance", a: dimPoint, b: pointId });
    setDimPoint(null);
  };

  const pickDimensionCurve = (event: ReactPointerEvent, curve: SketchCurve) => {
    event.stopPropagation();
    event.preventDefault();
    if (dimTarget) {
      placeDimension(toSketch(event));
      return;
    }

    if (dimensionMode === "angle") {
      if (curve.type !== "line") return;
      if (!dimLine) {
        setDimLine(curve.id);
        return;
      }
      if (dimLine === curve.id) {
        setDimLine(null);
        return;
      }
      setDimTarget({ kind: "angle", a: dimLine, b: curve.id });
      setDimLine(null);
      return;
    }

    if (dimPoint) {
      if (curve.type !== "line") return;
      setDimTarget({ kind: "pointLineDistance", point: dimPoint, line: curve.id });
      setDimPoint(null);
      return;
    }

    if (curve.type === "line") {
      setDimTarget({ kind: "distance", a: curve.a, b: curve.b });
    } else {
      setDimTarget({
        kind: radiusDimensions ? "radius" : "diameter",
        circle: curve.id,
      });
    }
  };

  const lineThrough = (id: string): { a: Vec2; b: Vec2 } | null => {
    const curve =
      sketch.curves.find((candidate) => candidate.id === id) ??
      sketch.references?.lines.find((candidate) => candidate.id === id);
    if (curve?.type !== "line") return null;
    const a = points[curve.a];
    const b = points[curve.b];
    return a && b ? { a, b } : null;
  };

  const placeDimension = (cursor: Vec2) => {
    const target = activeDimTarget;
    if (!target) return;
    if (target.kind === "distance") {
      const a = points[target.a];
      const b = points[target.b];
      if (!a || !b) {
        setDimTarget(null);
        return;
      }
      onCreateDimension(target, { offset: dimensionOffset(a, b, cursor) });
    } else if (target.kind === "pointLineDistance") {
      const point = points[target.point];
      const line = lineThrough(target.line);
      if (!point || !line) {
        setDimTarget(null);
        return;
      }
      const projection = projectPointOnLine(line.a, line.b, point);
      onCreateDimension(target, {
        offset: dimensionOffset(point, projection, cursor),
      });
    } else if (target.kind === "angle") {
      const a = lineThrough(target.a);
      const b = lineThrough(target.b);
      if (!a || !b) {
        setDimTarget(null);
        return;
      }
      const vertex = lineIntersection(a.a, a.b, b.a, b.b);
      const offset = vertex
        ? Math.max(8, Math.hypot(cursor[0] - vertex[0], cursor[1] - vertex[1]))
        : 30;
      onCreateDimension(target, { offset });
    } else {
      const circle = circleLike(target.circle);
      const angle = circle
        ? (Math.atan2(cursor[1] - circle.center[1], cursor[0] - circle.center[0]) *
            180) /
          Math.PI
        : 45;
      onCreateDimension(target, { angle });
    }
    setDimPoint(null);
    setDimLine(null);
    setDimTarget(null);
    setDimPlacement(null);
  };

  const placementForTarget = (
    target: DimensionTarget,
    cursor: Vec2,
  ): DimensionPlacement | null => {
    if (target.kind === "distance") {
      const a = points[target.a];
      const b = points[target.b];
      return a && b ? { offset: dimensionOffset(a, b, cursor) } : null;
    }
    if (target.kind === "pointLineDistance") {
      const point = points[target.point];
      const line = lineThrough(target.line);
      if (!point || !line) return null;
      const projection = projectPointOnLine(line.a, line.b, point);
      return { offset: dimensionOffset(point, projection, cursor) };
    }
    if (target.kind === "angle") {
      const a = lineThrough(target.a);
      const b = lineThrough(target.b);
      if (!a || !b) return null;
      const vertex = lineIntersection(a.a, a.b, b.a, b.b);
      return {
        offset: vertex
          ? Math.max(8, Math.hypot(cursor[0] - vertex[0], cursor[1] - vertex[1]))
          : 30,
      };
    }
    const circle = circleLike(target.circle);
    return circle ? { angle: circleAngle(circle, cursor) } : null;
  };

  /** Fraction of the way from a to b nearest the cursor. */
  const alongAtCursor = (a: Vec2, b: Vec2, cursor: Vec2): number => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared < 1e-9) return 0.5;
    const t =
      ((cursor[0] - a[0]) * dx + (cursor[1] - a[1]) * dy) / lengthSquared;
    return Math.max(0.05, Math.min(0.95, t));
  };

  const placementAtCursor = (
    constraint: SketchConstraint,
    cursor: Vec2,
  ): DimensionPlacement | null => {
    if (constraint.type === "distance") {
      const a = points[constraint.a];
      const b = points[constraint.b];
      return a && b
        ? {
            offset: dimensionOffset(a, b, cursor),
            along: alongAtCursor(a, b, cursor),
          }
        : null;
    }
    if (constraint.type === "pointLineDistance") {
      const point = points[constraint.point];
      const line = lineThrough(constraint.line);
      if (!point || !line) return null;
      const projection = projectPointOnLine(line.a, line.b, point);
      return {
        offset: dimensionOffset(point, projection, cursor),
        along: alongAtCursor(point, projection, cursor),
      };
    }
    if (constraint.type === "diameter") {
      const circle = circleLike(constraint.circle);
      if (!circle) return null;
      const radiusToCursor = Math.hypot(
        cursor[0] - circle.center[0],
        cursor[1] - circle.center[1],
      );
      return {
        angle: circleAngle(circle, cursor),
        distance: Math.max(2, radiusToCursor - circle.radius),
      };
    }
    if (constraint.type === "angle") {
      const a = lineThrough(constraint.a);
      const b = lineThrough(constraint.b);
      if (!a || !b) return null;
      const vertex = lineIntersection(a.a, a.b, b.a, b.b);
      return {
        offset: vertex
          ? Math.max(8, Math.hypot(cursor[0] - vertex[0], cursor[1] - vertex[1]))
          : 30,
      };
    }
    return null;
  };

  const pointLineInfo = (
    pointId: string,
    lineId: string,
  ): { point: Vec2; line: { a: Vec2; b: Vec2 }; projection: Vec2 } | null => {
    const point = points[pointId];
    const line = lineThrough(lineId);
    if (!point || !line) return null;
    return {
      point,
      line,
      projection: projectPointOnLine(line.a, line.b, point),
    };
  };

  const angleInfo = (
    aId: string,
    bId: string,
  ): { vertex: Vec2; rayA: Vec2; rayB: Vec2 } | null => {
    const a = lineThrough(aId);
    const b = lineThrough(bId);
    if (!a || !b) return null;
    const vertex = lineIntersection(a.a, a.b, b.a, b.b);
    if (!vertex) return null;
    return {
      vertex,
      rayA: [(a.a[0] + a.b[0]) / 2, (a.a[1] + a.b[1]) / 2],
      rayB: [(b.a[0] + b.b[0]) / 2, (b.a[1] + b.b[1]) / 2],
    };
  };

  const startDimensionDrag = (
    event: ReactPointerEvent,
    constraint: SketchConstraint,
  ) => {
    event.stopPropagation();
    event.preventDefault();
    dimensionDragRef.current = {
      id: constraint.id,
      start: toSketch(event),
      constraint,
      active: false,
    };
  };

  const startPan = (event: ReactPointerEvent<Element>) => {
    svgRef.current?.setPointerCapture(event.pointerId);
    panRef.current = { clientX: event.clientX, clientY: event.clientY, box: viewBox };
  };

  const placeLineVertex = (raw: Vec2) => {
    const current = draftRef.current;
    const last = current[current.length - 1];
    const snap = snapPoint(raw, last?.point);

    if (current.length === 0) {
      updateDraft([
        {
          point: snap.point,
          existingPointId: snap.existingPointId,
          referenceLineId: snap.referenceLineId,
          referenceLineIds: snap.referenceLineIds,
        },
      ]);
      return;
    }

    const first = current[0]!;
    const closes =
      current.length >= 3 &&
      Math.hypot(snap.point[0] - first.point[0], snap.point[1] - first.point[1]) <
        snapTolerance;
    if (closes) {
      onCreatePolyline(current, true);
      updateDraft([]);
      return;
    }

    if (
      last &&
      Math.hypot(snap.point[0] - last.point[0], snap.point[1] - last.point[1]) < 1e-6
    ) {
      return;
    }
    updateDraft([
      ...current,
      {
        point: snap.point,
        existingPointId: snap.existingPointId,
        referenceLineId: snap.referenceLineId,
        referenceLineIds: snap.referenceLineIds,
      },
    ]);
  };

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button === 1 || event.button === 2) {
      startPan(event);
      return;
    }
    if (event.button !== 0) return;

    const raw = toSketch(event);

    if (tool === "dimension") {
      if (activeDimTarget) {
        placeDimension(raw);
      } else {
        setDimPoint(null);
        setDimLine(null);
      }
      return;
    }
    if (tool === "trim") {
      startPan(event);
      return;
    }
    if (tool === "box") {
      event.preventDefault();
      setBoxStart(raw);
      setBoxEnd(raw);
      svgRef.current?.setPointerCapture(event.pointerId);
      return;
    }
    if (tool === "lasso") {
      event.preventDefault();
      lassoRef.current = [raw];
      setLassoPoints([raw]);
      svgRef.current?.setPointerCapture(event.pointerId);
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
    if (tool === "point") {
      const snap = snapPoint(raw);
      // Clicking an existing point selects it instead of stacking a duplicate.
      if (snap.existingPointId) onSelect(snap.existingPointId, false);
      else
        onCreatePoint({
          point: snap.point,
          referenceLineId: snap.referenceLineId,
          referenceLineIds: snap.referenceLineIds,
        });
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
        setCircleCenter({
          point: snap.point,
          existingPointId: snap.existingPointId,
          referenceLineId: snap.referenceLineId,
          referenceLineIds: snap.referenceLineIds,
        });
      } else {
        const snap = snapPoint(raw);
        const radius = Math.hypot(
          snap.point[0] - circleCenter.point[0],
          snap.point[1] - circleCenter.point[1],
        );
        if (radius >= 0.5) onCreateCircle(circleCenter, roundTo(radius, 1));
        setCircleCenter(null);
      }
      return;
    }
    if (tool === "arc") {
      const snap = snapPoint(raw);
      if (!arcStart) {
        setArcStart({
          point: snap.point,
          existingPointId: snap.existingPointId,
          referenceLineId: snap.referenceLineId,
          referenceLineIds: snap.referenceLineIds,
        });
        return;
      }
      if (!arcEnd) {
        if (
          Math.hypot(
            snap.point[0] - arcStart.point[0],
            snap.point[1] - arcStart.point[1],
          ) >= 1
        ) {
          setArcEnd({
            point: snap.point,
            existingPointId: snap.existingPointId,
            referenceLineId: snap.referenceLineId,
            referenceLineIds: snap.referenceLineIds,
          });
        }
        return;
      }
      onCreateArc(arcStart, arcEnd, snap.point);
      setArcStart(null);
      setArcEnd(null);
      setHover(null);
    }
  };

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const raw = toSketch(event);

    if (lassoRef.current.length > 0) {
      const points = lassoRef.current;
      const last = points[points.length - 1]!;
      if (Math.hypot(raw[0] - last[0], raw[1] - last[1]) * scale >= 2) {
        const next = [...points, raw];
        lassoRef.current = next;
        setLassoPoints(next);
      }
      return;
    }

    if (boxStart) {
      setBoxEnd(raw);
      return;
    }

    if (dimensionDragRef.current) {
      const drag = dimensionDragRef.current;
      if (!drag.active) {
        if (Math.hypot(raw[0] - drag.start[0], raw[1] - drag.start[1]) * scale < 3) {
          return;
        }
        drag.active = true;
        svgRef.current?.setPointerCapture(event.pointerId);
      }
      const placement = placementAtCursor(drag.constraint, raw);
      if (placement) onMoveDimension(drag.id, placement);
      return;
    }

    if (arcDragRef.current) {
      const drag = arcDragRef.current;
      const dx = raw[0] - drag.start[0];
      const dy = raw[1] - drag.start[1];
      if (!drag.active) {
        if (Math.hypot(dx, dy) * scale < 3) return;
        drag.active = true;
      }
      onDragLine(
        drag.arcId,
        drag.points.map(({ id, point }) => ({
          pointId: id,
          x: point[0] + dx,
          y: point[1] + dy,
        })),
      );
      return;
    }

    if (lineDragRef.current) {
      const drag = lineDragRef.current;
      const dx = raw[0] - drag.start[0];
      const dy = raw[1] - drag.start[1];
      // A click or shift-click must not nudge the line; wait for a small
      // screen-space threshold before treating this as a drag.
      if (!drag.active) {
        if (Math.hypot(dx, dy) * scale < 3) return;
        drag.active = true;
      }
      onDragLine(drag.lineId, [
        { pointId: drag.a.id, x: drag.a.point[0] + dx, y: drag.a.point[1] + dy },
        { pointId: drag.b.id, x: drag.b.point[0] + dx, y: drag.b.point[1] + dy },
      ]);
      return;
    }

    if (circleDragRef.current) {
      const drag = circleDragRef.current;
      const dx = raw[0] - drag.start[0];
      const dy = raw[1] - drag.start[1];
      if (!drag.active) {
        if (Math.hypot(dx, dy) * scale < 3) return;
        drag.active = true;
      }
      onDragPoint(drag.centerId, drag.center[0] + dx, drag.center[1] + dy);
      return;
    }

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
      if (activeDimTarget) {
        const placement = placementForTarget(activeDimTarget, raw);
        if (placement) setDimPlacement(placement);
      } else if (dimPoint) {
        setHover(snapPoint(raw));
      }
      return;
    }
    if (tool === "select" || tool === "trim") return;

    const axisFrom =
      tool === "line"
        ? draftRef.current[draftRef.current.length - 1]?.point
        : tool === "arc"
          ? arcStart?.point
          : undefined;
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

    if (lassoRef.current.length > 0) {
      const points = lassoRef.current;
      lassoRef.current = [];
      setLassoPoints([]);
      if (points.length >= 3) {
        const ids = regionsIntersectingPolygon(regions, points).map(
          (region) => region.id,
        );
        onMarqueeSelectRegions(ids, event.shiftKey);
      }
    }

    if (boxStart) {
      const end = toSketch(event);
      const box = {
        minX: Math.min(boxStart[0], end[0]),
        minY: Math.min(boxStart[1], end[1]),
        maxX: Math.max(boxStart[0], end[0]),
        maxY: Math.max(boxStart[1], end[1]),
      };
      const ids = regionsFullyInside(regions, box).map((region) => region.id);
      setBoxStart(null);
      setBoxEnd(null);
      onMarqueeSelectRegions(ids, event.shiftKey);
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

    if (dimensionDragRef.current) {
      const active = dimensionDragRef.current.active;
      dimensionDragRef.current = null;
      if (active) onDragEnd();
    }

    if (arcDragRef.current) {
      const active = arcDragRef.current.active;
      arcDragRef.current = null;
      if (active) onDragEnd();
    }

    if (lineDragRef.current) {
      const active = lineDragRef.current.active;
      lineDragRef.current = null;
      if (active) onDragEnd();
    }

    if (circleDragRef.current) {
      const active = circleDragRef.current.active;
      circleDragRef.current = null;
      if (active) onDragEnd();
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

  const onCurvePointerDown = (event: ReactPointerEvent, curve: SketchCurve) => {
    // Drawing tools must see the gesture themselves: a click near an existing
    // edge is how you start/end a snapped line, not a selection.
    if (tool !== "select" && tool !== "dimension" && tool !== "trim") return;
    if (!curvesSelectable) return;
    event.stopPropagation();
    event.preventDefault();

    if (tool === "dimension") {
      pickDimensionCurve(event, curve);
      return;
    }

    if (tool === "trim") {
      if (!curve.construction) onTrimCurve(curve.id, toSketch(event));
      return;
    }

    onSelect(curve.id, additiveSelection(event));

    if (curve.type === "line") {
      // Reference axes are fixed; select them but never drag them.
      if (curve.reference) return;
      const a = points[curve.a];
      const b = points[curve.b];
      if (!a || !b) return;
      // Near an endpoint, dragging the endpoint is almost always what the user
      // means. Without this fallback a slightly-off grab starts a whole-line
      // translation and both endpoints appear to move together.
      const raw = toSketch(event);
      let endpoint: { id: string; distance: number } | null = null;
      for (const [id, position] of [
        [curve.a, a],
        [curve.b, b],
      ] as const) {
        const point = sketch.points.find((candidate) => candidate.id === id);
        if (!point || point.fixed || point.construction) continue;
        const distance = Math.hypot(
          position[0] - raw[0],
          position[1] - raw[1],
        );
        if (
          distance <= hitRadius * 2.2 &&
          (!endpoint || distance < endpoint.distance)
        ) {
          endpoint = { id, distance };
        }
      }
      if (endpoint) {
        startPointDrag(event, endpoint.id);
        return;
      }
      lineDragRef.current = {
        lineId: curve.id,
        start: raw,
        a: { id: curve.a, point: a },
        b: { id: curve.b, point: b },
        active: false,
      };
      svgRef.current?.setPointerCapture(event.pointerId);
      return;
    }

    if (curve.type === "arc") {
      const center = points[curve.center];
      const start = points[curve.start];
      const end = points[curve.end];
      if (!center || !start || !end) return;
      arcDragRef.current = {
        arcId: curve.id,
        start: toSketch(event),
        points: [
          { id: curve.center, point: center },
          { id: curve.start, point: start },
          { id: curve.end, point: end },
        ],
        active: false,
      };
      svgRef.current?.setPointerCapture(event.pointerId);
      return;
    }

    // Dragging a circle moves it by its centre, preserving the grab offset so
    // it does not jump under the pointer. Reference circles (e.g. the example's
    // centred hole) are select-only.
    const center = sketch.points.find((point) => point.id === curve.center);
    const position = points[curve.center];
    if (!center || center.construction || !position) return;
    circleDragRef.current = {
      centerId: curve.center,
      start: toSketch(event),
      center: position,
      active: false,
    };
    svgRef.current?.setPointerCapture(event.pointerId);
  };

  const onDoubleClick = () => {
    const current = draftRef.current;
    if (tool === "line" && current.length >= 2) {
      onCreatePolyline(current, false);
      draftRef.current = [];
      setDraft([]);
    }
  };

  // The SVG keeps a square sketch-space viewBox and letterboxes it into a wide
  // stage. Draw the grid over the whole visible stage, not just the square, so
  // the margins are not blank.
  const gridBox = useMemo(
    () => withCanvasAspect(viewBox, size.width, size.height),
    [viewBox, size.width, size.height],
  );
  const grid = useMemo(
    () => makeGrid(gridBox, effectiveGridStep, scale),
    [gridBox, effectiveGridStep, scale],
  );
  const circles = sketch.curves.filter(
    (curve): curve is SketchCircle => curve.type === "circle",
  );
  const pointRadius = 3.4 * px;
  const hitRadius = 11 * px;
  const fontSize = 11 * px;
  const draftPolygon = [...draft.map((vertex) => vertex.point), ...(hover ? [hover.point] : [])]
    .map((point) => `${point[0]},${point[1]}`)
    .join(" ");
  const origin = sketch.references
    ? points[sketch.references.origin.id] ?? [0, 0]
    : null;
  const originSelected = sketch.references
    ? selected.has(sketch.references.origin.id)
    : false;
  const rectGeometry = rect ? normalizeRect(rect.a, rect.b) : null;
  const circleRadius =
    circleCenter && hover
      ? Math.hypot(
          hover.point[0] - circleCenter.point[0],
          hover.point[1] - circleCenter.point[1],
        )
      : 0;
  const soleSelectedId = selected.size === 1 ? [...selected][0] : null;
  const pointForEditor =
    soleSelectedId !== null
      ? sketch.points.find(
          (candidate) =>
            candidate.id === soleSelectedId &&
            !candidate.fixed &&
            !candidate.construction,
        ) ?? null
      : null;
  useEffect(() => {
    if (!pointForEditor) return;
    const frame = requestAnimationFrame(() => {
      const svg = svgRef.current;
      const matrix = svg?.getScreenCTM();
      const rect = svg?.getBoundingClientRect();
      if (!svg || !matrix || !rect) return;
      const position = points[pointForEditor.id] ?? [
        pointForEditor.x,
        pointForEditor.y,
      ];
      const screen = new DOMPoint(position[0], position[1]).matrixTransform(
        matrix,
      );
      setPointEditorScreen({ x: screen.x - rect.left, y: screen.y - rect.top });
    });
    return () => cancelAnimationFrame(frame);
  }, [pointForEditor, points, viewBox, size.width, size.height, svgRef]);

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
            stroke={line.major ? palette.gridMajor : palette.grid}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </g>

      {sketch.references?.lines.map((axis) => {
        const a = points[axis.a];
        const b = points[axis.b];
        if (!a || !b) return null;
        const isSelected = selected.has(axis.id);
        const isHovered = hoveredCurveId === axis.id;
        const projected = Boolean(axis.projectionId);
        return (
          <g key={axis.id}>
            {isHovered ? (
              <line
                x1={a[0]}
                y1={a[1]}
                x2={b[0]}
                y2={b[1]}
                stroke={palette.marker}
                strokeWidth={5}
                strokeOpacity={0.7}
                strokeLinecap="round"
                pointerEvents="none"
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
            {isSelected ? (
              <line
                x1={a[0]}
                y1={a[1]}
                x2={b[0]}
                y2={b[1]}
                stroke={palette.markerSoft}
                strokeWidth={12}
                strokeLinecap="round"
                pointerEvents="none"
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
            <line
              data-reference-id={axis.id}
              data-projection-id={axis.projectionId}
              x1={a[0]}
              y1={a[1]}
              x2={b[0]}
              y2={b[1]}
              stroke={projected ? palette.dimension : palette.axis}
              strokeWidth={1}
              strokeDasharray={projected ? "2 3" : undefined}
              strokeLinecap={projected ? "round" : undefined}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        );
      })}

      {regions.map((region) => {
        const d = regionPathData(region);
        if (!d) return null;
        const active = selectedRegions.has(region.id);
        const bounds = loopBounds(region.outer);
        const conflict = tone === "conflict";
        return (
          <path
            key={region.id}
            d={d}
            fillRule="evenodd"
            fillOpacity={active ? 0.55 : 1}
            fill={
              active
                ? palette.markerSoft
                : region.kind === "void"
                  ? "transparent"
                  : palette.grid
            }
            stroke={active ? (conflict ? palette.danger : palette.ink) : "none"}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
            data-region-id={region.id}
            data-region-kind={region.kind}
            data-region-bounds={`${bounds.minX},${bounds.minY},${bounds.maxX},${bounds.maxY}`}
            pointerEvents={
              tool === "select" && regionsSelectableNow ? "fill" : "none"
            }
            style={{
              cursor:
                tool === "select" && regionsSelectableNow
                  ? "pointer"
                  : "default",
            }}
            onPointerDown={(event) => {
              if (tool !== "select" || !regionsSelectableNow) return;
              event.stopPropagation();
              event.preventDefault();
              onSelectRegion(region.id, additiveSelection(event));
              startPan(event);
            }}
          />
        );
      })}

      {bodyReference.length > 0 ? (
        <g className="body-reference" aria-hidden="true" pointerEvents="none">
          {bodyReference.map(([x1, y1, x2, y2], index) => (
            <line
              key={`body-${index}`}
              data-body-reference=""
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={palette.reference}
              strokeWidth={1}
              strokeOpacity={0.55}
              strokeDasharray="1 3"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </g>
      ) : null}

      {circles.map((circle) => {
        const center = points[circle.center];
        if (!center) return null;
        const isSelected = selected.has(circle.id);
        const isHovered = hoveredCurveId === circle.id;
        const radius = radii[circle.id] ?? circle.radius;
        return (
          <g key={circle.id}>
            {isHovered ? (
              <circle
                cx={center[0]}
                cy={center[1]}
                r={radius}
                fill="none"
                stroke={palette.marker}
                strokeWidth={5}
                strokeOpacity={0.7}
                pointerEvents="none"
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
            {isSelected ? (
              <circle
                cx={center[0]}
                cy={center[1]}
                r={radius}
                fill="none"
                stroke={palette.markerSoft}
                strokeWidth={12}
                pointerEvents="none"
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
            <circle
              data-geometry-id={circle.id}
              cx={center[0]}
              cy={center[1]}
              r={radius}
              fill="none"
              stroke={color}
              strokeWidth={1.4}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        );
      })}

      {sketch.curves.map((curve) => {
        if (curve.type !== "line") return null;
        const a = points[curve.a];
        const b = points[curve.b];
        if (!a || !b) return null;
        const isSelected = selected.has(curve.id);
        const isHovered = hoveredCurveId === curve.id;
        return (
          <g key={curve.id}>
            {isHovered ? (
              <line
                x1={a[0]}
                y1={a[1]}
                x2={b[0]}
                y2={b[1]}
                stroke={palette.marker}
                strokeWidth={5}
                strokeOpacity={0.7}
                strokeLinecap="round"
                pointerEvents="none"
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
            {isSelected ? (
              <line
                x1={a[0]}
                y1={a[1]}
                x2={b[0]}
                y2={b[1]}
                stroke={palette.markerSoft}
                strokeWidth={12}
                strokeLinecap="round"
                pointerEvents="none"
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
            <line
              data-geometry-id={curve.id}
              x1={a[0]}
              y1={a[1]}
              x2={b[0]}
              y2={b[1]}
              stroke={curve.construction ? palette.construction : color}
              strokeWidth={1.6}
              strokeDasharray={curve.construction ? "5 4" : undefined}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        );
      })}

      {sketch.curves.map((curve) => {
        if (curve.type !== "arc") return null;
        const d = arcPathData(curve, points);
        if (!d) return null;
        const isSelected = selected.has(curve.id);
        const isHovered = hoveredCurveId === curve.id;
        return (
          <g key={curve.id}>
            {isHovered ? (
              <path
                d={d}
                fill="none"
                stroke={palette.marker}
                strokeWidth={5}
                strokeOpacity={0.7}
                strokeLinecap="round"
                pointerEvents="none"
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
            {isSelected ? (
              <path
                d={d}
                fill="none"
                stroke={palette.markerSoft}
                strokeWidth={12}
                strokeLinecap="round"
                pointerEvents="none"
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
            <path
              data-geometry-id={curve.id}
              d={d}
              fill="none"
              stroke={curve.construction ? palette.construction : color}
              strokeWidth={1.6}
              strokeDasharray={curve.construction ? "5 4" : undefined}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        );
      })}

      {tool === "select" || tool === "dimension" || tool === "trim" ? (
        <g>
          {tool === "trim"
            ? null
            : sketch.references?.lines.map((axis) => {
                const a = points[axis.a];
            const b = points[axis.b];
            if (!a || !b) return null;
            return (
              <line
                key={axis.id}
                x1={a[0]}
                y1={a[1]}
                x2={b[0]}
                y2={b[1]}
                stroke="transparent"
                strokeWidth={12}
                vectorEffect="non-scaling-stroke"
                pointerEvents="stroke"
                style={{ cursor: tool === "select" ? "pointer" : "pointer" }}
                data-curve-id={axis.id}
                onPointerDown={(event) => onCurvePointerDown(event, axis)}
              />
            );
              })}
          {sketch.references && origin && tool !== "trim" ? (
            <circle
              cx={origin[0]}
              cy={origin[1]}
              r={hitRadius}
              fill="transparent"
              style={{ cursor: tool === "select" ? "pointer" : "crosshair" }}
              data-point-id={sketch.references.origin.id}
              onPointerDown={(event) => {
                if (!pointsSelectable) return;
                event.stopPropagation();
                event.preventDefault();
                if (!sketch.references) return;
                if (tool === "dimension") {
                  pickDimensionPoint(event, sketch.references.origin.id);
                } else {
                  onSelect(
                    sketch.references.origin.id,
                    additiveSelection(event),
                  );
                }
              }}
            />
          ) : null}
          {sketch.references?.points
            .filter(
              (point) =>
                Boolean(point.projectionId) &&
                point.id !== sketch.references?.origin.id,
            )
            .map((point) => {
              const position = points[point.id];
              if (!position) return null;
              return (
                <circle
                  key={point.id}
                  cx={position[0]}
                  cy={position[1]}
                  r={hitRadius}
                  fill="transparent"
                  style={{ cursor: tool === "select" ? "pointer" : "crosshair" }}
                  data-reference-id={point.id}
                  data-projection-point-id={point.projectionId}
                  onPointerDown={(event) => {
                    if (!pointsSelectable) return;
                    event.stopPropagation();
                    event.preventDefault();
                    if (tool === "dimension") {
                      pickDimensionPoint(event, point.id);
                    } else {
                      onSelect(point.id, additiveSelection(event));
                    }
                  }}
                />
              );
            })}
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
                  style={{
                    cursor:
                      tool === "select"
                        ? "grab"
                        : tool === "trim"
                          ? "crosshair"
                          : "pointer",
                  }}
                  data-curve-id={curve.id}
                  onPointerDown={(event) => onCurvePointerDown(event, curve)}
                />
              );
            }
            if (curve.type === "arc") {
              const d = arcPathData(curve, points);
              if (!d) return null;
              return (
                <path
                  key={curve.id}
                  d={d}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={12}
                  vectorEffect="non-scaling-stroke"
                  pointerEvents="stroke"
                  style={{
                    cursor:
                      tool === "select"
                        ? "grab"
                        : tool === "trim"
                          ? "crosshair"
                          : "pointer",
                  }}
                  data-curve-id={curve.id}
                  onPointerDown={(event) => onCurvePointerDown(event, curve)}
                />
              );
            }
            if (tool === "trim") return null;
            const center = points[curve.center];
            if (!center) return null;
            return (
              <circle
                key={curve.id}
                cx={center[0]}
                cy={center[1]}
                r={curveRadius(curve, points, radii) ?? 0}
                fill="none"
                stroke="transparent"
                strokeWidth={12}
                vectorEffect="non-scaling-stroke"
                pointerEvents="stroke"
                style={{ cursor: tool === "select" ? "grab" : "pointer" }}
                data-curve-id={curve.id}
                onPointerDown={(event) => onCurvePointerDown(event, curve)}
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
                along={constraint.along}
                value={distanceBetween(a, b)}
                reference={constraint.driving === false}
                px={px}
                fontSize={fontSize}
                palette={palette}
                editingId={editor?.id ?? null}
                onEdit={dimensionsSelectable ? openDimensionEditor : undefined}
                onDrag={
                  dimensionsSelectable
                    ? (event) => startDimensionDrag(event, constraint)
                    : undefined
                }
              />
            );
          }
          if (constraint.type === "pointLineDistance") {
            const info = pointLineInfo(constraint.point, constraint.line);
            if (!info) return null;
            return (
              <LinearDimension
                key={constraint.id}
                id={constraint.id}
                a={info.point}
                b={info.projection}
                offset={constraint.offset ?? 10}
                along={constraint.along}
                value={distanceBetween(info.point, info.projection)}
                reference={constraint.driving === false}
                px={px}
                fontSize={fontSize}
                palette={palette}
                editingId={editor?.id ?? null}
                onEdit={dimensionsSelectable ? openDimensionEditor : undefined}
                onDrag={
                  dimensionsSelectable
                    ? (event) => startDimensionDrag(event, constraint)
                    : undefined
                }
              />
            );
          }
          if (constraint.type === "diameter") {
            const circle = circleLike(constraint.circle);
            if (!circle) return null;
            return (
              <DiameterDimension
                key={constraint.id}
                id={constraint.id}
                center={circle.center}
                radius={circle.radius}
                angle={constraint.angle ?? 45}
                distance={constraint.distance}
                arcStartAngle={circle.startAngle}
                arcSweep={circle.sweep}
                value={constraint.radius ? circle.radius : circle.radius * 2}
                asRadius={constraint.radius}
                reference={constraint.driving === false}
                px={px}
                fontSize={fontSize}
                palette={palette}
                editingId={editor?.id ?? null}
                onEdit={dimensionsSelectable ? openDimensionEditor : undefined}
                onDrag={
                  dimensionsSelectable
                    ? (event) => startDimensionDrag(event, constraint)
                    : undefined
                }
              />
            );
          }
          if (constraint.type === "angle") {
            const info = angleInfo(constraint.a, constraint.b);
            if (!info) return null;
            return (
              <AngleDimension
                key={constraint.id}
                id={constraint.id}
                vertex={info.vertex}
                rayA={info.rayA}
                rayB={info.rayB}
                radius={constraint.offset ?? 30}
                value={angleBetweenVectors(info.vertex, info.rayA, info.rayB)}
                reference={constraint.driving === false}
                palette={palette}
                px={px}
                fontSize={fontSize}
                editingId={editor?.id ?? null}
                onEdit={dimensionsSelectable ? openDimensionEditor : undefined}
                onDrag={
                  dimensionsSelectable
                    ? (event) => startDimensionDrag(event, constraint)
                    : undefined
                }
              />
            );
          }
          return null;
        })}
      </g>

      {tool === "dimension" && activeDimTarget && dimPlacement ? (
        <g opacity={0.65}>
          {activeDimTarget.kind === "distance" &&
          points[activeDimTarget.a] &&
          points[activeDimTarget.b] ? (
            <LinearDimension
              id="preview"
              a={points[activeDimTarget.a]!}
              b={points[activeDimTarget.b]!}
              offset={dimPlacement.offset ?? 12}
              value={distanceBetween(points[activeDimTarget.a]!, points[activeDimTarget.b]!)}
              reference={false}
              preview
              palette={palette}
              px={px}
              fontSize={fontSize}
            />
          ) : null}
          {activeDimTarget.kind === "pointLineDistance" &&
          (() => {
            const info = pointLineInfo(activeDimTarget.point, activeDimTarget.line);
            if (!info) return null;
            return (
              <LinearDimension
                id="preview"
                a={info.point}
                b={info.projection}
                offset={dimPlacement.offset ?? 10}
                value={distanceBetween(info.point, info.projection)}
                reference={false}
                preview
                palette={palette}
                px={px}
                fontSize={fontSize}
              />
            );
          })()}
          {(activeDimTarget.kind === "diameter" || activeDimTarget.kind === "radius") &&
          (() => {
            const circle = circleLike(activeDimTarget.circle);
            if (!circle) return null;
            return (
              <DiameterDimension
                id="preview"
                center={circle.center}
                radius={circle.radius}
                angle={dimPlacement.angle ?? 45}
                arcStartAngle={circle.startAngle}
                arcSweep={circle.sweep}
                value={
                  activeDimTarget.kind === "radius" ? circle.radius : circle.radius * 2
                }
                asRadius={activeDimTarget.kind === "radius"}
                reference={false}
                preview
                palette={palette}
                px={px}
                fontSize={fontSize}
              />
            );
          })()}
          {activeDimTarget.kind === "angle" &&
          (() => {
            const info = angleInfo(activeDimTarget.a, activeDimTarget.b);
            if (!info) return null;
            return (
              <AngleDimension
                id="preview"
                vertex={info.vertex}
                rayA={info.rayA}
                rayB={info.rayB}
                radius={dimPlacement.offset ?? 30}
                value={angleBetweenVectors(info.vertex, info.rayA, info.rayB)}
                reference={false}
                preview
                palette={palette}
                px={px}
                fontSize={fontSize}
              />
            );
          })()}
        </g>
      ) : null}

      <ConstraintBadges sketch={sketch} points={points} palette={palette} px={px} />

      <g pointerEvents="none">
          <line
            x1={-5 * px}
            y1={0}
            x2={5 * px}
            y2={0}
            stroke={originSelected ? palette.marker : palette.dim}
            strokeWidth={1.2}
            vectorEffect="non-scaling-stroke"
          />
          <line
            x1={0}
            y1={-5 * px}
            x2={0}
            y2={5 * px}
            stroke={originSelected ? palette.marker : palette.dim}
            strokeWidth={1.2}
            vectorEffect="non-scaling-stroke"
          />
          <circle
            cx={0}
            cy={0}
            r={2.2 * px}
            fill={palette.halo}
            stroke={originSelected ? palette.marker : palette.dim}
          />
      </g>

      {sketch.points.map((point) => {
        if (point.fixed || point.construction) return null;
        const position = points[point.id];
        if (!position) return null;
        const active = dragging === point.id;
        const isSelected = selected.has(point.id);
        const isHovered = hoveredPointId === point.id;
        return (
          <g key={point.id}>
            {(tool === "select" || tool === "dimension") && pointsSelectable ? (
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
              fill={
                isSelected || isHovered
                  ? palette.marker
                  : point.standalone
                    ? palette.halo
                    : active
                      ? color
                      : palette.pointFill
              }
              stroke={isSelected || isHovered ? palette.markerInk : color}
              strokeWidth={1.6}
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
              data-standalone={point.standalone ? "true" : undefined}
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
          fill={palette.grid}
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

      {tool === "arc" && arcStart && arcEnd && hover ? (
        (() => {
          const preview = arcThroughPath(arcStart.point, arcEnd.point, hover.point);
          if (!preview) return null;
          return (
            <path
              d={preview.d}
              fill="none"
              stroke={color}
              strokeWidth={1.5}
              strokeDasharray="6 4"
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          );
        })()
      ) : null}

      {tool === "arc" && arcStart && !arcEnd && hover ? (
        <line
          x1={arcStart.point[0]}
          y1={arcStart.point[1]}
          x2={hover.point[0]}
          y2={hover.point[1]}
          stroke={color}
          strokeWidth={1.2}
          strokeDasharray="4 4"
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
      ) : null}

      {tool === "arc" && arcStart ? (
        <circle
          cx={arcStart.point[0]}
          cy={arcStart.point[1]}
          r={pointRadius}
          fill={color}
          pointerEvents="none"
        />
      ) : null}
      {tool === "arc" && arcEnd ? (
        <circle
          cx={arcEnd.point[0]}
          cy={arcEnd.point[1]}
          r={pointRadius}
          fill={color}
          pointerEvents="none"
        />
      ) : null}

      {profileSelection && tool === "select" && regionsSelectableNow
        ? regions.map((region) => {
            const d = regionPathData(region);
            if (!d) return null;
            return (
              <path
                key={`profile-hit-${region.id}`}
                d={d}
                fill="transparent"
                fillRule="evenodd"
                pointerEvents="fill"
                data-region-hit={region.id}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  event.preventDefault();
                  onSelectRegion(region.id, additiveSelection(event));
                  startPan(event);
                }}
              />
            );
          })
        : null}

      {hover && tool !== "select" ? (
        <circle
          cx={hover.point[0]}
          cy={hover.point[1]}
          r={(hover.kind === "point" ? 6 : 4) * px}
          fill={hover.kind === "point" ? palette.markerSoft : "none"}
          stroke={hover.kind === "point" ? palette.hover : palette.snap}
          strokeWidth={1.2}
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
      ) : null}

      {boxStart && boxEnd ? (
        <rect
          x={Math.min(boxStart[0], boxEnd[0])}
          y={Math.min(boxStart[1], boxEnd[1])}
          width={Math.abs(boxEnd[0] - boxStart[0])}
          height={Math.abs(boxEnd[1] - boxStart[1])}
          fill={palette.markerSoft}
          fillOpacity={0.35}
          stroke={palette.ink}
          strokeWidth={1}
          strokeDasharray="4 3"
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
          data-testid="box-marquee"
        />
      ) : null}

      {lassoPoints.length > 1 ? (
        <polygon
          points={lassoPoints
            .map((point) => `${point[0]},${point[1]}`)
            .join(" ")}
          fill={palette.markerSoft}
          fillOpacity={0.25}
          stroke={palette.ink}
          strokeWidth={1}
          strokeDasharray="4 3"
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
          data-testid="lasso-marquee"
        />
      ) : null}
    </svg>
      {editor ? (
        <div
          className="dim-editor is-selected"
          data-kind={editor.reference ? "reference" : "driving"}
          style={{ left: editor.x, top: editor.y }}
          onBlur={handleEditorBlur}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <span className="dim-field">
            {editor.reference ? (
              <>
                <span
                  className="dim-readout"
                  data-testid="dimension-readout"
                >
                  ({formatLength(editor.measured)})
                </span>
                <span className="dim-unit">mm</span>
              </>
            ) : (
              <>
                <input
                  autoFocus
                  data-testid="dimension-input"
                  value={editor.value}
                  inputMode="decimal"
                  aria-label="Dimension value"
                  onChange={(event) =>
                    setEditor({ ...editor, value: event.target.value })
                  }
                />
                <span className="dim-unit">mm</span>
              </>
            )}
          </span>
          <span className="seg dim-kind" role="group" aria-label="Dimension kind">
            <button
              type="button"
              className={!editor.reference ? "is-selected" : ""}
              aria-pressed={!editor.reference}
              data-testid="dimension-kind-driving"
              onClick={(event) => {
                setEditor({
                  ...editor,
                  reference: false,
                  value: formatEditable(editor.measured),
                });
                event.currentTarget.focus();
              }}
            >
              driving
            </button>
            <button
              type="button"
              className={editor.reference ? "is-selected" : ""}
              aria-pressed={editor.reference}
              data-testid="dimension-kind-reference"
              onClick={(event) => {
                setEditor({
                  ...editor,
                  reference: true,
                  value: formatEditable(editor.measured),
                });
                event.currentTarget.focus();
              }}
            >
              reference
            </button>
          </span>
          <button
            className="text-action is-quiet"
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              dimensionCommittedRef.current = true;
              onDeleteDimension(editor.id);
              setEditor(null);
            }}
            data-testid="dimension-delete"
          >
            delete
          </button>
        </div>
      ) : null}
      {pointForEditor && pointEditorScreen && onSetPointPosition ? (
        <PointInlineEditor
          key={`${pointForEditor.id}:${points[pointForEditor.id]?.[0] ?? pointForEditor.x}:${points[pointForEditor.id]?.[1] ?? pointForEditor.y}`}
          id={pointForEditor.id}
          x={
            points[pointForEditor.id]?.[0] ?? pointForEditor.x
          }
          y={
            points[pointForEditor.id]?.[1] ?? pointForEditor.y
          }
          screen={pointEditorScreen}
          onSet={onSetPointPosition}
        />
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
  palette: SketchPalette;
  onEdit?: (
    event: ReactMouseEvent,
    id: string,
    value: number,
    reference: boolean,
    asRadius?: boolean,
    anchor?: Vec2,
  ) => void;
  onDrag?: (event: ReactPointerEvent) => void;
  /** The dimension whose inline editor is open; its SVG label is hidden. */
  editingId?: string | null;
}

function LinearDimension({
  id,
  a,
  b,
  offset,
  along,
  value,
  reference,
  preview,
  px,
  fontSize,
  palette,
  onEdit,
  onDrag,
  editingId,
}: DimensionHandlers & {
  a: Vec2;
  b: Vec2;
  offset: number;
  along?: number;
}) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.hypot(dx, dy) || 1;
  const nx = dy / length;
  const ny = -dx / length;
  const A: Vec2 = [a[0] + nx * offset, a[1] + ny * offset];
  const B: Vec2 = [b[0] + nx * offset, b[1] + ny * offset];
  const t = along ?? 0.5;
  const mid: Vec2 = [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t];
  const tick = 3.5 * px;
  const color = reference ? palette.dim : palette.dimension;
  const label = `${reference ? "(" : ""}${formatLength(value)}${reference ? ")" : ""}`;

  return (
    <g
      stroke={color}
      fill={color}
      opacity={preview ? 0.7 : 1}
      style={{ cursor: onEdit && !preview ? "grab" : "default" }}
      onPointerDown={(event) => {
        if (preview) return;
        event.stopPropagation();
        onDrag?.(event);
      }}
      onDoubleClick={
        onEdit && !preview
          ? (event) =>
              onEdit(event, id, value, reference, undefined, mid)
          : undefined
      }
    >
      <title>{`Dimension ${label}. Drag to move; double-click to edit.`}</title>
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
      {editingId !== id ? (
        <text
          x={mid[0]}
          y={mid[1] + fontSize * 0.35}
          fontSize={fontSize}
          textAnchor="middle"
          stroke={palette.halo}
          strokeWidth={3 * px}
          paintOrder="stroke"
          data-dimension-id={preview ? undefined : id}
          aria-label={`Dimension ${label}. Drag to move; double-click to edit.`}
          style={{ cursor: onEdit && !preview ? "grab" : "default" }}
          onPointerDown={(event) => {
            if (preview) return;
            event.stopPropagation();
            onDrag?.(event);
          }}
          onDoubleClick={
            onEdit && !preview
              ? (event) =>
                  onEdit(event, id, value, reference, undefined, mid)
              : undefined
          }
        >
          {label}
        </text>
      ) : null}
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
  palette,
  onEdit,
  onDrag,
  asRadius,
  arcStartAngle,
  arcSweep,
  distance,
  editingId,
}: DimensionHandlers & {
  center: Vec2;
  radius: number;
  angle: number;
  distance?: number;
  asRadius?: boolean;
  arcStartAngle?: number;
  arcSweep?: number;
}) {
  const rawTheta = (angle * Math.PI) / 180;
  const theta =
    arcStartAngle !== undefined && arcSweep !== undefined
      ? clampAngleToArc(rawTheta, arcStartAngle, arcSweep)
      : rawTheta;
  const dx = Math.cos(theta);
  const dy = Math.sin(theta);
  const leader = distance ?? 12;
  const start: Vec2 = [center[0] + dx * radius, center[1] + dy * radius];
  const end: Vec2 = [
    center[0] + dx * (radius + leader),
    center[1] + dy * (radius + leader),
  ];
  const textX = end[0] + dx * 1.5 * px;
  const textY = end[1] + dy * 1.5 * px + fontSize * 0.35;
  const anchor = dx < -0.3 ? "end" : dx > 0.3 ? "start" : "middle";
  const color = reference ? palette.dim : palette.dimension;
  const label = `${reference ? "(" : ""}${asRadius ? "R" : "⌀"} ${formatLength(value)}${reference ? ")" : ""}`;

  return (
    <g
      stroke={color}
      fill={color}
      opacity={preview ? 0.7 : 1}
      style={{ cursor: onEdit && !preview ? "grab" : "default" }}
      onPointerDown={(event) => {
        if (preview) return;
        event.stopPropagation();
        onDrag?.(event);
      }}
      onDoubleClick={
        onEdit && !preview
          ? (event) =>
              onEdit(event, id, value, reference, asRadius, [
                textX,
                textY - fontSize * 0.35,
              ])
          : undefined
      }
    >
      <title>{`Dimension ${label}. Drag to move; double-click to edit.`}</title>
      <line
        x1={start[0]}
        y1={start[1]}
        x2={end[0]}
        y2={end[1]}
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
      {editingId !== id ? (
        <text
          x={textX}
          y={textY}
          fontSize={fontSize}
          textAnchor={anchor}
          stroke={palette.halo}
          strokeWidth={3 * px}
          paintOrder="stroke"
          data-dimension-id={preview ? undefined : id}
          aria-label={`Dimension ${label}. Drag to move; double-click to edit.`}
          style={{ cursor: onEdit && !preview ? "grab" : "default" }}
          onPointerDown={(event) => {
            if (preview) return;
            event.stopPropagation();
            onDrag?.(event);
          }}
          onDoubleClick={
            onEdit && !preview
              ? (event) =>
                  onEdit(event, id, value, reference, asRadius, [
                    textX,
                    textY - fontSize * 0.35,
                  ])
              : undefined
          }
        >
          {label}
        </text>
      ) : null}
    </g>
  );
}

function AngleDimension({
  id,
  vertex,
  rayA,
  rayB,
  radius,
  value,
  reference,
  preview,
  px,
  fontSize,
  palette,
  onEdit,
  onDrag,
  editingId,
}: DimensionHandlers & { vertex: Vec2; rayA: Vec2; rayB: Vec2; radius: number }) {
  let startAngle = Math.atan2(rayA[1] - vertex[1], rayA[0] - vertex[0]);
  let endAngle = Math.atan2(rayB[1] - vertex[1], rayB[0] - vertex[0]);
  let sweep = normalizeAngle(endAngle - startAngle);
  if (sweep > Math.PI) {
    [startAngle, endAngle] = [endAngle, startAngle];
    sweep = Math.PI * 2 - sweep;
  }
  const start: Vec2 = [
    vertex[0] + Math.cos(startAngle) * radius,
    vertex[1] + Math.sin(startAngle) * radius,
  ];
  const end: Vec2 = [
    vertex[0] + Math.cos(endAngle) * radius,
    vertex[1] + Math.sin(endAngle) * radius,
  ];
  const labelAngle = startAngle + sweep / 2;
  const labelRadius = radius + 12 * px + fontSize * 0.5;
  const label: Vec2 = [
    vertex[0] + Math.cos(labelAngle) * labelRadius,
    vertex[1] + Math.sin(labelAngle) * labelRadius,
  ];
  const color = reference ? palette.dim : palette.dimension;
  const text = `${reference ? "(" : ""}${formatLength(value)}°${reference ? ")" : ""}`;

  return (
    <g
      stroke={color}
      fill={color}
      opacity={preview ? 0.7 : 1}
      style={{ cursor: onEdit && !preview ? "grab" : "default" }}
      onPointerDown={(event) => {
        if (preview) return;
        event.stopPropagation();
        onDrag?.(event);
      }}
      onDoubleClick={
        onEdit && !preview
          ? (event) =>
              onEdit(event, id, value, reference, undefined, label)
          : undefined
      }
    >
      <title>{`Dimension ${text}. Drag to move; double-click to edit.`}</title>
      <line
        x1={vertex[0]}
        y1={vertex[1]}
        x2={start[0]}
        y2={start[1]}
        strokeWidth={0.8}
        opacity={0.55}
        vectorEffect="non-scaling-stroke"
      />
      <line
        x1={vertex[0]}
        y1={vertex[1]}
        x2={end[0]}
        y2={end[1]}
        strokeWidth={0.8}
        opacity={0.55}
        vectorEffect="non-scaling-stroke"
      />
      <path
        d={`M ${start[0]} ${start[1]} A ${radius} ${radius} 0 0 1 ${end[0]} ${end[1]}`}
        fill="none"
        strokeWidth={1.1}
        vectorEffect="non-scaling-stroke"
      />
      {editingId !== id ? (
        <text
          x={label[0]}
          y={label[1] + fontSize * 0.35}
          fontSize={fontSize}
          textAnchor="middle"
          stroke={palette.halo}
          strokeWidth={3 * px}
          paintOrder="stroke"
          data-dimension-id={preview ? undefined : id}
          aria-label={`Dimension ${text}. Drag to move; double-click to edit.`}
          style={{ cursor: onEdit && !preview ? "grab" : "default" }}
          onPointerDown={(event) => {
            if (preview) return;
            event.stopPropagation();
            onDrag?.(event);
          }}
          onDoubleClick={
            onEdit && !preview
              ? (event) =>
                  onEdit(event, id, value, reference, undefined, label)
              : undefined
          }
        >
          {text}
        </text>
      ) : null}
    </g>
  );
}

function angleBetweenVectors(vertex: Vec2, a: Vec2, b: Vec2): number {
  const angleA = Math.atan2(a[1] - vertex[1], a[0] - vertex[0]);
  const angleB = Math.atan2(b[1] - vertex[1], b[0] - vertex[0]);
  let sweep = normalizeAngle(angleB - angleA);
  if (sweep > Math.PI) sweep = Math.PI * 2 - sweep;
  return (sweep * 180) / Math.PI;
}

function ConstraintBadges({
  sketch,
  points,
  palette,
  px,
}: {
  sketch: Sketch;
  points: Record<string, Vec2>;
  palette: SketchPalette;
  px: number;
}) {
  const curves = new Map(sketch.curves.map((curve) => [curve.id, curve]));
  const stacks = new Map<string, number>();
  const badges: {
    key: string;
    id: string;
    type: string;
    x: number;
    y: number;
    label: string;
  }[] = [];

  const baseFor = (id: string): { x: number; y: number } | null => {
    const curve = curves.get(id);
    if (!curve) {
      const point = points[id];
      return point ? { x: point[0], y: point[1] } : null;
    }
    if (curve.type === "line") {
      const a = points[curve.a];
      const b = points[curve.b];
      return a && b ? { x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2 } : null;
    }
    if (curve.type === "arc") {
      const geometry = arcGeometry(curve, points);
      if (!geometry) return null;
      const [x, y] = arcPointAt(geometry, 0.5);
      return { x, y };
    }
    const center = points[curve.center];
    const radius = curveRadius(curve, points, {});
    return center && radius !== null
      ? { x: center[0], y: center[1] - radius }
      : null;
  };

  const place = (constraintId: string, type: string, id: string, label: string) => {
    const base = baseFor(id);
    if (!base) return;
    const index = stacks.get(id) ?? 0;
    stacks.set(id, index + 1);
    badges.push({
      key: `${constraintId}:${id}`,
      id: constraintId,
      type,
      x: base.x,
      y: base.y - 5 * px - index * 9 * px,
      label,
    });
  };

  for (const constraint of sketch.constraints) {
    switch (constraint.type) {
      case "horizontal":
        place(constraint.id, "horizontal", constraint.line, "H");
        break;
      case "vertical":
        place(constraint.id, "vertical", constraint.line, "V");
        break;
      case "parallel":
      case "perpendicular":
      case "equal": {
        const label =
          constraint.type === "parallel" ? "∥" : constraint.type === "perpendicular" ? "⊥" : "=";
        place(constraint.id, constraint.type, constraint.a, label);
        place(constraint.id, constraint.type, constraint.b, label);
        break;
      }
      case "pointOnLine":
        place(constraint.id, "pointOnLine", constraint.point, "∈");
        break;
      case "pointOnCircle":
        place(constraint.id, "pointOnCircle", constraint.point, "○");
        break;
      case "midpoint":
        place(constraint.id, "midpoint", constraint.point, "M");
        break;
      case "fix":
        place(constraint.id, "fix", constraint.point, "F");
        break;
      case "symmetric":
        place(constraint.id, "symmetric", constraint.a, "⇄");
        place(constraint.id, "symmetric", constraint.b, "⇄");
        break;
      case "tangent":
        place(constraint.id, "tangent", constraint.a, "T");
        place(constraint.id, "tangent", constraint.b, "T");
        break;
      default:
        break;
    }
  }

  return (
    <g fontSize={8 * px} fill={palette.badge} textAnchor="middle" pointerEvents="none">
      {badges.map((badge) => (
        <text
          key={badge.key}
          x={badge.x}
          y={badge.y}
          stroke={palette.halo}
          strokeWidth={2.5 * px}
          paintOrder="stroke"
          data-constraint-id={badge.id}
          data-constraint-type={badge.type}
        >
          {badge.label}
        </text>
      ))}
    </g>
  );
}

function makeGrid(box: ViewBox, step: number, scale: number) {
  const lines: { key: string; x1: number; y1: number; x2: number; y2: number; major: boolean }[] =
    [];
  // A manual step can be too dense to read; hide the grid rather than turning
  // the page into wallpaper.
  if (!Number.isFinite(step) || step <= 0 || step * scale < 2) return lines;
  const minorVisible = step * scale >= 5;
  const x0 = Math.floor(box.x / step) * step;
  const x1 = box.x + box.w;
  const y0 = Math.floor(box.y / step) * step;
  const y1 = box.y + box.h;

  for (let x = x0, i = 0; x <= x1 && i < 1000; x += step, i++) {
    const major = Math.round(x / step) % MAJOR_EVERY === 0;
    if (!minorVisible && !major) continue;
    lines.push({ key: `x${x}`, x1: x, y1: box.y, x2: x, y2: y1, major });
  }
  for (let y = y0, i = 0; y <= y1 && i < 1000; y += step, i++) {
    const major = Math.round(y / step) % MAJOR_EVERY === 0;
    if (!minorVisible && !major) continue;
    lines.push({ key: `y${y}`, x1: box.x, y1: y, x2: x1, y2: y, major });
  }
  return lines;
}

interface SketchExtent {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  origin: Vec2 | null;
}

function sketchExtent(
  sketch: Sketch,
  radii: Record<string, number>,
): SketchExtent | null {
  // An empty sketch gets the fixed 100 mm default view, not a tiny box around
  // the reference origin: that box would zoom the grid in and change snapping.
  if (sketch.points.length === 0 && sketch.curves.length === 0) return null;
  const xs = sketch.points.map((point) => point.x);
  const ys = sketch.points.map((point) => point.y);
  const origin = sketch.references?.origin;
  if (origin) {
    xs.push(origin.x);
    ys.push(origin.y);
  }
  for (const curve of sketch.curves) {
    if (curve.type === "circle") {
      const center = sketch.points.find((point) => point.id === curve.center);
      if (!center) continue;
      const radius = radii[curve.id] ?? curve.radius;
      xs.push(center.x - radius, center.x + radius);
      ys.push(center.y - radius, center.y + radius);
    } else if (curve.type === "arc") {
      const center = sketch.points.find((point) => point.id === curve.center);
      const start = sketch.points.find((point) => point.id === curve.start);
      if (!center || !start) continue;
      const radius = Math.hypot(start.x - center.x, start.y - center.y);
      xs.push(center.x - radius, center.x + radius);
      ys.push(center.y - radius, center.y + radius);
    }
  }
  if (xs.length === 0 || ys.length === 0) return null;
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
    origin: origin ? [origin.x, origin.y] : null,
  };
}

function fitView(sketch: Sketch, radii: Record<string, number>): ViewBox {
  const extent = sketchExtent(sketch, radii);
  if (!extent) return { x: -50, y: -50, w: 100, h: 100 };
  const span = Math.max(extent.maxX - extent.minX, extent.maxY - extent.minY, 20);
  const pad = span * 0.45 + 10;
  return {
    x: extent.minX - pad,
    y: extent.minY - pad,
    w: span + pad * 2,
    h: span + pad * 2,
  };
}

/**
 * The first view of a sketch centres the plane origin, not the geometry's
 * bounding box. The view is still large enough to contain every point, curve
 * and dimension anchor, so the whole sketch stays visible. Explicit Fit/zoom
 * changes replace this with a normal geometry fit.
 */
function originCenteredView(
  sketch: Sketch,
  radii: Record<string, number>,
): ViewBox {
  const extent = sketchExtent(sketch, radii);
  if (!extent || !extent.origin) return fitView(sketch, radii);
  const [ox, oy] = extent.origin;
  const spanX = Math.max(
    Math.abs(extent.minX - ox),
    Math.abs(extent.maxX - ox),
    10,
  );
  const spanY = Math.max(
    Math.abs(extent.minY - oy),
    Math.abs(extent.maxY - oy),
    10,
  );
  const span = Math.max(spanX, spanY);
  const half = span * 1.2 + 10;
  return { x: ox - half, y: oy - half, w: half * 2, h: half * 2 };
}

/** Expand a viewBox to the stage aspect so the grid covers the letterbox. */
function withCanvasAspect(
  box: ViewBox,
  width: number,
  height: number,
): ViewBox {
  if (!width || !height) return box;
  const aspect = width / height;
  const boxAspect = box.w / box.h;
  if (
    !Number.isFinite(aspect) ||
    !Number.isFinite(boxAspect) ||
    boxAspect <= 0 ||
    aspect <= 0
  ) {
    return box;
  }
  if (boxAspect < aspect) {
    const w = box.h * aspect;
    return { ...box, x: box.x - (w - box.w) / 2, w };
  }
  const h = box.w / aspect;
  return { ...box, y: box.y - (h - box.h) / 2, h };
}

function normalizeRect(a: Vec2, b: Vec2) {
  return {
    x: Math.min(a[0], b[0]),
    y: Math.min(a[1], b[1]),
    w: Math.abs(b[0] - a[0]),
    h: Math.abs(b[1] - a[1]),
  };
}

function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function PointInlineEditor({
  id,
  x,
  y,
  screen,
  onSet,
}: {
  id: string;
  x: number;
  y: number;
  screen: { x: number; y: number };
  onSet: (pointId: string, x: number, y: number) => void;
}) {
  const [xText, setXText] = useState(() => formatEditable(x));
  const [yText, setYText] = useState(() => formatEditable(y));

  const reset = (): void => {
    setXText(formatEditable(x));
    setYText(formatEditable(y));
  };

  const commit = (): void => {
    const nextX = Number(xText);
    const nextY = Number(yText);
    if (!Number.isFinite(nextX) || !Number.isFinite(nextY)) return;
    if (nextX !== x || nextY !== y) onSet(id, nextX, nextY);
  };

  return (
    <div
      className="dim-editor point-inline-editor"
      style={{ left: screen.x, top: screen.y - 12 }}
      data-testid="point-position"
      onBlur={(event) => {
        const next = event.relatedTarget as Node | null;
        if (!next || !event.currentTarget.contains(next)) reset();
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <label className="point-field">
        <span>X</span>
        <input
          autoFocus
          value={xText}
          inputMode="decimal"
          data-testid="point-x"
          aria-label="Point X"
          onChange={(event) => setXText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            } else if (event.key === "Escape") {
              event.preventDefault();
              reset();
            }
          }}
        />
      </label>
      <label className="point-field">
        <span>Y</span>
        <input
          value={yText}
          inputMode="decimal"
          data-testid="point-y"
          aria-label="Point Y"
          onChange={(event) => setYText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            } else if (event.key === "Escape") {
              event.preventDefault();
              reset();
            }
          }}
        />
      </label>
      <span className="dim-unit">mm</span>
    </div>
  );
}

function projectPointOnLine(a: Vec2, b: Vec2, point: Vec2): Vec2 {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < 1e-12) return a;
  const t = ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSquared;
  return [a[0] + dx * t, a[1] + dy * t];
}

/** Closest point on the segment itself, not its infinite extension. */
function projectPointOnSegment(a: Vec2, b: Vec2, point: Vec2): Vec2 {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < 1e-12) return a;
  const t = Math.max(
    0,
    Math.min(
      1,
      ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSquared,
    ),
  );
  return [a[0] + dx * t, a[1] + dy * t];
}

function lineIntersection(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): Vec2 | null {
  const dax = a2[0] - a1[0];
  const day = a2[1] - a1[1];
  const dbx = b2[0] - b1[0];
  const dby = b2[1] - b1[1];
  const denominator = dax * dby - day * dbx;
  if (Math.abs(denominator) < 1e-9) return null;
  const t = ((b1[0] - a1[0]) * dby - (b1[1] - a1[1]) * dbx) / denominator;
  return [a1[0] + dax * t, a1[1] + day * t];
}


function arcPathData(arc: SketchArc, points: Record<string, Vec2>): string | null {
  const geometry = arcGeometry(arc, points);
  const start = points[arc.start];
  const end = points[arc.end];
  if (!geometry || !start || !end) return null;
  const large = geometry.sweep > Math.PI ? 1 : 0;
  return `M ${start[0]} ${start[1]} A ${geometry.radius} ${geometry.radius} 0 ${large} 1 ${end[0]} ${end[1]}`;
}

function arcThroughPath(
  start: Vec2,
  end: Vec2,
  through: Vec2,
): { d: string; center: Vec2; radius: number } | null {
  const center = circumcenter(start, end, through);
  if (!center) return null;
  const radius = Math.hypot(start[0] - center[0], start[1] - center[1]);
  if (radius < 1) return null;
  const startAngle = Math.atan2(start[1] - center[1], start[0] - center[0]);
  const endAngle = Math.atan2(end[1] - center[1], end[0] - center[0]);
  const throughAngle = Math.atan2(through[1] - center[1], through[0] - center[0]);
  let sweep = normalizeAngle(endAngle - startAngle);
  const throughOffset = normalizeAngle(throughAngle - startAngle);
  const swap = throughOffset > sweep + 1e-9;
  if (swap) sweep = Math.PI * 2 - sweep;
  const from = swap ? end : start;
  const to = swap ? start : end;
  const large = sweep > Math.PI ? 1 : 0;
  return {
    d: `M ${from[0]} ${from[1]} A ${radius} ${radius} 0 ${large} 1 ${to[0]} ${to[1]}`,
    center,
    radius,
  };
}


function regionPathData(region: SketchRegion): string {
  return [region.outer, ...region.holes].map(loopPathData).join("");
}

function loopPathData(loop: ProfileLoop): string {
  if (loop.kind === "circle") {
    const [cx, cy] = loop.center;
    const r = loop.radius;
    return [
      `M ${cx - r} ${cy}`,
      `A ${r} ${r} 0 1 1 ${cx + r} ${cy}`,
      `A ${r} ${r} 0 1 1 ${cx - r} ${cy}`,
      "Z",
    ].join(" ");
  }
  if (loop.kind === "polygon") {
    if (loop.points.length < 3) return "";
    return [
      `M ${loop.points[0]![0]} ${loop.points[0]![1]}`,
      ...loop.points.slice(1).map((point) => `L ${point[0]} ${point[1]}`),
      "Z",
    ].join(" ");
  }
  if (loop.segments.length === 0) return "";
  const first = loop.segments[0]!;
  const parts: string[] = [];
  const startPoint = first.kind === "line" ? first.a : first.start;
  parts.push(`M ${startPoint[0]} ${startPoint[1]}`);
  for (const segment of loop.segments) {
    if (segment.kind === "line") {
      parts.push(`L ${segment.b[0]} ${segment.b[1]}`);
      continue;
    }
    const startAngle = Math.atan2(
      segment.start[1] - segment.center[1],
      segment.start[0] - segment.center[0],
    );
    const endAngle = Math.atan2(
      segment.end[1] - segment.center[1],
      segment.end[0] - segment.center[0],
    );
    const midAngle = Math.atan2(
      segment.mid[1] - segment.center[1],
      segment.mid[0] - segment.center[0],
    );
    const sweep = normalizeAngle(endAngle - startAngle);
    const through = normalizeAngle(midAngle - startAngle);
    const ccw = through <= sweep + 1e-9;
    const usedSweep = ccw ? sweep : Math.PI * 2 - sweep;
    const large = usedSweep > Math.PI ? 1 : 0;
    parts.push(
      `A ${segment.radius} ${segment.radius} 0 ${large} ${ccw ? 1 : 0} ${segment.end[0]} ${segment.end[1]}`,
    );
  }
  parts.push("Z");
  return parts.join(" ");
}
