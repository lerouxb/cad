import type { ExtrudeParams } from "../kernel/protocol";
import { ensureCounterClockwise, signedArea } from "../sketch/geometry";
import type { SketchProfile } from "../sketch/loops";
import type { ProfileLoop, ProfileSegment } from "../types";

/**
 * Turn a solved sketch profile into kernel input: the outer loop plus holes.
 *
 * M2 replaces "largest loop" with explicit region selection.
 */
export function extrudeParams(profile: SketchProfile, height: number): ExtrudeParams {
  return {
    outer: counterClockwiseLoop(profile.outer),
    holes: profile.holes.map(counterClockwiseLoop),
    height,
  };
}


function counterClockwiseLoop(loop: ProfileLoop): ProfileLoop {
  if (loop.kind === "circle") return loop;
  if (loop.kind === "polygon") {
    return { kind: "polygon", points: ensureCounterClockwise(loop.points) };
  }
  if (signedArea(loop.points) >= 0) return loop;
  return {
    kind: "path",
    points: [...loop.points].reverse(),
    segments: loop.segments.map(reverseSegment),
  };
}

function reverseSegment(segment: ProfileSegment): ProfileSegment {
  return segment.kind === "line"
    ? { kind: "line", a: segment.b, b: segment.a }
    : {
        kind: "arc",
        center: segment.center,
        radius: segment.radius,
        start: segment.end,
        end: segment.start,
        mid: segment.mid,
      };
}
