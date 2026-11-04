import { describe, expect, it } from "vitest";
import { addCircle, addRectangle, emptySketch } from "./create";
import {
  addDimension,
  removeConstraint,
  setDimensionDriving,
  setDimensionPlacement,
} from "./dimensions";

describe("dimensions", () => {
  const rectangle = addRectangle(emptySketch(), [0, 0], [60, 40]);
  const a = rectangle.points[0]!.id;
  const b = rectangle.points[1]!.id;

  it("creates a driving distance dimension at the measured value", () => {
    const sketch = addDimension(rectangle, { kind: "distance", a, b }, true, { offset: 14 });
    const dimension = sketch.constraints.find((constraint) => constraint.type === "distance");

    expect(dimension).toMatchObject({
      type: "distance",
      a,
      b,
      value: 60,
      driving: true,
      offset: 14,
    });
  });

  it("moves a linear label along its dimension line", () => {
    const sketch = addDimension(rectangle, { kind: "distance", a, b }, true, {
      offset: 14,
    });
    const dimension = sketch.constraints.find(
      (constraint) => constraint.type === "distance",
    )!;
    const moved = setDimensionPlacement(sketch, dimension.id, {
      offset: 18,
      along: 0.25,
    });
    expect(
      moved.constraints.find((constraint) => constraint.id === dimension.id),
    ).toMatchObject({ offset: 18, along: 0.25 });
  });

  it("moves a diameter label by angle and leader distance", () => {
    const circleSketch = addCircle(emptySketch(), { point: [0, 0] }, 10);
    const circle = circleSketch.curves.find((curve) => curve.type === "circle")!;
    const sketch = addDimension(
      circleSketch,
      { kind: "diameter", circle: circle.id },
      true,
      { angle: 45, distance: 12 },
    );
    const dimension = sketch.constraints.find(
      (constraint) => constraint.type === "diameter",
    )!;
    const moved = setDimensionPlacement(sketch, dimension.id, {
      angle: 90,
      distance: 30,
    });
    expect(
      moved.constraints.find((constraint) => constraint.id === dimension.id),
    ).toMatchObject({ angle: 90, distance: 30 });
  });

  it("updates the existing dimension instead of stacking a second one", () => {
    const once = addDimension(rectangle, { kind: "distance", a, b }, true, { offset: 14 });
    const twice = addDimension(
      { ...once, points: once.points.map((p) => (p.id === b ? { ...p, x: 70 } : p)) },
      { kind: "distance", a, b },
      true,
      { offset: 20 },
    );

    expect(twice.constraints.filter((constraint) => constraint.type === "distance")).toHaveLength(1);
    expect(twice.constraints.find((constraint) => constraint.type === "distance")).toMatchObject({
      value: 70,
      offset: 20,
    });
  });

  it("can make a dimension a reference", () => {
    const sketch = addDimension(rectangle, { kind: "distance", a, b }, false, { offset: 14 });
    expect(sketch.constraints.find((constraint) => constraint.type === "distance")).toMatchObject({
      driving: false,
    });
  });

  it("toggles a dimension that omits the driving flag", () => {
    // Hand-authored/example dimensions are driving by omission, not by an
    // explicit `driving: true`. Toggling must still write the flag.
    const plain = {
      ...rectangle,
      constraints: [
        ...rectangle.constraints,
        { id: "dim-plain", type: "distance" as const, a, b, value: 60 },
      ],
    };
    const reference = setDimensionDriving(plain, "dim-plain", false);
    expect(
      reference.constraints.find((constraint) => constraint.id === "dim-plain"),
    ).toMatchObject({ driving: false });
    const driving = setDimensionDriving(reference, "dim-plain", true);
    expect(
      driving.constraints.find((constraint) => constraint.id === "dim-plain"),
    ).toMatchObject({ driving: true });
  });

  it("reuses the diameter constraint created with a circle", () => {
    const withCircle = addCircle(emptySketch(), { point: [0, 0] }, 9);
    const diameter = withCircle.constraints.find((constraint) => constraint.type === "diameter");
    const sketch = addDimension(
      withCircle,
      { kind: "diameter", circle: withCircle.curves[0]!.id },
      false,
      { angle: 30 },
    );

    expect(sketch.constraints.filter((constraint) => constraint.type === "diameter")).toHaveLength(1);
    expect(sketch.constraints.find((constraint) => constraint.type === "diameter")).toMatchObject({
      id: diameter?.id,
      value: 18,
      driving: false,
      angle: 30,
    });
  });

  it("removes a constraint", () => {
    const sketch = addDimension(rectangle, { kind: "distance", a, b }, true, { offset: 14 });
    const id = sketch.constraints.find((constraint) => constraint.type === "distance")!.id;
    const remaining = removeConstraint(sketch, id).constraints;
    expect(remaining.some((constraint) => constraint.id === id)).toBe(false);
    expect(remaining).toHaveLength(sketch.constraints.length - 1);
  });
});
