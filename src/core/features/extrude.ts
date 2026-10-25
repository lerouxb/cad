import type { ExtrudeParams } from "../kernel/protocol";
import type { DemoModel } from "../sketch/demo";
import { ensureCounterClockwise, type SolvedGeometry } from "../sketch/geometry";
import type { Sketch } from "../sketch/types";
import type { Vec2 } from "../types";

/**
 * Turn the spike's solved sketch into kernel input.
 *
 * Demo-only: the loop order comes from the demo model. M2 replaces the loop
 * list with real cycle extraction from the sketch graph.
 */
export function extrudeParamsFromDemo(
  model: DemoModel,
  sketch: Sketch,
  solved: SolvedGeometry,
  height: number,
): ExtrudeParams | null {
  const outer = model.loop
    .map((id) => solved.points[id])
    .filter((point): point is Vec2 => Boolean(point));

  if (outer.length < 3) return null;

  const holeCurve = sketch.curves.find(
    (curve) => curve.id === model.hole && curve.type === "circle",
  );
  if (!holeCurve || holeCurve.type !== "circle") return null;

  const center = solved.points[holeCurve.center];
  const radius = solved.radii[holeCurve.id];
  if (!center || radius === undefined) return null;

  return {
    outer: { kind: "polygon", points: ensureCounterClockwise(outer) },
    holes: [{ kind: "circle", center, radius }],
    height,
  };
}
