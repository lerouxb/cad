import type { ExtrudeParams } from "../kernel/protocol";
import { ensureCounterClockwise } from "../sketch/geometry";
import type { SketchProfile } from "../sketch/loops";

/**
 * Turn a solved sketch profile into kernel input: the outer loop plus holes.
 *
 * M2 replaces "largest loop" with explicit region selection.
 */
export function extrudeParams(profile: SketchProfile, height: number): ExtrudeParams {
  return {
    outer:
      profile.outer.kind === "polygon"
        ? { kind: "polygon", points: ensureCounterClockwise(profile.outer.points) }
        : profile.outer,
    holes: profile.holes,
    height,
  };
}
