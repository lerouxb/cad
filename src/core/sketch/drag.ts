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

export interface DragTarget {
  pointId: string;
  /** Target position in sketch coordinates. */
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

/**
 * Project a set of target positions onto the constraint tangent space. A
 * single point is the usual case; a line supplies both endpoints with the same
 * delta, which translates the line. The endpoints may be constrained
 * differently, so the projection can turn a translation into a stretch.
 */
export function projectDrag(
  sketch: Sketch,
  targets: readonly DragTarget[],
): ProjectedDrag | null {
  const params = buildParameters(sketch);
  const delta = params.values.map(() => 0);
  const mobility = params.values.map(() => 1);
  const dragged: [number, number][] = [];
  const seen = new Set<string>();
  let requested = 0;

  for (const target of targets) {
    if (seen.has(target.pointId)) continue;
    seen.add(target.pointId);
    const point = sketch.points.find((candidate) => candidate.id === target.pointId);
    if (!point || point.fixed || params.fixed.has(point.id)) continue;
    const index = params.pointIndex.get(target.pointId);
    if (!index) continue;

    const dx = target.x - point.x;
    const dy = target.y - point.y;
    delta[index[0]] = dx;
    delta[index[1]] = dy;
    // The dragged points are almost rigid: we want *them* to follow the cursor,
    // and the rest of the sketch to absorb the constraint correction. A tiny
    // mobility (not zero, so rows that only involve the dragged points still
    // project them) gives that behaviour.
    mobility[index[0]] = 1e-9;
    mobility[index[1]] = 1e-9;
    dragged.push([index[0], index[1]]);
    requested = Math.max(requested, Math.hypot(dx, dy));
  }

  if (dragged.length === 0) return null;

  const rows = buildRows(sketch, params);

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

  let moved = 0;
  for (const [xIndex, yIndex] of dragged) {
    moved = Math.max(moved, Math.hypot(delta[xIndex] ?? 0, delta[yIndex] ?? 0));
  }
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

  const fixedByConstraint = new Set<string>();
  for (const constraint of sketch.constraints) {
    if (constraint.type === "fix") fixedByConstraint.add(constraint.point);
  }

  for (const point of sketch.points) {
    if (point.fixed || fixedByConstraint.has(point.id)) {
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
  const pointById = new Map(sketch.points.map((point) => [point.id, point]));
  const addCoefficient = (
    target: Row,
    slot: [number, number] | null | undefined,
    coefficientX: number,
    coefficientY: number,
  ): void => {
    if (!slot) return;
    target.set(slot[0], (target.get(slot[0]) ?? 0) + coefficientX);
    target.set(slot[1], (target.get(slot[1]) ?? 0) + coefficientY);
  };

  // An arc's centre and its two endpoints are constrained to one circle. The
  // solver entity enforces this internally; the drag projection needs the same
  // first-order relationship.
  for (const curve of sketch.curves) {
    if (curve.type !== "arc") continue;
    const center = pointById.get(curve.center);
    const start = pointById.get(curve.start);
    const end = pointById.get(curve.end);
    if (!center || !start || !end) continue;
    const r = row();
    addCoefficient(r, pointSlot(curve.start), 2 * (start.x - center.x), 2 * (start.y - center.y));
    addCoefficient(r, pointSlot(curve.end), -2 * (end.x - center.x), -2 * (end.y - center.y));
    addCoefficient(
      r,
      pointSlot(curve.center),
      -2 * (start.x - center.x) + 2 * (end.x - center.x),
      -2 * (start.y - center.y) + 2 * (end.y - center.y),
    );
    if (r.size) rows.push(r);
  }

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
        if (slot !== undefined) {
          rows.push(new Map([[slot, 2]]));
          break;
        }
        // An arc has no radius parameter: its radius is |start - centre|.
        const arc = byId.get(constraint.circle);
        if (!arc || arc.type !== "arc") break;
        const center = pointById.get(arc.center);
        const start = pointById.get(arc.start);
        if (!center || !start) break;
        const radius = Math.hypot(start.x - center.x, start.y - center.y);
        if (radius < 1e-9) break;
        const r = row();
        addCoefficient(
          r,
          pointSlot(arc.start),
          (2 * (start.x - center.x)) / radius,
          (2 * (start.y - center.y)) / radius,
        );
        addCoefficient(
          r,
          pointSlot(arc.center),
          (-2 * (start.x - center.x)) / radius,
          (-2 * (start.y - center.y)) / radius,
        );
        if (r.size) rows.push(r);
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
      case "pointOnCircle": {
        const p = pointById.get(constraint.point);
        const curve = byId.get(constraint.circle);
        if (!p) break;
        if (curve?.type === "circle") {
          const center = pointById.get(curve.center);
          if (!center) break;
          const r = row();
          addCoefficient(
            r,
            pointSlot(constraint.point),
            2 * (p.x - center.x),
            2 * (p.y - center.y),
          );
          addCoefficient(
            r,
            pointSlot(curve.center),
            -2 * (p.x - center.x),
            -2 * (p.y - center.y),
          );
          const radiusSlot = params.radiusIndex.get(curve.id);
          if (radiusSlot !== undefined) {
            r.set(radiusSlot, r.get(radiusSlot) ?? -2 * curve.radius);
          }
          if (r.size) rows.push(r);
        } else if (curve?.type === "arc") {
          const center = pointById.get(curve.center);
          const start = pointById.get(curve.start);
          if (!center || !start) break;
          const r = row();
          addCoefficient(
            r,
            pointSlot(constraint.point),
            2 * (p.x - center.x),
            2 * (p.y - center.y),
          );
          addCoefficient(
            r,
            pointSlot(curve.start),
            -2 * (start.x - center.x),
            -2 * (start.y - center.y),
          );
          addCoefficient(
            r,
            pointSlot(curve.center),
            -2 * (p.x - center.x) + 2 * (start.x - center.x),
            -2 * (p.y - center.y) + 2 * (start.y - center.y),
          );
          if (r.size) rows.push(r);
        }
        break;
      }
      case "pointLineDistance": {
        const p = pointById.get(constraint.point);
        const line = byId.get(constraint.line);
        if (!p || !line || line.type !== "line") break;
        const a = pointById.get(line.a);
        const b = pointById.get(line.b);
        if (!a || !b) break;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const length = Math.hypot(dx, dy);
        if (length < 1e-9) break;
        const nx = -dy / length;
        const ny = dx / length;
        // First-order form: (P - A) . n = value, with n frozen at the current
        // configuration. The solver corrects the second-order error.
        const signed = (p.x - a.x) * nx + (p.y - a.y) * ny - constraint.value;
        const r = row();
        addCoefficient(r, pointSlot(constraint.point), nx, ny);
        addCoefficient(
          r,
          pointSlot(line.a),
          -nx - (signed * dy) / (length * length),
          -ny + (signed * dx) / (length * length),
        );
        addCoefficient(
          r,
          pointSlot(line.b),
          (signed * dy) / (length * length),
          -(signed * dx) / (length * length),
        );
        if (r.size) rows.push(r);
        break;
      }
      case "angle": {
        const lineA = byId.get(constraint.a);
        const lineB = byId.get(constraint.b);
        if (!lineA || lineA.type !== "line" || !lineB || lineB.type !== "line") break;
        const a1 = pointById.get(lineA.a);
        const a2 = pointById.get(lineA.b);
        const b1 = pointById.get(lineB.a);
        const b2 = pointById.get(lineB.b);
        if (!a1 || !a2 || !b1 || !b2) break;
        const dax = a2.x - a1.x;
        const day = a2.y - a1.y;
        const dbx = b2.x - b1.x;
        const dby = b2.y - b1.y;
        const cross = dax * dby - day * dbx;
        const dot = dax * dbx + day * dby;
        const denominator = cross * cross + dot * dot;
        if (denominator < 1e-15) break;
        const theta = Math.atan2(cross, dot);
        const target = (constraint.value * Math.PI) / 180;
        const residual = theta - target;
        // d(theta) = (dot * d(cross) - cross * d(dot)) / denominator
        const factor = 1 / denominator;
        const r = row();
        addCoefficient(
          r,
          pointSlot(lineA.a),
          factor * (dot * -dby - cross * -dbx),
          factor * (dot * dbx - cross * -dby),
        );
        addCoefficient(
          r,
          pointSlot(lineA.b),
          factor * (dot * dby - cross * dbx),
          factor * (dot * -dbx - cross * dby),
        );
        addCoefficient(
          r,
          pointSlot(lineB.a),
          factor * (dot * day - cross * -dax),
          factor * (dot * -dax - cross * day),
        );
        addCoefficient(
          r,
          pointSlot(lineB.b),
          factor * (dot * -day - cross * dax),
          factor * (dot * dax - cross * -day),
        );
        // If the measured angle is on the other branch, the projection should
        // still move towards the requested magnitude.
        if (Math.abs(residual) > Math.PI / 2) {
          for (const [slot, value] of r) r.set(slot, -value);
        }
        if (r.size) rows.push(r);
        break;
      }
      case "tangent": {
        const a = byId.get(constraint.a);
        const b = byId.get(constraint.b);
        const arc = a?.type === "arc" ? a : b?.type === "arc" ? b : null;
        const line = a?.type === "line" ? a : b?.type === "line" ? b : null;
        if (!arc || !line) break;
        const center = pointById.get(arc.center);
        const lineA = pointById.get(line.a);
        const lineB = pointById.get(line.b);
        if (!center || !lineA || !lineB) break;
        const shared =
          arc.start === line.a || arc.start === line.b
            ? arc.start
            : arc.end === line.a || arc.end === line.b
              ? arc.end
              : null;
        if (!shared) break;
        const endpoint = pointById.get(shared);
        if (!endpoint) break;
        // (line direction) . (center - shared endpoint) = 0
        const dx = lineB.x - lineA.x;
        const dy = lineB.y - lineA.y;
        const r = row();
        addCoefficient(r, pointSlot(arc.center), dx, dy);
        addCoefficient(r, pointSlot(shared), -dx, -dy);
        addCoefficient(r, pointSlot(line.a), -(center.x - endpoint.x), -(center.y - endpoint.y));
        addCoefficient(r, pointSlot(line.b), center.x - endpoint.x, center.y - endpoint.y);
        if (r.size) rows.push(r);
        break;
      }
      case "symmetric": {
        const a = pointById.get(constraint.a);
        const b = pointById.get(constraint.b);
        const axis = byId.get(constraint.about);
        if (!a || !b || !axis || axis.type !== "line") break;
        const p = pointById.get(axis.a);
        const q = pointById.get(axis.b);
        if (!p || !q) break;
        const dx = q.x - p.x;
        const dy = q.y - p.y;
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        // Midpoint on the axis.
        const row1 = row();
        addCoefficient(row1, pointSlot(constraint.a), 0.5 * dy, -0.5 * dx);
        addCoefficient(row1, pointSlot(constraint.b), 0.5 * dy, -0.5 * dx);
        addCoefficient(row1, pointSlot(axis.a), -dy + (my - p.y), dx - (mx - p.x));
        addCoefficient(row1, pointSlot(axis.b), -(my - p.y), mx - p.x);
        if (row1.size) rows.push(row1);
        // Segment AB perpendicular to the axis.
        const row2 = row();
        addCoefficient(row2, pointSlot(constraint.a), -dx, -dy);
        addCoefficient(row2, pointSlot(constraint.b), dx, dy);
        addCoefficient(row2, pointSlot(axis.a), -(b.x - a.x), -(b.y - a.y));
        addCoefficient(row2, pointSlot(axis.b), b.x - a.x, b.y - a.y);
        if (row2.size) rows.push(row2);
        break;
      }
      case "fix":
        // A fixed point has no parameters; nothing to project.
        break;
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
