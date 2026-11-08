import type { ProfileRegion, RevolveParams } from "../kernel/protocol";
import { counterClockwiseLoop } from "./extrude";
import type { SketchRegion } from "../sketch/loops";
import type { PlaneFrame, ProfileLoop, Vec2 } from "../types";

/** Turn selected sketch regions and a local axis into kernel input. */
export function revolveParams(
  regions: readonly SketchRegion[],
  axis: { at: Vec2; direction: Vec2 },
  angle: number,
  direction: "ccw" | "cw",
  frame?: PlaneFrame,
): RevolveParams {
  return {
    regions: regions.map(
      (region): ProfileRegion => ({
        outer: counterClockwiseLoop(region.outer),
        holes: region.holes.map(counterClockwiseLoop),
      }),
    ),
    axis,
    angle,
    direction,
    ...(frame ? { frame } : {}),
  };
}

/**
 * A revolve profile must stay on one side of the infinite axis, or touch it.
 * Return the visible error text when any selected region crosses it.
 */
export function revolveProfileError(
  regions: readonly SketchRegion[],
  axis: { at: Vec2; direction: Vec2 },
): string | null {
  if (
    Math.abs(axis.direction[0]) < 1e-9 &&
    Math.abs(axis.direction[1]) < 1e-9
  ) {
    return "The revolve axis has no length.";
  }
  for (const region of regions) {
    let positive = false;
    let negative = false;
    for (const loop of [region.outer, ...region.holes]) {
      for (const point of loopSamplePoints(loop)) {
        const cross =
          axis.direction[0] * (point[1] - axis.at[1]) -
          axis.direction[1] * (point[0] - axis.at[0]);
        if (cross > 1e-6) positive = true;
        else if (cross < -1e-6) negative = true;
        if (positive && negative) {
          return "The revolve profile crosses the axis; keep it on one side or touching.";
        }
      }
    }
  }
  return null;
}

function loopSamplePoints(loop: ProfileLoop): Vec2[] {
  if (loop.kind === "circle") {
    const points: Vec2[] = [];
    for (let index = 0; index < 32; index += 1) {
      const angle = (index / 32) * Math.PI * 2;
      points.push([
        loop.center[0] + Math.cos(angle) * loop.radius,
        loop.center[1] + Math.sin(angle) * loop.radius,
      ]);
    }
    return points;
  }
  return loop.points;
}
