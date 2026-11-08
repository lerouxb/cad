import { describe, expect, it } from "vitest";
import type { Sketch } from "../core/sketch/types";
import {
  constraintMarks,
  equalGroupIndexes,
  perpendicularCorner,
  symmetricChevrons,
  tangentContact,
} from "./constraintMarks";

function line(
  id: string,
  a: [number, number],
  b: [number, number],
): { curve: Sketch["curves"][number]; points: Sketch["points"] } {
  return {
    curve: { id, type: "line", a: `${id}-a`, b: `${id}-b` },
    points: [
      { id: `${id}-a`, x: a[0], y: a[1] },
      { id: `${id}-b`, x: b[0], y: b[1] },
    ],
  };
}

describe("constraint mark geometry", () => {
  it("groups equal constraints by their connected geometry", () => {
    const sketch: Sketch = {
      points: [],
      curves: [],
      constraints: [
        { id: "e1", type: "equal", a: "a", b: "b" },
        { id: "e2", type: "equal", a: "c", b: "d" },
        { id: "e3", type: "equal", a: "b", b: "c" },
      ],
    };
    const groups = equalGroupIndexes(sketch);
    expect(groups.get("e1")).toBe(1);
    expect(groups.get("e2")).toBe(1);
    expect(groups.get("e3")).toBe(1);

    const separate: Sketch = {
      ...sketch,
      constraints: [
        { id: "e1", type: "equal", a: "a", b: "b" },
        { id: "e2", type: "equal", a: "c", b: "d" },
      ],
    };
    const indexes = equalGroupIndexes(separate);
    expect(indexes.get("e1")).toBe(1);
    expect(indexes.get("e2")).toBe(2);
  });

  it("points symmetric chevrons toward a vertical and horizontal axis", () => {
    const vertical = symmetricChevrons([-10, 5], [10, 5], [0, -20], [0, 20]);
    expect(vertical.a.angle).toBeCloseTo(0, 6);
    expect(vertical.b.angle).toBeCloseTo(Math.PI, 6);

    const horizontal = symmetricChevrons([-10, 5], [-10, -5], [-20, 0], [20, 0]);
    expect(Math.sin(horizontal.a.angle)).toBeCloseTo(-1, 6);
    expect(Math.sin(horizontal.b.angle)).toBeCloseTo(1, 6);
  });

  it("draws a perpendicular square only where the segments meet", () => {
    const first = line("a", [0, 0], [10, 0]);
    const second = line("b", [5, -5], [5, 5]);
    const points = Object.fromEntries(
      [...first.points, ...second.points].map((point) => [
        point.id,
        [point.x, point.y] as [number, number],
      ]),
    );
    const corner = perpendicularCorner(
      first.curve as Extract<Sketch["curves"][number], { type: "line" }>,
      second.curve as Extract<Sketch["curves"][number], { type: "line" }>,
      points,
      8,
    );
    expect(corner).not.toBeNull();
    expect(corner![0]![0]).toBeCloseTo(5, 6);
    expect(corner![0]![1]).toBeCloseTo(0, 6);
    expect(corner).toHaveLength(4);

    const away = line("c", [20, -5], [20, 5]);
    const outside = perpendicularCorner(
      first.curve as Extract<Sketch["curves"][number], { type: "line" }>,
      away.curve as Extract<Sketch["curves"][number], { type: "line" }>,
      {
        ...points,
        ...Object.fromEntries(
          away.points.map((point) => [
            point.id,
            [point.x, point.y] as [number, number],
          ]),
        ),
      },
      8,
    );
    expect(outside).toBeNull();
  });

  it("finds a tangent contact only when the line and arc share an endpoint", () => {
    const points = {
      c: [5, 0] as [number, number],
      s: [0, 0] as [number, number],
      e: [10, 0] as [number, number],
      la: [0, 0] as [number, number],
      lb: [0, 10] as [number, number],
      lc: [20, 0] as [number, number],
      ld: [20, 10] as [number, number],
    };
    const arc = {
      id: "arc",
      type: "arc" as const,
      center: "c",
      start: "s",
      end: "e",
    };
    const shared = {
      id: "shared",
      type: "line" as const,
      a: "s",
      b: "lb",
    };
    expect(tangentContact(arc, shared, points)).toEqual([0, 0]);
    const apart = { id: "apart", type: "line" as const, a: "lc", b: "ld" };
    expect(tangentContact(arc, apart, points)).toBeNull();
  });

  it("builds equal ticks, symmetric chevrons and a collinear tie", () => {
    const points = {
      a: [0, 0] as [number, number],
      b: [10, 0] as [number, number],
      c: [0, 10] as [number, number],
      d: [10, 10] as [number, number],
      e: [20, 0] as [number, number],
      f: [30, 0] as [number, number],
      axisA: [0, -20] as [number, number],
      axisB: [0, 20] as [number, number],
    };
    const sketch: Sketch = {
      points: [
        ...Object.entries(points).map(([id, [x, y]]) => ({ id, x, y })),
      ],
      curves: [
        { id: "l1", type: "line", a: "a", b: "b" },
        { id: "l2", type: "line", a: "c", b: "d" },
        { id: "l3", type: "line", a: "e", b: "f" },
        { id: "axis", type: "line", a: "axisA", b: "axisB" },
      ],
      constraints: [
        { id: "eq", type: "equal", a: "l1", b: "l2" },
        { id: "same", type: "collinear", a: "l1", b: "l3" },
        { id: "mirror", type: "symmetric", a: "a", b: "e", about: "axis" },
      ],
    };
    const marks = constraintMarks(sketch, {
      points,
      selected: new Set(["a", "e"]),
      hoveredCurveId: null,
      hoveredPointId: null,
      px: 0.1,
    });
    expect(marks.some((mark) => mark.kind === "tick")).toBe(true);
    expect(
      marks.filter((mark) => mark.type === "symmetric" && mark.kind === "chevron"),
    ).toHaveLength(2);
    expect(marks.some((mark) => mark.kind === "axis")).toBe(true);
    expect(
      marks.some((mark) => mark.type === "collinear" && mark.kind === "segment"),
    ).toBe(true);
  });
});
