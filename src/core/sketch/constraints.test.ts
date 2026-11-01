import { describe, expect, it } from "vitest";
import { addCircle, addPolyline, emptySketch } from "./create";
import {
  applicableConstraints,
  appliedConstraints,
  applyConstraint,
  constructionState,
  toggleConstruction,
} from "./constraints";
import type { Sketch } from "./types";

function twoLines(): Sketch {
  const first = addPolyline(
    emptySketch(),
    [{ point: [0, 0] }, { point: [40, 10] }],
    false,
  );
  return addPolyline(first, [{ point: [0, 20] }, { point: [40, 28] }], false);
}

function lineIds(sketch: Sketch): [string, string] {
  const ids = sketch.curves
    .filter((curve) => curve.type === "line")
    .map((curve) => curve.id);
  return [ids[0]!, ids[1]!];
}

describe("constraint applicability", () => {
  it("reports an applied horizontal constraint with its id", () => {
    const sketch = addPolyline(
      emptySketch(),
      [{ point: [0, 0] }, { point: [40, 0] }],
      false,
    );
    const line = sketch.curves[0]!;
    const applied = appliedConstraints(sketch, [line.id]);
    expect(applied).toHaveLength(1);
    expect(applied[0]).toMatchObject({
      type: "horizontal",
      applied: true,
      id: sketch.constraints[0]!.id,
    });
    expect(
      applicableConstraints(sketch, [line.id]).map((action) => action.type),
    ).toEqual(["horizontal", "vertical"]);
  });

  it("offers horizontal/vertical for one line", () => {
    const sketch = addPolyline(
      emptySketch(),
      [{ point: [0, 0] }, { point: [40, 10] }],
      false,
    );
    const types = applicableConstraints(sketch, [sketch.curves[0]!.id]).map(
      (action) => action.type,
    );

    expect(types).toEqual(["horizontal", "vertical"]);
  });

  it("offers parallel, perpendicular and equal for two lines", () => {
    const sketch = twoLines();
    const [a, b] = lineIds(sketch);
    const types = applicableConstraints(sketch, [a, b]).map((action) => action.type);

    expect(types).toEqual(["parallel", "perpendicular", "equal"]);
  });

  it("offers equal for two circles", () => {
    const first = addCircle(emptySketch(), { point: [0, 0] }, 10);
    const sketch = addCircle(first, { point: [40, 0] }, 6);
    const ids = sketch.curves.map((curve) => curve.id);

    expect(applicableConstraints(sketch, ids).map((action) => action.type)).toEqual([
      "equal",
    ]);
  });

  it("offers point-on-line for a point and a line", () => {
    const sketch: Sketch = {
      points: [
        { id: "a", x: 0, y: 0 },
        { id: "b", x: 40, y: 0 },
        { id: "p", x: 20, y: 10 },
      ],
      curves: [{ id: "l", type: "line", a: "a", b: "b" }],
      constraints: [],
    };

    expect(
      applicableConstraints(sketch, ["p", "l"]).map((action) => action.type),
    ).toEqual(["pointOnLine", "midpoint"]);
  });

  it("keeps applied constraints visible and hides duplicate actions", () => {
    const sketch = twoLines();
    const [a, b] = lineIds(sketch);
    const withParallel = applyConstraint(sketch, "parallel", [a, b]);
    const actions = applicableConstraints(withParallel, [a, b]);

    expect(actions.map((action) => action.type)).toEqual([
      "parallel",
      "perpendicular",
      "equal",
    ]);
    expect(
      actions.find((action) => action.type === "parallel"),
    ).toMatchObject({ applied: true });
  });
});

describe("applying constraints", () => {
  it("adds a parallel constraint exactly once", () => {
    const sketch = twoLines();
    const [a, b] = lineIds(sketch);
    const once = applyConstraint(sketch, "parallel", [a, b]);
    const twice = applyConstraint(once, "parallel", [b, a]);

    expect(once.constraints.filter((c) => c.type === "parallel")).toHaveLength(1);
    expect(twice).toBe(once);
  });

  it("adds equal for circles", () => {
    const first = addCircle(emptySketch(), { point: [0, 0] }, 10);
    const sketch = addCircle(first, { point: [40, 0] }, 6);
    const ids = sketch.curves.map((curve) => curve.id);
    const next = applyConstraint(sketch, "equal", ids);

    expect(next.constraints.find((c) => c.type === "equal")).toMatchObject({
      type: "equal",
      a: ids[0],
      b: ids[1],
    });
  });

  it("ignores inapplicable combinations", () => {
    const sketch = twoLines();
    const [a] = lineIds(sketch);
    expect(applyConstraint(sketch, "parallel", [a])).toBe(sketch);
    expect(applyConstraint(sketch, "pointOnLine", [a])).toBe(sketch);
  });
});

describe("construction geometry", () => {
  it("toggles selected curves and reports state", () => {
    const sketch = twoLines();
    const [a, b] = lineIds(sketch);
    expect(constructionState(sketch, [a])).toBe("none");
    expect(constructionState(sketch, [])).toBeNull();

    const on = toggleConstruction(sketch, [a, b]);
    expect(constructionState(on, [a, b])).toBe("all");
    expect(on.curves.find((curve) => curve.id === a)?.construction).toBe(true);

    const off = toggleConstruction(on, [a]);
    expect(constructionState(off, [a])).toBe("none");
    expect(constructionState(off, [a, b])).toBe("mixed");
  });
});
