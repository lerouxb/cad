import { describe, expect, it } from "vitest";
import type { Sketch } from "../core/sketch/types";
import {
  constraintMarks,
  equalGroupIndexes,
  perpendicularCorner,
  symmetricChevrons,
  tangentContact,
  type ConstraintMark,
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
    expect(Math.abs(vertical.b.angle)).toBeCloseTo(Math.PI, 6);
    // The chevrons sit on the connector either side of the axis, not on the
    // participants.
    expect(vertical.a.x).toBeLessThan(0);
    expect(vertical.b.x).toBeGreaterThan(0);
    expect(vertical.a.y).toBeCloseTo(5, 6);

    const horizontal = symmetricChevrons([-10, 5], [-10, -5], [-20, 0], [20, 0]);
    expect(Math.sin(horizontal.a.angle)).toBeCloseTo(-1, 6);
    expect(Math.sin(horizontal.b.angle)).toBeCloseTo(1, 6);
    expect(horizontal.a.y).toBeGreaterThan(0);
    expect(horizontal.b.y).toBeLessThan(0);
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
    expect(corner).toHaveLength(3);
    const [p1, p2, p3] = corner!;
    expect(Math.hypot(p2![0] - p1![0], p2![1] - p1![1])).toBeCloseTo(8, 6);
    expect(Math.hypot(p3![0] - p2![0], p3![1] - p2![1])).toBeCloseTo(8, 6);
    expect(
      (p2![0] - p1![0]) * (p3![0] - p2![0]) +
        (p2![1] - p1![1]) * (p3![1] - p2![1]),
    ).toBeCloseTo(0, 6);

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
      selected: new Set(),
      hoveredCurveId: null,
      hoveredPointId: null,
      selectedConstraintId: "mirror",
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
    expect(
      marks.filter((mark) => mark.type === "symmetric").every((mark) => mark.style === "active"),
    ).toBe(true);
  });

  it("draws the symmetric connector dashed with chevrons around the axis", () => {
    const sketch: Sketch = {
      points: [
        { id: "a", x: -10, y: 5 },
        { id: "b", x: 10, y: 5 },
      ],
      curves: [],
      constraints: [
        { id: "sym", type: "symmetric", a: "a", b: "b", about: "axis-y" },
      ],
      references: {
        origin: { id: "origin", x: 0, y: 0, fixed: true, reference: true },
        points: [
          { id: "origin", x: 0, y: 0, fixed: true, reference: true },
          { id: "axis-y-min", x: 0, y: -20, fixed: true, reference: true },
          { id: "axis-y-max", x: 0, y: 20, fixed: true, reference: true },
        ],
        lines: [
          {
            id: "axis-y",
            type: "line",
            a: "axis-y-min",
            b: "axis-y-max",
            construction: true,
            reference: true,
          },
        ],
        circles: [],
      },
    };
    const marks = constraintMarks(sketch, {
      points: { a: [-10, 5], b: [10, 5], "axis-y-min": [0, -20], "axis-y-max": [0, 20] },
      selected: new Set(),
      hoveredCurveId: null,
      hoveredPointId: null,
      px: 0.1,
    });
    const connector = marks.find(
      (mark) => mark.type === "symmetric" && mark.kind === "segment",
    );
    expect(connector).toMatchObject({ dashed: true });
    const chevrons = marks.filter(
      (mark): mark is Extract<ConstraintMark, { kind: "chevron" }> =>
        mark.type === "symmetric" && mark.kind === "chevron",
    );
    expect(chevrons).toHaveLength(2);
    // Near the axis crossing, not out at the two points.
    expect(Math.abs(chevrons[0]!.x)).toBeLessThan(2);
    expect(Math.abs(chevrons[1]!.x)).toBeLessThan(2);
    expect(Math.sign(chevrons[0]!.x)).toBe(-Math.sign(chevrons[1]!.x));
  });

  it("lifts the fix pin above the point on a stem", () => {
    const sketch: Sketch = {
      points: [{ id: "p", x: 0, y: 0 }],
      curves: [],
      constraints: [{ id: "fix", type: "fix", point: "p" }],
    };
    const marks = constraintMarks(sketch, {
      points: { p: [0, 0] },
      selected: new Set(),
      hoveredCurveId: null,
      hoveredPointId: null,
      px: 0.1,
    });
    const pin = marks.find((mark) => mark.kind === "pin");
    expect(pin).toBeDefined();
    expect(pin!.y).toBeLessThan(-0.5);
    const stem = marks.find(
      (mark) => mark.kind === "segment" && mark.type === "fix",
    );
    expect(stem).toMatchObject({ x1: 0, y1: 0, x2: 0 });
  });

  it("marks constraints attached to projected reference geometry", () => {
    const sketch: Sketch = {
      points: [{ id: "p", x: 0, y: 8 }],
      curves: [],
      constraints: [
        { id: "on", type: "pointOnCircle", point: "p", circle: "pc" },
      ],
      references: {
        origin: { id: "origin", x: 0, y: 0, fixed: true, reference: true },
        points: [
          {
            id: "pc-center",
            x: 0,
            y: 0,
            fixed: true,
            reference: true,
            construction: true,
            projectionId: "proj",
          },
        ],
        lines: [],
        circles: [
          {
            id: "pc",
            type: "circle",
            center: "pc-center",
            radius: 8,
            construction: true,
            reference: true,
            projectionId: "proj",
          },
        ],
      },
    };
    const marks = constraintMarks(sketch, {
      points: { p: [0, 8], "pc-center": [0, 0] },
      selected: new Set(),
      hoveredCurveId: null,
      hoveredPointId: null,
      px: 0.1,
    });
    expect(marks.some((mark) => mark.type === "pointOnCircle")).toBe(true);
  });

  it("does not restyle constraints when their geometry is selected", () => {
    const points = {
      a: [0, 0] as [number, number],
      b: [10, 0] as [number, number],
      c: [0, 10] as [number, number],
      d: [10, 10] as [number, number],
    };
    const sketch: Sketch = {
      points: Object.entries(points).map(([id, [x, y]]) => ({ id, x, y })),
      curves: [
        { id: "l1", type: "line", a: "a", b: "b" },
        { id: "l2", type: "line", a: "c", b: "d" },
      ],
      constraints: [{ id: "eq", type: "equal", a: "l1", b: "l2" }],
    };
    const quiet = constraintMarks(sketch, {
      points,
      selected: new Set(["l1", "l2"]),
      hoveredCurveId: null,
      hoveredPointId: null,
      px: 0.1,
    });
    expect(quiet.every((mark) => mark.style === "quiet")).toBe(true);

    const active = constraintMarks(sketch, {
      points,
      selected: new Set(),
      hoveredCurveId: null,
      hoveredPointId: null,
      selectedConstraintId: "eq",
      px: 0.1,
    });
    expect(active.every((mark) => mark.style === "active")).toBe(true);
  });
});
