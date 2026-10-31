import { describe, expect, it } from "vitest";
import { addPolyline, emptySketch } from "./create";
import { createDemoModel } from "./demo";
import { deleteEntities, isSketchEntity } from "./edit";

describe("deleteEntities", () => {
  const sketch = createDemoModel().sketch;

  it("deletes a line without dropping endpoints another curve still uses", () => {
    const next = deleteEntities(sketch, ["l-bottom"]);

    expect(next.curves.map((curve) => curve.id)).not.toContain("l-bottom");
    expect(next.points.map((point) => point.id)).toEqual(
      expect.arrayContaining(["p0", "p1", "p2", "p3"]),
    );
    expect(
      next.constraints.some(
        (constraint) => constraint.type === "horizontal" && constraint.line === "l-bottom",
      ),
    ).toBe(false);
    // The other edges keep their own constraints.
    expect(next.constraints.some((constraint) => constraint.id === "v-right")).toBe(true);
  });

  it("deletes a point and every curve incident to it", () => {
    const next = deleteEntities(sketch, ["p1"]);

    expect(next.curves.map((curve) => curve.id).sort()).toEqual(
      ["diagonal", "hole", "l-left", "l-top"].sort(),
    );
    expect(next.points.map((point) => point.id)).not.toContain("p1");
    // p0 and p2 are still used by l-left and l-top.
    expect(next.points.map((point) => point.id)).toEqual(
      expect.arrayContaining(["p0", "p2", "p3"]),
    );
    expect(next.constraints.some((constraint) => constraint.id === "h-bottom")).toBe(false);
    expect(next.constraints.some((constraint) => constraint.id === "v-right")).toBe(false);
  });

  it("deletes a circle with its diameter constraint and its orphaned centre", () => {
    const next = deleteEntities(sketch, ["hole"]);

    expect(next.curves.map((curve) => curve.id)).not.toContain("hole");
    expect(next.points.map((point) => point.id)).not.toContain("hole-center");
    expect(next.constraints.some((constraint) => constraint.id === "hole-diameter")).toBe(false);
    // The midpoint constraint refers to the deleted centre too.
    expect(next.constraints.some((constraint) => constraint.id === "hole-centered")).toBe(false);
    // The construction diagonal is independent.
    expect(next.curves.map((curve) => curve.id)).toContain("diagonal");
  });

  it("deletes a mixed selection in one pass", () => {
    const next = deleteEntities(sketch, ["l-bottom", "p2"]);

    // p2 also ends the construction diagonal, so that goes with it.
    expect(next.curves.map((curve) => curve.id).sort()).toEqual(["hole", "l-left"].sort());
    expect(next.points.map((point) => point.id)).toContain("p0");
    expect(next.points.map((point) => point.id)).not.toContain("p2");
  });

  it("keeps the fixed reference frame when nothing uses it", () => {
    const next = deleteEntities(sketch, ["l-bottom", "l-right", "l-top", "l-left"]);
    expect(next.references?.origin.id).toBe("origin");
    expect(next.references?.lines.map((line) => line.id)).toEqual([
      "axis-x",
      "axis-y",
    ]);
  });

  it("keeps point-on-line constraints when unrelated geometry is deleted", () => {
    let sketch = addPolyline(
      emptySketch(),
      [
        { point: [-20, 0] },
        { point: [20, 0] },
      ],
      false,
    );
    const lineId = sketch.curves[0]!.id;
    sketch = addPolyline(
      sketch,
      [
        { point: [-10, 0] },
        { point: [-10, 10] },
      ],
      false,
    );
    const second = sketch.curves.find(
      (curve) => curve.type === "line" && curve.id !== lineId,
    );
    if (second?.type !== "line") throw new Error("Expected a line");
    const pointId = second.a;
    sketch = {
      ...sketch,
      constraints: [
        ...sketch.constraints,
        { id: "ptl", type: "pointOnLine", point: pointId, line: lineId },
      ],
    };

    // Delete a different, unrelated line.
    const unrelated = addPolyline(
      sketch,
      [
        { point: [40, 40] },
        { point: [50, 50] },
      ],
      false,
    );
    const unrelatedId = unrelated.curves[unrelated.curves.length - 1]!.id;
    const next = deleteEntities(unrelated, [unrelatedId]);

    expect(next.constraints.some((constraint) => constraint.id === "ptl")).toBe(
      true,
    );
  });

  it("keeps constraints that reference the fixed origin and axes", () => {
    let sketch = addPolyline(
      emptySketch(),
      [
        { point: [10, 10] },
        { point: [20, 10] },
      ],
      false,
    );
    const line = sketch.curves[0]!;
    if (line.type !== "line") throw new Error("Expected a line");
    sketch = {
      ...sketch,
      constraints: [
        ...sketch.constraints,
        { id: "on-axis", type: "pointOnLine", point: line.a, line: "axis-x" },
        {
          id: "from-origin",
          type: "distance",
          a: "origin",
          b: line.a,
          value: 10,
        },
      ],
    };
    const unrelated = addPolyline(
      sketch,
      [
        { point: [40, 40] },
        { point: [50, 50] },
      ],
      false,
    );
    const unrelatedId = unrelated.curves[unrelated.curves.length - 1]!.id;
    const next = deleteEntities(unrelated, [unrelatedId]);

    expect(next.constraints.some((constraint) => constraint.id === "on-axis")).toBe(
      true,
    );
    expect(
      next.constraints.some((constraint) => constraint.id === "from-origin"),
    ).toBe(true);
  });

  it("is a no-op for empty selections and unknown ids", () => {
    expect(deleteEntities(sketch, [])).toBe(sketch);
    expect(deleteEntities(sketch, ["missing"])).toBe(sketch);
  });

  it("recognises curves and points, not constraints", () => {
    expect(isSketchEntity(sketch, "l-bottom")).toBe(true);
    expect(isSketchEntity(sketch, "p0")).toBe(true);
    expect(isSketchEntity(sketch, "h-bottom")).toBe(false);
  });
});
