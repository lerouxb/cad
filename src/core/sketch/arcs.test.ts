import { beforeAll, describe, expect, it } from "vitest";
import { addArc, addFillet, addPolyline, addRectangle, emptySketch } from "./create";
import { addDimension } from "./dimensions";
import { deleteEntities } from "./edit";
import {
  applySolution,
  arcGeometry,
  arcPointAt,
  curveRadius,
  distance,
  updateConstraintValue,
} from "./geometry";
import { profileFromSketch } from "./loops";
import { initSolver, solveDrag, solveSketch } from "./solver";
import type { Sketch } from "./types";

function radius(sketch: Sketch, id: string): number | null {
  const arc = sketch.curves.find((curve) => curve.id === id);
  if (!arc) return null;
  return curveRadius(arc, solutionPoints(sketch));
}

function solutionPoints(sketch: Sketch): Record<string, [number, number]> {
  return Object.fromEntries(sketch.points.map((point) => [point.id, [point.x, point.y]]));
}

function arc(sketch: Sketch) {
  const curve = sketch.curves.find((candidate) => candidate.type === "arc");
  if (!curve || curve.type !== "arc") throw new Error("expected an arc");
  return curve;
}

describe("arcs", () => {
  beforeAll(async () => {
    await initSolver();
  });

  it("creates a three-point arc through the clicked point", () => {
    const sketch = addArc(
      emptySketch(),
      { point: [0, 0] },
      { point: [40, 0] },
      [20, 20],
    );
    const solved = solveSketch(sketch);
    expect(solved.ok).toBe(true);
    const geometry = arc(sketch);
    const center = solved.points[geometry.center]!;
    expect(center[0]).toBeCloseTo(20, 4);
    expect(center[1]).toBeCloseTo(0, 4);
    expect(radius(applySolution(sketch, solved), geometry.id)).toBeCloseTo(20, 4);
    // The clicked through point lies on the stored CCW start -> end sweep.
    const applied = applySolution(sketch, solved);
    const arcValue = arcGeometry(geometry, solutionPoints(applied));
    expect(arcValue).not.toBeNull();
    let closest = Infinity;
    for (let i = 0; i <= 100; i++) {
      const point = arcPointAt(arcValue!, i / 100);
      closest = Math.min(closest, distance(point, [20, 20]));
    }
    expect(closest).toBeCloseTo(0, 3);
  });

  it("drives an arc with a diameter dimension", () => {
    const sketch = addArc(
      emptySketch(),
      { point: [0, 0] },
      { point: [40, 0] },
      [20, 20],
    );
    const geometry = arc(sketch);
    const withDimension: Sketch = {
      ...sketch,
      constraints: [
        { id: "d", type: "diameter", circle: geometry.id, value: 50 },
      ],
    };
    const solved = solveSketch(withDimension);
    expect(solved.ok).toBe(true);
    const applied = applySolution(withDimension, solved);
    expect(radius(applied, geometry.id)).toBeCloseTo(25, 4);
  });

  it("adds a radius dimension to a free arc", () => {
    const sketch = addArc(
      emptySketch(),
      { point: [0, 0] },
      { point: [40, 0] },
      [20, 20],
    );
    const geometry = arc(sketch);
    const dimensioned = addDimension(
      sketch,
      { kind: "radius", circle: geometry.id },
      true,
      { angle: 30 },
    );
    const dimension = dimensioned.constraints.find(
      (c) => c.type === "diameter" && c.circle === geometry.id,
    );
    expect(dimension).toMatchObject({ radius: true, value: 40 });
    const solved = solveSketch(dimensioned);
    expect(solved.ok).toBe(true);
    expect(radius(applySolution(dimensioned, solved), geometry.id)).toBeCloseTo(20, 4);
  });

  it("keeps an arc endpoint on the circle while dragging", () => {
    const sketch = addArc(
      emptySketch(),
      { point: [0, 0] },
      { point: [40, 0] },
      [20, 20],
    );
    const geometry = arc(sketch);
    const solved = solveSketch(sketch);
    const settled = applySolution(sketch, solved);
    const target = solved.points[geometry.end]!;
    const dragged = solveDrag(settled, {
      pointId: geometry.end,
      x: target[0] + 8,
      y: target[1] + 6,
    });
    expect(dragged).not.toBeNull();
    const center = dragged!.points[geometry.center]!;
    const end = dragged!.points[geometry.end]!;
    const start = dragged!.points[geometry.start]!;
    expect(distance(center, end)).toBeCloseTo(distance(center, start), 3);
  });
});

describe("sketch fillet", () => {
  beforeAll(async () => {
    await initSolver();
  });

  function corner(): Sketch {
    const first = addPolyline(
      emptySketch(),
      [{ point: [0, 0] }, { point: [60, 0] }],
      false,
    );
    return addPolyline(first, [{ point: [0, 0] }, { point: [0, 60] }], false);
  }

  it("rounds a corner with tangent lines and a driving diameter", () => {
    const sketch = corner();
    const [a, b] = sketch.curves.filter((curve) => curve.type === "line");
    if (!a || !b) throw new Error("expected two lines");
    const filleted = addFillet(sketch, a.id, b.id, 10);
    const geometry = arc(filleted);
    expect(filleted.constraints.filter((c) => c.type === "tangent")).toHaveLength(2);
    expect(filleted.constraints.find((c) => c.type === "diameter")).toMatchObject({
      circle: geometry.id,
      value: 20,
    });

    const solved = solveSketch(filleted);
    expect(solved.ok).toBe(true);
    const applied = applySolution(filleted, solved);
    expect(radius(applied, geometry.id)).toBeCloseTo(10, 4);
    expect(tangentDot(applied, geometry.id)).toBeCloseTo(0, 3);
  });

  it("drives the fillet radius with its diameter dimension", () => {
    const sketch = corner();
    const [a, b] = sketch.curves.filter((curve) => curve.type === "line");
    if (!a || !b) throw new Error("expected two lines");
    const filleted = addFillet(sketch, a.id, b.id, 10);
    const geometry = arc(filleted);
    const dimension = filleted.constraints.find(
      (c) => c.type === "diameter" && c.circle === geometry.id,
    );
    if (!dimension) throw new Error("expected a diameter dimension");
    const enlarged = updateConstraintValue(filleted, dimension.id, 40);
    const solved = solveSketch(enlarged);
    expect(solved.ok).toBe(true);
    const applied = applySolution(enlarged, solved);
    expect(radius(applied, geometry.id)).toBeCloseTo(20, 3);
    expect(tangentDot(applied, geometry.id)).toBeCloseTo(0, 3);
  });

  it("removes the arc and its tangent constraints on delete", () => {
    const sketch = corner();
    const [a, b] = sketch.curves.filter((curve) => curve.type === "line");
    if (!a || !b) throw new Error("expected two lines");
    const filleted = addFillet(sketch, a.id, b.id, 10);
    const geometry = arc(filleted);
    const deleted = deleteEntities(filleted, [geometry.id]);
    expect(deleted.curves.filter((curve) => curve.type === "arc")).toHaveLength(0);
    expect(deleted.constraints.filter((c) => c.type === "tangent")).toHaveLength(0);
    expect(deleted.constraints.filter((c) => c.type === "diameter")).toHaveLength(0);
    expect(deleted.curves.filter((curve) => curve.type === "line")).toHaveLength(2);
  });

  it("extracts a mixed line/arc profile for the kernel", () => {
    const rectangle = addRectangle(emptySketch(), [0, 0], [60, 40]);
    const lines = rectangle.curves.filter((curve) => curve.type === "line");
    const a = lines[0];
    const b = lines[3];
    if (!a || !b) throw new Error("expected four lines");
    const filleted = addFillet(rectangle, a.id, b.id, 5);
    const solved = solveSketch(filleted);
    const applied = applySolution(filleted, solved);
    const profile = profileFromSketch(applied);

    expect(profile).not.toBeNull();
    expect(profile!.outer.kind).toBe("path");
    if (profile!.outer.kind !== "path") return;
    expect(profile!.outer.segments.filter((s) => s.kind === "arc")).toHaveLength(1);
    expect(profile!.outer.segments.filter((s) => s.kind === "line")).toHaveLength(4);
    // The path closes: each segment starts where the previous one ended.
    const segments = profile!.outer.segments;
    for (let i = 0; i < segments.length; i++) {
      const current = segments[i]!;
      const next = segments[(i + 1) % segments.length]!;
      const end = current.kind === "line" ? current.b : current.end;
      const start = next.kind === "line" ? next.a : next.start;
      expect(distance(end, start)).toBeCloseTo(0, 4);
    }
  });

  it("keeps the fillet tangent while dragging a line endpoint", () => {
    const sketch = corner();
    const [a, b] = sketch.curves.filter((curve) => curve.type === "line");
    if (!a || !b) throw new Error("expected two lines");
    const filleted = addFillet(sketch, a.id, b.id, 10);
    const solved = solveSketch(filleted);
    const applied = applySolution(filleted, solved);
    const geometry = arc(applied);
    const dragged = solveDrag(applied, { pointId: a.b, x: 70, y: 0 });
    expect(dragged).not.toBeNull();
    const after = applySolution(applied, dragged!);
    expect(radius(after, geometry.id)).toBeCloseTo(10, 3);
    expect(tangentDot(after, geometry.id)).toBeCloseTo(0, 3);
  });
});


/** The arc is tangent to both lines: radius is perpendicular to each line. */
function tangentDot(sketch: Sketch, arcId: string): number {
  const arcCurve = sketch.curves.find(
    (curve): curve is Extract<typeof curve, { type: "arc" }> =>
      curve.id === arcId && curve.type === "arc",
  );
  if (!arcCurve) throw new Error("expected an arc");
  const points = solutionPoints(sketch);
  const center = points[arcCurve.center]!;
  let worst = 0;
  for (const curve of sketch.curves) {
    if (curve.type !== "line") continue;
    const shared =
      curve.a === arcCurve.start || curve.a === arcCurve.end
        ? curve.a
        : curve.b === arcCurve.start || curve.b === arcCurve.end
          ? curve.b
          : null;
    if (!shared) continue;
    const a = points[curve.a]!;
    const b = points[curve.b]!;
    const endpoint = points[shared]!;
    const dot =
      (b[0] - a[0]) * (center[0] - endpoint[0]) +
      (b[1] - a[1]) * (center[1] - endpoint[1]);
    worst = Math.max(worst, Math.abs(dot));
  }
  return worst;
}
