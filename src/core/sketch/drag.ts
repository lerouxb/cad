import type { Sketch, SketchConstraint } from "./types";

/**
 * Constrained dragging by tangent-space projection.
 *
 * Pinning the dragged point at the cursor position makes the system
 * inconsistent whenever the cursor leaves the feasible set (which is almost
 * always: a point on a circle can only move along the circle). Instead:
 *
 *   1. linearise the constraints at the current solution,
 *   2. project the desired cursor delta onto the null space of that Jacobian
 *      with cyclic orthogonal projections (von Neumann / Kaczmarz),
 *   3. apply the projected delta to *all* points and let the solver clean up
 *      the second-order error.
 *
 * The result is the classic sketcher behaviour: the point follows the cursor
 * as far as the constraints allow, sliding along lines and arcs.
 */

interface Parameters {
  /** Flat parameter vector: x,y for each free point, then one radius per circle. */
  values: number[];
  pointIndex: Map<string, [number, number]>;
  radiusIndex: Map<string, number>;
  fixed: Set<string>;
}

type Row = Map<number, number>;

export interface DragRequest {
  pointId: string;
  /** Cursor position in sketch coordinates. */
  x: number;
  y: number;
}

export interface ProjectedDrag {
  sketch: Sketch;
  /** How much of the requested motion survived the constraints, 0..1. */
  acceptance: number;
  /** Movement of the dragged point in mm. */
  moved: number;
}

export function projectDrag(
  sketch: Sketch,
  request: DragRequest,
): ProjectedDrag | null {
  const dragged = sketch.points.find((point) => point.id === request.pointId);
  if (!dragged || dragged.fixed) return null;

  const params = buildParameters(sketch);
  const index = params.pointIndex.get(request.pointId);
  if (!index) return null;

  const rows = buildRows(sketch, params);
  const delta = params.values.map(() => 0);
  const dx = request.x - dragged.x;
  const dy = request.y - dragged.y;
  delta[index[0]] = dx;
  delta[index[1]] = dy;

  // The dragged point is almost rigid: we want *it* to follow the cursor, and
  // the rest of the sketch to absorb the constraint correction. A tiny
  // mobility (not zero, so rows that only involve the dragged point still
  // project it) gives that behaviour.
  const mobility = params.values.map(() => 1);
  mobility[index[0]] = 1e-9;
  mobility[index[1]] = 1e-9;

  // A handful of weighted Kaczmarz sweeps is plenty for a sketch-sized system.
  for (let sweep = 0; sweep < 32; sweep++) {
    for (const row of rows) {
      let denominator = 0;
      let dot = 0;
      for (const [param, coefficient] of row) {
        denominator += coefficient * coefficient * (mobility[param] ?? 1);
        dot += coefficient * (delta[param] ?? 0);
      }
      if (denominator < 1e-15) continue;
      const factor = dot / denominator;
      for (const [param, coefficient] of row) {
        delta[param] =
          (delta[param] ?? 0) - factor * coefficient * (mobility[param] ?? 1);
      }
    }
  }

  const movedX = delta[index[0]] ?? 0;
  const movedY = delta[index[1]] ?? 0;
  const moved = Math.hypot(movedX, movedY);
  const requested = Math.hypot(dx, dy);
  if (moved < 1e-5) return null;

  const points = sketch.points.map((point) => {
    if (point.fixed) return point;
    const slot = params.pointIndex.get(point.id);
    if (!slot) return point;
    return {
      ...point,
      x: point.x + (delta[slot[0]] ?? 0),
      y: point.y + (delta[slot[1]] ?? 0),
    };
  });

  const curves = sketch.curves.map((curve) => {
    if (curve.type !== "circle") return curve;
    const slot = params.radiusIndex.get(curve.id);
    const change = slot === undefined ? 0 : (delta[slot] ?? 0);
    return change === 0 ? curve : { ...curve, radius: curve.radius + change };
  });

  return {
    sketch: { ...sketch, points, curves },
    acceptance: requested > 1e-9 ? moved / requested : 0,
    moved,
  };
}

function buildParameters(sketch: Sketch): Parameters {
  const values: number[] = [];
  const pointIndex = new Map<string, [number, number]>();
  const radiusIndex = new Map<string, number>();
  const fixed = new Set<string>();

  for (const point of sketch.points) {
    if (point.fixed) {
      fixed.add(point.id);
      continue;
    }
    pointIndex.set(point.id, [values.length, values.length + 1]);
    values.push(point.x, point.y);
  }
  for (const curve of sketch.curves) {
    if (curve.type !== "circle") continue;
    radiusIndex.set(curve.id, values.length);
    values.push(curve.radius);
  }
  return { values, pointIndex, radiusIndex, fixed };
}

function buildRows(sketch: Sketch, params: Parameters): Row[] {
  const rows: Row[] = [];
  const row = (): Row => new Map();

  const pointSlot = (id: string): [number, number] | null =>
    params.pointIndex.get(id) ?? null;
  const addPoint = (
    target: Row,
    id: string,
    coefficientX: number,
    coefficientY: number,
  ): void => {
    const slot = pointSlot(id);
    if (!slot) return;
    target.set(slot[0], (target.get(slot[0]) ?? 0) + coefficientX);
    target.set(slot[1], (target.get(slot[1]) ?? 0) + coefficientY);
  };

  const byId = new Map(sketch.curves.map((curve) => [curve.id, curve]));

  for (const constraint of sketch.constraints) {
    if ("driving" in constraint && constraint.driving === false) continue;
    switch (constraint.type) {
      case "coincident": {
        const x = row();
        addPoint(x, constraint.a, 1, 0);
        addPoint(x, constraint.b, -1, 0);
        if (x.size) rows.push(x);
        const y = row();
        addPoint(y, constraint.a, 0, 1);
        addPoint(y, constraint.b, 0, -1);
        if (y.size) rows.push(y);
        break;
      }
      case "horizontal":
      case "vertical": {
        const line = byId.get(constraint.line);
        if (!line || line.type !== "line") break;
        const r = row();
        if (constraint.type === "horizontal") {
          addPoint(r, line.a, 0, 1);
          addPoint(r, line.b, 0, -1);
        } else {
          addPoint(r, line.a, 1, 0);
          addPoint(r, line.b, -1, 0);
        }
        if (r.size) rows.push(r);
        break;
      }
      case "distance": {
        const r = distanceRow(sketch, params, constraint);
        if (r) rows.push(r);
        break;
      }
      case "diameter": {
        const slot = params.radiusIndex.get(constraint.circle);
        if (slot === undefined) break;
        rows.push(new Map([[slot, 2]]));
        break;
      }
      case "parallel":
      case "perpendicular": {
        const a = byId.get(constraint.a);
        const b = byId.get(constraint.b);
        if (!a || a.type !== "line" || !b || b.type !== "line") break;
        const a1 = sketch.points.find((point) => point.id === a.a);
        const a2 = sketch.points.find((point) => point.id === a.b);
        const b1 = sketch.points.find((point) => point.id === b.a);
        const b2 = sketch.points.find((point) => point.id === b.b);
        if (!a1 || !a2 || !b1 || !b2) break;
        const dax = a2.x - a1.x;
        const day = a2.y - a1.y;
        const dbx = b2.x - b1.x;
        const dby = b2.y - b1.y;
        const r = row();
        if (constraint.type === "parallel") {
          // d(dax*dby - day*dbx)
          addPoint(r, a.a, -dby, dbx);
          addPoint(r, a.b, dby, -dbx);
          addPoint(r, b.a, day, -dax);
          addPoint(r, b.b, -day, dax);
        } else {
          // d(dax*dbx + day*dby)
          addPoint(r, a.a, -dbx, -dby);
          addPoint(r, a.b, dbx, dby);
          addPoint(r, b.a, -dax, -day);
          addPoint(r, b.b, dax, day);
        }
        if (r.size) rows.push(r);
        break;
      }
      case "equal": {
        const a = byId.get(constraint.a);
        const b = byId.get(constraint.b);
        if (!a || !b) break;
        if (a.type === "line" && b.type === "line") {
          const a1 = sketch.points.find((point) => point.id === a.a);
          const a2 = sketch.points.find((point) => point.id === a.b);
          const b1 = sketch.points.find((point) => point.id === b.a);
          const b2 = sketch.points.find((point) => point.id === b.b);
          if (!a1 || !a2 || !b1 || !b2) break;
          const dax = a2.x - a1.x;
          const day = a2.y - a1.y;
          const dbx = b2.x - b1.x;
          const dby = b2.y - b1.y;
          const lenA = Math.hypot(dax, day);
          const lenB = Math.hypot(dbx, dby);
          if (lenA < 1e-9 || lenB < 1e-9) break;
          const uax = dax / lenA;
          const uay = day / lenA;
          const ubx = dbx / lenB;
          const uby = dby / lenB;
          const r = row();
          addPoint(r, a.a, -uax, -uay);
          addPoint(r, a.b, uax, uay);
          addPoint(r, b.a, ubx, uby);
          addPoint(r, b.b, -ubx, -uby);
          if (r.size) rows.push(r);
        } else if (a.type === "circle" && b.type === "circle") {
          const ra = params.radiusIndex.get(a.id);
          const rb = params.radiusIndex.get(b.id);
          if (ra !== undefined && rb !== undefined) {
            rows.push(
              new Map([
                [ra, 1],
                [rb, -1],
              ]),
            );
          }
        }
        break;
      }
      case "pointOnLine": {
        const p = sketch.points.find((point) => point.id === constraint.point);
        const line = byId.get(constraint.line);
        if (!p || !line || line.type !== "line") break;
        const a = sketch.points.find((point) => point.id === line.a);
        const b = sketch.points.find((point) => point.id === line.b);
        if (!a || !b) break;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const ex = p.x - a.x;
        const ey = p.y - a.y;
        const r = row();
        addPoint(r, constraint.point, -dy, dx);
        addPoint(r, line.a, dy - ey, ex - dx);
        addPoint(r, line.b, ey, -ex);
        if (r.size) rows.push(r);
        break;
      }
      case "midpoint": {
        const line = byId.get(constraint.line);
        if (!line || line.type !== "line") break;
        const x = row();
        addPoint(x, constraint.point, 1, 0);
        addPoint(x, line.a, -0.5, 0);
        addPoint(x, line.b, -0.5, 0);
        if (x.size) rows.push(x);
        const y = row();
        addPoint(y, constraint.point, 0, 1);
        addPoint(y, line.a, 0, -0.5);
        addPoint(y, line.b, 0, -0.5);
        if (y.size) rows.push(y);
        break;
      }
    }
  }

  return rows;
}

function distanceRow(
  sketch: Sketch,
  params: Parameters,
  constraint: Extract<SketchConstraint, { type: "distance" }>,
): Row | null {
  const a = sketch.points.find((point) => point.id === constraint.a);
  const b = sketch.points.find((point) => point.id === constraint.b);
  if (!a || !b) return null;

  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-9) return null;

  const r = new Map<number, number>();
  const ux = dx / length;
  const uy = dy / length;
  const add = (id: string, cx: number, cy: number): void => {
    const slot = params.pointIndex.get(id);
    if (!slot) return;
    r.set(slot[0], (r.get(slot[0]) ?? 0) + cx);
    r.set(slot[1], (r.get(slot[1]) ?? 0) + cy);
  };
  add(constraint.a, ux, uy);
  add(constraint.b, -ux, -uy);
  return r.size ? r : null;
}
