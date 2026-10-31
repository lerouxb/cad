import { describe, expect, it } from "vitest";
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
