import type { ExtrudeParams, ProfileRegion } from "../kernel/protocol";
import { ensureCounterClockwise, signedArea } from "../sketch/geometry";
import type { SketchRegion } from "../sketch/loops";
import type { ProfileLoop, ProfileSegment } from "../types";

/** Turn selected sketch regions into kernel input. */
export function extrudeParams(
  regions: readonly SketchRegion[],
  height: number,
): ExtrudeParams {
  return {
    regions: regions.map(
      (region): ProfileRegion => ({
        outer: counterClockwiseLoop(region.outer),
        holes: region.holes.map(counterClockwiseLoop),
      }),
    ),
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
