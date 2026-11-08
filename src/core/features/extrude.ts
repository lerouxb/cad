import type { ExtrudeParams, ProfileRegion } from "../kernel/protocol";
import { ensureCounterClockwise, signedArea } from "../sketch/geometry";
import type { SketchRegion } from "../sketch/loops";
import type { PlaneFrame, ProfileLoop, ProfileSegment } from "../types";

export interface ExtrudeRegionSelection {
  /** Region ids actually used, in canvas/area order. */
  ids: string[];
  regions: SketchRegion[];
  /** True when no explicit selection survived and the largest material face won. */
  auto: boolean;
  /** True when some stored ids no longer exist on the current sketch. */
  stale: boolean;
}

/**
 * Resolve an extrude's stored region ids against the current sketch.
 *
 * Empty or stale selections fall back to the largest material face, never to a
 * void face: a thin frame around a huge hole is still a frame. Explicit void
 * ids are honored exactly like material ids.
 */
export function selectExtrudeRegions(
  all: readonly SketchRegion[],
  stored: readonly string[],
): ExtrudeRegionSelection {
  const wanted = new Set(stored);
  const valid = all.filter((region) => wanted.has(region.id));
  if (valid.length > 0) {
    return {
      ids: valid.map((region) => region.id),
      regions: valid,
      auto: false,
      stale: valid.length !== wanted.size,
    };
  }

  const fallback = all.find((region) => region.kind === "material") ?? all[0];
  return {
    ids: fallback ? [fallback.id] : [],
    regions: fallback ? [fallback] : [],
    auto: true,
    stale: stored.length > 0,
  };
}

/** Turn selected sketch regions into kernel input. */
export function extrudeParams(
  regions: readonly SketchRegion[],
  height: number,
  options: {
    symmetric?: boolean;
    end?: "blind" | "throughAll";
    frame?: PlaneFrame;
  } = {},
): ExtrudeParams {
  return {
    regions: regions.map(
      (region): ProfileRegion => ({
        outer: counterClockwiseLoop(region.outer),
        holes: region.holes.map(counterClockwiseLoop),
      }),
    ),
    height,
    ...(options.symmetric ? { symmetric: true } : {}),
    ...(options.end === "throughAll" ? { end: "throughAll" } : {}),
    ...(options.frame ? { frame: options.frame } : {}),
  };
}


export function counterClockwiseLoop(loop: ProfileLoop): ProfileLoop {
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
