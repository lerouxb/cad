import type { Vec2 } from "../types";
import { sketchGeometry } from "./geometry";
import type { Sketch, SketchConstraint } from "./types";

/**
 * The spike's single built-in sketch: a rectangle anchored at the origin with a
 * concentric circular hole.
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
    { id: "h-bottom", type: "horizontal", line: "l-bottom" },
    { id: "v-right", type: "vertical", line: "l-right" },
    { id: "h-top", type: "horizontal", line: "l-top" },
    { id: "v-left", type: "vertical", line: "l-left" },
    { id: "at-origin", type: "coincident", a: "p0", b: "origin" },
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
    sketch: {
      points: [
        { id: "p0", x: 0, y: 0 },
        { id: "p1", x: width, y: 0 },
        { id: "p2", x: width, y: height },
        { id: "p3", x: 0, y: height },
        { id: "origin", x: 0, y: 0, fixed: true },
        // Hole centre: held at the midpoint of the p0–p2 diagonal, so it stays
        // centred when the rectangle is resized or dragged.
        { id: "hole-center", x: width / 2, y: height / 2, construction: true },
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
    },
  };
}

export const DEMO_MIN_SIZE = 20;
export const DEMO_MAX_WIDTH = 110;
export const DEMO_MAX_HEIGHT = 90;

/**
 * Keep the demo rectangle (and therefore its hole) valid while dragging.
 *
 * The rectangle is anchored at p0, so p1 controls width, p2 both, and p3 height.
 * Clamping the cursor target before solving means the corner simply stops at the
 * limit instead of the solver collapsing the profile or the hole leaving the
 * boundary. A real sketcher gets this from constraints, not from a clamp.
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

  const min = Math.max(DEMO_MIN_SIZE, holeDiameter + 6);
  const clampX = (x: number): number =>
    Math.min(p0[0] + DEMO_MAX_WIDTH, Math.max(p0[0] + min, x));
  const clampY = (y: number): number =>
    Math.min(p0[1] + DEMO_MAX_HEIGHT, Math.max(p0[1] + min, y));

  switch (pointId) {
    case "p1":
      return [clampX(target[0]), p1[1]];
    case "p2":
      return [clampX(target[0]), clampY(target[1])];
    case "p3":
      return [p3[0], clampY(target[1])];
    default:
      return target;
  }
}
