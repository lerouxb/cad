import type { PlaneFrame, Vec3 } from "../types";
import type { TopoHint } from "../kernel/protocol";
import type { PlaneRef, WorldPlane } from "./types";

const X: Vec3 = [1, 0, 0];
const Y: Vec3 = [0, 1, 0];
const Z: Vec3 = [0, 0, 1];

function length(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2]);
}

function normalize(v: Vec3): Vec3 | null {
  const len = length(v);
  if (len < 1e-9) return null;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function scale(v: Vec3, s: number): Vec3 {
  return [v[0] * s, v[1] * s, v[2] * s];
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function validVec3(value: unknown): value is Vec3 {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((part) => typeof part === "number" && Number.isFinite(part))
  );
}

/** The canonical frame for a world plane. */
export function worldPlaneFrame(plane: WorldPlane): PlaneFrame {
  if (plane === "XZ") {
    // x = world X, y = world Z, x × y = -Y.
    return { origin: [0, 0, 0], normal: [0, -1, 0], xAxis: X, yAxis: Z };
  }
  if (plane === "YZ") {
    // x = world Y, y = world Z, x × y = X.
    return { origin: [0, 0, 0], normal: [1, 0, 0], xAxis: Y, yAxis: Z };
  }
  return { origin: [0, 0, 0], normal: Z, xAxis: X, yAxis: Y };
}

export function supportFrame(support: PlaneRef): PlaneFrame {
  return support.kind === "world"
    ? worldPlaneFrame(support.plane)
    : support.frame;
}

/** True for the default XY plane, whose frame can be omitted in kernel input. */
export function isDefaultSupport(support: PlaneRef): boolean {
  return support.kind === "world" && support.plane === "XY";
}

export function supportLabel(support: PlaneRef): string {
  if (support.kind === "world") return support.plane;
  return `Face · ${support.ref.role}`;
}

/**
 * Build a deterministic cached frame from a selected planar face. The x-axis is
 * world X projected into the face plane; if that is degenerate, a world axis is
 * crossed with the normal. y = normal × x.
 */
export function frameFromHint(hint: TopoHint): PlaneFrame | null {
  if (!validVec3(hint.normal) || !validVec3(hint.centroid)) return null;
  const normal = normalize(hint.normal);
  if (!normal) return null;
  const projectedX = subtract(X, scale(normal, dot(X, normal)));
  let xAxis = normalize(projectedX);
  if (!xAxis) xAxis = normalize(cross(Z, normal));
  if (!xAxis) xAxis = normalize(cross(Y, normal));
  if (!xAxis) return null;
  const yAxis = normalize(cross(normal, xAxis));
  if (!yAxis) return null;
  return {
    origin: [hint.centroid[0], hint.centroid[1], hint.centroid[2]],
    normal,
    xAxis,
    yAxis,
  };
}
