import type { Entity, SlvsModule } from "slvs";
import { projectDrag } from "./drag";
import type { Vec2 } from "../types";
import type { Sketch } from "./types";

/**
 * Adapter around SolveSpace's `slvs` constraint solver (GPLv3, WASM).
 *
 * This is the only module allowed to import `slvs`. Everything else speaks the
 * types in `./types`.
 *
 * The solver has no document: every solve starts from an empty sketch and is
 * rebuilt from our model. Entity handles are therefore ephemeral and never
 * escape this file.
 */

export type SolveStatus =
  | "ok"
  | "redundant"
  | "inconsistent"
  | "did-not-converge"
  | "too-many-unknowns"
  | "solver-error";

export interface SolveOutcome {
  /** True when the solver reached a valid solution (including redundant-but-ok). */
  ok: boolean;
  status: SolveStatus;
  /** Real remaining degrees of freedom for the sketch (0 = fully constrained). */
  dof: number;
  points: Record<string, Vec2>;
  radii: Record<string, number>;
  /** Ids of the constraints the solver could not satisfy. */
  conflicting: string[];
  message?: string;
}

export interface DragTarget {
  pointId: string;
  x: number;
  y: number;
}

/** Everything we create lives in this group, except fixed reference geometry. */
const SKETCH_GROUP = 1;
/** Fixed points (origin, projected edges) live in group 0 and are not unknowns. */
const REFERENCE_GROUP = 0;

/**
 * `Slvs_SolveSketch` treats the base 2D workplane as a free rigid body in 3D:
 * 3 translation + 3 rotation parameters. Two of those rotations and one
 * translation are irrelevant to a planar sketch, but they are still counted, so
 * the reported DOF is always 6 too high.
 */
const WORKPLANE_FRAME_DOF = 6;

let modulePromise: Promise<SlvsModule> | null = null;
let solver: SlvsModule | null = null;

/** Load the WASM solver. Safe to call repeatedly; cleverly lazy. */
export async function initSolver(): Promise<void> {
  if (solver) return;
  if (!modulePromise) {
    modulePromise = (async () => {
      const { default: createSolver } = await import("slvs");
      return createSolver();
    })().catch((error: unknown) => {
      modulePromise = null;
      throw error;
    });
  }
  solver = await modulePromise;
}

export function isSolverReady(): boolean {
  return solver !== null;
}

export function solveSketch(sketch: Sketch, drag?: DragTarget): SolveOutcome {
  if (!solver) throw new Error("Solver not initialised; await initSolver() first.");
  const s = solver;

  try {
    return solveWithModule(s, sketch, drag);
  } catch (error) {
    // A bad argument aborts the whole WASM instance and cannot be caught inside
    // emscripten. Drop it so the next call can start a fresh module.
    solver = null;
    modulePromise = null;
    return {
      ok: false,
      status: "solver-error",
      dof: 0,
      points: {},
      radii: {},
      conflicting: [],
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Drag a point towards a cursor position, following the constraints.
 *
 * The cursor delta is projected onto the constraint tangent space (see
 * `drag.ts`), then the solver cleans up the second-order error. This makes a
 * point slide along a line, a circle or an arbitrary constrained path instead
 * of the drag simply being rejected.
 */
export function solveDrag(sketch: Sketch, drag: DragTarget): SolveOutcome | null {
  const origin = sketch.points.find((point) => point.id === drag.pointId);
  if (!origin) return null;

  const projected = projectDrag(sketch, drag);
  if (!projected) return null;

  // The tangent projection is first-order. A curved constraint leaves a
  // second-order error, so fall back to shorter steps if the kernel rejects
  // the full one.
  for (const scale of [1, 0.5, 0.25, 0.1]) {
    const seeded =
      scale === 1 ? projected.sketch : interpolateSketch(sketch, projected.sketch, scale);
    const outcome = solveSketch(seeded);
    if (!outcome.ok) continue;

    // A full-rank sketch projects to zero, but floating point can leave a
    // residue. If the dragged point did not actually move, this is a no-op.
    const solved = outcome.points[drag.pointId];
    if (!solved) return null;
    if (Math.hypot(solved[0] - origin.x, solved[1] - origin.y) < 1e-4) return null;
    return outcome;
  }
  return null;
}

function interpolateSketch(from: Sketch, to: Sketch, scale: number): Sketch {
  const target = new Map(to.points.map((point) => [point.id, point]));
  return {
    ...to,
    points: from.points.map((point) => {
      const end = target.get(point.id);
      if (!end) return point;
      return {
        ...point,
        x: point.x + (end.x - point.x) * scale,
        y: point.y + (end.y - point.y) * scale,
      };
    }),
  };
}

function solveWithModule(s: SlvsModule, sketch: Sketch, drag?: DragTarget): SolveOutcome {
  const none = s.E_NONE;
  const group = SKETCH_GROUP;

  s.clearSketch();
  const workplane = s.addBase2D(group);

  const entities = new Map<string, Entity>();
  const radiusEntities = new Map<string, Entity>();
  let planeNormal: Entity | null = null;
  const planeNormalEntity = (): Entity => {
    // A fixed (group-0) normal: a 2D circle's plane never moves, and leaving it
    // in the solved group would add 3 meaningless degrees of freedom.
    planeNormal ??= s.addNormal3D(REFERENCE_GROUP, 1, 0, 0, 0);
    return planeNormal;
  };

  for (const point of sketch.points) {
    const dragged = drag?.pointId === point.id && !point.fixed;
    const x = dragged ? drag.x : point.x;
    const y = dragged ? drag.y : point.y;
    entities.set(
      point.id,
      s.addPoint2D(point.fixed ? REFERENCE_GROUP : group, x, y, workplane),
    );
  }

  for (const curve of sketch.curves) {
    if (curve.type === "line") {
      entities.set(
        curve.id,
        s.addLine2D(group, need(entities, curve.a), need(entities, curve.b), workplane),
      );
      continue;
    }
    const radius = s.addDistance(group, curve.radius, workplane);
    radiusEntities.set(curve.id, radius);
    entities.set(
      curve.id,
      s.addCircle(group, planeNormalEntity(), need(entities, curve.center), radius, workplane),
    );
  }

  const constraintIds = new Map<number, string>();
  for (const constraint of sketch.constraints) {
    // Reference dimensions are annotations; they must not enter the system.
    if ("driving" in constraint && constraint.driving === false) continue;
    let added;
    switch (constraint.type) {
      case "coincident":
        added = s.coincident(
          group,
          need(entities, constraint.a),
          need(entities, constraint.b),
          workplane,
        );
        break;
      case "horizontal":
        added = s.horizontal(group, need(entities, constraint.line), workplane, none);
        break;
      case "vertical":
        added = s.vertical(group, need(entities, constraint.line), workplane, none);
        break;
      case "distance":
        added = s.distance(
          group,
          need(entities, constraint.a),
          need(entities, constraint.b),
          constraint.value,
          workplane,
        );
        break;
      case "diameter":
        added = s.diameter(group, need(entities, constraint.circle), constraint.value);
        break;
      case "midpoint":
        added = s.midpoint(
          group,
          need(entities, constraint.point),
          need(entities, constraint.line),
          workplane,
        );
        break;
    }
    constraintIds.set(added.h, constraint.id);
  }

  if (drag) {
    const point = entities.get(drag.pointId);
    if (point && !sketch.points.some((p) => p.id === drag.pointId && p.fixed)) {
      // Seed the dragged point at the cursor and ask the solver to keep it
      // there. Without this the solver may pick a mirrored solution branch.
      s.dragged(group, point, workplane);
    }
  }

  const result = s.solveSketch(group, true);
  const status = statusFromResult(result.result);
  const conflicting = result.bad ? Array.from(result.bad).map((h) => constraintIds.get(h) ?? `#${h}`) : [];

  const points: Record<string, Vec2> = {};
  for (const point of sketch.points) {
    const entity = entities.get(point.id);
    if (!entity) continue;
    points[point.id] = [
      round(s.getParamValue(entity.param[0])),
      round(s.getParamValue(entity.param[1])),
    ];
  }

  const radii: Record<string, number> = {};
  for (const [curveId, entity] of radiusEntities) {
    radii[curveId] = round(s.getParamValue(entity.param[0]));
  }

  return {
    ok: status === "ok" || status === "redundant",
    status,
    dof: Math.max(0, result.dof - WORKPLANE_FRAME_DOF),
    points,
    radii,
    conflicting,
    ...(status === "solver-error" ? { message: "The constraint solver failed." } : {}),
  };
}

function need(entities: Map<string, Entity>, id: string): Entity {
  const entity = entities.get(id);
  if (!entity) throw new Error(`Sketch references unknown entity "${id}".`);
  return entity;
}

function statusFromResult(result: number): SolveStatus {
  switch (result) {
    case 0:
      return "ok";
    case 1:
      return "inconsistent";
    case 2:
      return "did-not-converge";
    case 3:
      return "too-many-unknowns";
    case 4:
      return "redundant";
    default:
      return "solver-error";
  }
}

function round(value: number): number {
  // The solver works in doubles; 1e-7 mm is far below UI precision and keeps
  // repeated solves deterministic for React equality checks.
  return Math.round(value * 1e7) / 1e7;
}
