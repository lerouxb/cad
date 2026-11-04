import type { Vec2 } from "../types";
import { withReferences } from "./create";
import { sketchGeometry } from "./geometry";
import type { Sketch, SketchConstraint } from "./types";

/**
 * The spike's single built-in sketch: a rectangle centred on the origin with a
 * concentric circular hole. The rectangle's opposite edges are held symmetric
 * about the reference axes, so resizing keeps the origin at its centre.
 *
 * This is deliberately hand-authored rather than drawn. M1 replaces it with a
 * real sketcher; M2 replaces the fixed loop order with loop finding.
 */
export interface DemoModel {
  sketch: Sketch;
  /** Point ids in boundary order (the outer profile). */
  loop: string[];
  /** Circle curve id used as a hole. */
  hole: string;
}

export interface DemoOptions {
  width: number;
  height: number;
  holeDiameter: number;
  /** Driving width/height dimensions that make the sketch fully constrained. */
  constrained: boolean;
}

export const DEMO_DEFAULTS: DemoOptions = {
  width: 60,
  height: 40,
  holeDiameter: 16,
  constrained: false,
};

/** The starting sketch: the example, fully dimensioned. */
export function createExampleModel(): DemoModel {
  return createDemoModel({ ...DEMO_DEFAULTS, constrained: true });
}

/** True while the sketch still contains the example's rectangle corners. */
export function isDemoSketch(sketch: Sketch): boolean {
  return ["p0", "p1", "p2", "p3"].every((id) =>
    sketch.points.some((point) => point.id === id),
  );
}

export function createDemoModel(options: DemoOptions = DEMO_DEFAULTS): DemoModel {
  const { width, height, holeDiameter, constrained } = options;
  const half = holeDiameter / 2;

  const constraints: SketchConstraint[] = [
    // The rectangle is centred on the origin: the left/right edges mirror about
    // the Y axis and the top/bottom edges mirror about the X axis. These are the
    // same two point-pair constraints the two-edge Symmetric action creates.
    // They also imply the four axis-aligned edges, so explicit H/V constraints
    // would be redundant and make the sketch solve as "redundant".
    { id: "sym-bottom", type: "symmetric", a: "p0", b: "p1", about: "axis-y" },
    { id: "sym-top", type: "symmetric", a: "p3", b: "p2", about: "axis-y" },
    { id: "sym-left", type: "symmetric", a: "p0", b: "p3", about: "axis-x" },
    // The right-edge pair (p1,p2 about X) is implied by the three above; adding
    // it as a fourth constraint would make the system redundant.
    // The hole centre is the midpoint of the construction diagonal, which is
    // the rectangle centre and therefore the origin for a symmetric rectangle.
    { id: "hole-centered", type: "midpoint", point: "hole-center", line: "diagonal" },
    { id: "hole-diameter", type: "diameter", circle: "hole", value: holeDiameter },
  ];

  if (constrained) {
    constraints.push(
      { id: "dim-width", type: "distance", a: "p0", b: "p1", value: width, offset: 16 },
      { id: "dim-height", type: "distance", a: "p1", b: "p2", value: height, offset: 16 },
    );
  }

  return {
    loop: ["p0", "p1", "p2", "p3"],
    hole: "hole",
    sketch: withReferences({
      points: [
        { id: "p0", x: -width / 2, y: -height / 2 },
        { id: "p1", x: width / 2, y: -height / 2 },
        { id: "p2", x: width / 2, y: height / 2 },
        { id: "p3", x: -width / 2, y: height / 2 },
        // Hole centre: the midpoint of the p0–p2 diagonal, i.e. the origin.
        { id: "hole-center", x: 0, y: 0, construction: true },
      ],
      curves: [
        { id: "l-bottom", type: "line", a: "p0", b: "p1" },
        { id: "l-right", type: "line", a: "p1", b: "p2" },
        { id: "l-top", type: "line", a: "p2", b: "p3" },
        { id: "l-left", type: "line", a: "p3", b: "p0" },
        { id: "diagonal", type: "line", a: "p0", b: "p2", construction: true },
        { id: "hole", type: "circle", center: "hole-center", radius: half },
      ],
      constraints,
    }),
  };
}

export const DEMO_MIN_SIZE = 20;
export const DEMO_MAX_WIDTH = 110;
export const DEMO_MAX_HEIGHT = 90;

/**
 * Keep the demo rectangle (and therefore its hole) valid while dragging.
 *
 * The rectangle is centred on the origin, so each corner controls half of the
 * axis distances (p1 width, p2 both, p3 height, p0 both). Clamping the cursor
 * target before solving means the corner stops at the limit instead of the
 * solver collapsing the profile or the hole leaving the boundary. A real
 * sketcher gets this from constraints, not from a clamp.
 */
export function clampDemoDrag(sketch: Sketch, pointId: string, target: Vec2): Vec2 {
  const points = sketchGeometry(sketch).points;
  const circle = sketch.curves.find((curve) => curve.type === "circle");
  const holeDiameter = circle && circle.type === "circle" ? circle.radius * 2 : 0;
  const p0 = points.p0;
  const p1 = points.p1;
  const p2 = points.p2;
  const p3 = points.p3;
  if (!p0 || !p1 || !p2 || !p3) return target;

  const halfMin = Math.max(DEMO_MIN_SIZE, holeDiameter + 6) / 2;
  const halfMaxWidth = DEMO_MAX_WIDTH / 2;
  const halfMaxHeight = DEMO_MAX_HEIGHT / 2;
  const clampSide = (
    value: number,
    sign: 1 | -1,
    max: number,
  ): number => {
    const sameSide = Math.sign(value) === sign || value === 0;
    const magnitude = sameSide
      ? Math.min(max, Math.max(halfMin, Math.abs(value)))
      : halfMin;
    return sign === 1 ? magnitude : -magnitude;
  };

  switch (pointId) {
    case "p0":
      return [
        clampSide(target[0], -1, halfMaxWidth),
        clampSide(target[1], -1, halfMaxHeight),
      ];
    case "p1":
      return [clampSide(target[0], 1, halfMaxWidth), p1[1]];
    case "p2":
      return [
        clampSide(target[0], 1, halfMaxWidth),
        clampSide(target[1], 1, halfMaxHeight),
      ];
    case "p3":
      return [p3[0], clampSide(target[1], 1, halfMaxHeight)];
    default:
      return target;
  }
}
